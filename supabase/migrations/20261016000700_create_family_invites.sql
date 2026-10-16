begin;

-- Phase 1 (F08): family invites, and the three parent RPCs that manage them.
--
-- 1. public.family_invites: one row per invite code. RLS is on and the API
--    roles have no access at all; everything goes through the RPCs below
--    (and F09's preview and redeem).
-- 2. create_family_invite(p_role, p_permissions, p_code_hash)
-- 3. list_family_invites()
-- 4. revoke_family_invite(p_invite_id)
--
-- Codes are generated and hashed in TypeScript (F21). The database only ever
-- sees sha256(code) as 64 lowercase hex characters, so a leaked row can't be
-- turned back into a working link.
--
-- Same conventions as F06 (20261015230000_add_family_read_access.sql):
-- security definer, set search_path = '', fully qualified names, the caller is
-- app_private.current_user_id(), and execute is granted to authenticated only.
-- Error messages reach the UI through translateDatabaseError, so they are
-- written for users.

create table public.family_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  code_hash text not null,
  role text not null,
  permissions jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  constraint family_invites_code_hash_key unique (code_hash),
  constraint family_invites_code_hash_format check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint family_invites_role_valid check (role in ('parent', 'kid')),
  -- Kid invites carry the kid's permissions; parent invites never do.
  -- create_family_invite checks the JSON itself against the catalogue.
  constraint family_invites_permissions_match_role check (
    (role = 'kid') = (permissions is not null)
  )
);

-- Listing a family's invites, the family's cascade delete, and the
-- on delete set null of both user references.
create index family_invites_family_id_idx on public.family_invites (family_id);
create index family_invites_created_by_idx on public.family_invites (created_by);
create index family_invites_used_by_idx on public.family_invites (used_by);

alter table public.family_invites enable row level security;

-- No policies and no grants: codes are secrets, so even a family's own
-- parents read invites only through list_family_invites().
revoke all on table public.family_invites from public, anon, authenticated;

comment on table public.family_invites is
  'Invite codes to join a family. Only sha256(code) is stored. No direct access: use the invite RPCs.';
comment on column public.family_invites.code_hash is
  'sha256 of the normalised invite code, as 64 lowercase hex characters.';
comment on column public.family_invites.permissions is
  'The kid''s permissions as a full catalogue object; null for parent invites.';
comment on column public.family_invites.expires_at is
  'Set by create_family_invite: 48 hours for parent invites, 7 days for kid invites.';

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

-- A parent creates an invite to their own family and gets its id and expiry.
--
-- * p_role: 'parent' or 'kid'.
-- * p_permissions: required for a kid invite and checked with
--   family_private.is_valid_permissions; must be null for a parent invite
--   (a JSON null counts as null).
-- * p_code_hash: sha256 of the code as 64 lowercase hex characters.
-- * expires_at is now() plus 48 hours for a parent invite and 7 days for a
--   kid invite. The caller can't choose it.
--
-- Errors, checked in this order:
-- * 42501 when the caller isn't a parent (a kid, no family, or no user). This
--   comes first, so a kid learns nothing else.
-- * 23514 when the role isn't parent or kid, a parent invite has
--   permissions, a kid invite has missing or invalid permissions, or the code
--   hash isn't 64 lowercase hex characters.
-- * 23505 when the code hash already exists. F21 can retry with a new code.
create function public.create_family_invite(
  p_role text,
  p_permissions jsonb,
  p_code_hash text
)
returns table (invite_id uuid, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_family_id uuid;
  invite_permissions jsonb := nullif(p_permissions, 'null'::jsonb);
  new_invite_id uuid;
  new_expires_at timestamptz;
begin
  -- The key share lock keeps the caller's membership from being removed
  -- before this transaction commits, so a parent who is being removed can't
  -- leave a fresh invite behind.
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent'
  for key share;

  if not found then
    raise exception 'Only parents can invite people to the family.'
      using errcode = '42501';
  end if;

  if p_role is null or p_role not in ('parent', 'kid') then
    raise exception 'Choose whether to invite a parent or a kid.'
      using errcode = '23514';
  end if;

  if p_role = 'parent' and invite_permissions is not null then
    raise exception 'Parents always have full access, so a parent invite can''t have permissions.'
      using errcode = '23514';
  end if;

  if p_role = 'kid' and not family_private.is_valid_permissions(invite_permissions) then
    raise exception 'Choose an allowed level for every module.'
      using errcode = '23514';
  end if;

  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'The invite code is not valid.'
      using errcode = '23514';
  end if;

  begin
    insert into public.family_invites as i
      (family_id, code_hash, role, permissions, created_by, expires_at)
    values (
      caller_family_id,
      p_code_hash,
      p_role,
      invite_permissions,
      app_private.current_user_id(),
      now() + case when p_role = 'parent' then interval '48 hours' else interval '7 days' end
    )
    returning i.id, i.expires_at into new_invite_id, new_expires_at;
  exception
    when unique_violation then
      raise exception 'That invite code is already in use.'
        using errcode = '23505';
  end;

  return query select new_invite_id, new_expires_at;
end;
$$;

-- A parent's pending invites: not used, not revoked and not expired, newest
-- first. created_by_name follows get_family()'s displayName: the creator's
-- display name, else username, else the part of their email before the '@';
-- null once the creator's account is deleted (created_by is set null).
--
-- Errors: 42501 when the caller isn't a parent.
create function public.list_family_invites()
returns table (
  invite_id uuid,
  role text,
  permissions jsonb,
  created_by_name text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  caller_family_id uuid;
begin
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent';

  if not found then
    raise exception 'Only parents can see the family''s invites.'
      using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.role,
    i.permissions,
    coalesce(
      p.display_name,
      p.username,
      nullif(split_part(u.email, '@', 1), '')
    ),
    i.created_at,
    i.expires_at
  from public.family_invites i
  left join public.profiles p on p.id = i.created_by
  left join auth.users u on u.id = i.created_by
  where i.family_id = caller_family_id
    and i.used_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  order by i.created_at desc, i.id;
end;
$$;

-- A parent revokes an invite of their own family, so it can no longer be
-- redeemed. Revoking an invite that is already revoked or used succeeds and
-- changes nothing: revoked_at keeps its first value, and a used invite is
-- never marked revoked. An expired, unused invite is marked revoked.
--
-- Errors, checked in this order:
-- * 42501 when the caller isn't a parent. This comes before looking at the
--   invite, so a kid learns nothing about invite ids.
-- * P0002 when the invite doesn't exist or belongs to another family. Both get
--   the same error, so a parent can't probe other families.
create function public.revoke_family_invite(p_invite_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_family_id uuid;
begin
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent';

  if not found then
    raise exception 'Only parents can revoke invites.'
      using errcode = '42501';
  end if;

  -- Lock the invite so a revoke and a redeem (F09, which also locks it) apply
  -- one after the other: the invite ends up either used or revoked, not both.
  perform 1
  from public.family_invites i
  where i.id = p_invite_id
    and i.family_id = caller_family_id
  for update;

  if not found then
    raise exception 'That invite wasn''t found.'
      using errcode = 'P0002';
  end if;

  update public.family_invites i
  set revoked_at = now()
  where i.id = p_invite_id
    and i.revoked_at is null
    and i.used_at is null;
end;
$$;

revoke all on function
  public.create_family_invite(text, jsonb, text),
  public.list_family_invites(),
  public.revoke_family_invite(uuid)
from public, anon;
grant execute on function
  public.create_family_invite(text, jsonb, text),
  public.list_family_invites(),
  public.revoke_family_invite(uuid)
to authenticated;

comment on function public.create_family_invite(text, jsonb, text) is
  'A parent creates an invite (expires in 48 hours for a parent, 7 days for a kid). 42501 for a non-parent, 23514 for an invalid role, permissions or code hash, 23505 for a code hash already in use.';
comment on function public.list_family_invites() is
  'A parent''s pending invites (not used, revoked or expired), newest first, with the creator''s name. 42501 for a non-parent.';
comment on function public.revoke_family_invite(uuid) is
  'A parent revokes an invite of their own family; already revoked or used invites are left as they are. 42501 for a non-parent, P0002 for an unknown or other-family invite.';

commit;
