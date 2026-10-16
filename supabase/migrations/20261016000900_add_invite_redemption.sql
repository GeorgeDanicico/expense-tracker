begin;

-- Phase 1 (F09): preview and redeem an invite code.
--
-- 1. family_private.is_invite_redeemable(invite): the one definition of a
--    usable invite, shared by the three functions below.
-- 2. preview_family_invite(p_code_hash): what a code invites you to.
-- 3. redeem_family_invite(p_code_hash): join the family with a code.
-- 4. list_family_invites() (F08) is recreated with the same signature, so a
--    parent sees exactly the invites that can still be redeemed.
--
-- An invite is usable when it is not used, not revoked and not expired, and
-- its creator is still a parent of its family. An invite whose creator was
-- removed from the family, demoted, or whose account was deleted (created_by
-- set null) stops working: an invite is the creator's say-so, and it shouldn't
-- outlive their place in the family. A kid invite's permissions must also
-- still be a valid catalogue object.
--
-- Codes are hashed in TypeScript (F22), so the database only sees sha256(code)
-- as 64 lowercase hex characters.
--
-- Same conventions as F06 (20261015230000_add_family_read_access.sql):
-- security definer, set search_path = '', fully qualified names, the caller is
-- app_private.current_user_id(), and execute is granted to authenticated only.
-- Error messages reach the UI through translateDatabaseError, so they are
-- written for users.

-- ---------------------------------------------------------------------------
-- Private building block (no grants: only security definer code calls it).
-- ---------------------------------------------------------------------------

-- Whether an invite can still be redeemed:
-- * not used, not revoked, and expires_at is after now();
-- * created_by is a parent member of the invite's family (false when it is
--   null, because the account was deleted);
-- * a kid invite's permissions pass family_private.is_valid_permissions, in
--   case the catalogue changed since the invite was created.
-- now() is the transaction's start time, the same clock the RPCs use.
create function family_private.is_invite_redeemable(p_invite public.family_invites)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_invite.id is not null
    and p_invite.used_at is null
    and p_invite.revoked_at is null
    and p_invite.expires_at > now()
    and (p_invite.role = 'parent' or family_private.is_valid_permissions(p_invite.permissions))
    and exists (
      select 1
      from public.family_members m
      where m.family_id = p_invite.family_id
        and m.user_id = p_invite.created_by
        and m.role = 'parent'
    )
$$;

revoke all on function family_private.is_invite_redeemable(public.family_invites)
  from public, anon, authenticated, service_role;

comment on function family_private.is_invite_redeemable(public.family_invites) is
  'Whether an invite is unused, unrevoked, unexpired, created by a current parent of its family, and (for a kid) carries valid permissions.';

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

-- What a code invites the caller to: zero or one rows with the family's name,
-- the inviter's name (display name, else username, else the part of their email
-- before the '@', as in get_family()), the role, the kid's permissions (null
-- for a parent invite) and the expiry.
--
-- Zero rows for an unknown, expired, used, revoked or orphaned code alike, so
-- the caller never learns why a code doesn't work. Anyone signed in may
-- preview, members of a family included: the redeem step refuses them.
--
-- Errors:
-- * 42501 when there is no caller.
-- * 23514 when the code hash isn't 64 lowercase hex characters.
create function public.preview_family_invite(p_code_hash text)
returns table (
  family_name text,
  inviter_name text,
  role text,
  permissions jsonb,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if app_private.current_user_id() is null then
    raise exception 'Sign in to use an invite code.'
      using errcode = '42501';
  end if;

  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'The invite code is not valid.'
      using errcode = '23514';
  end if;

  return query
  select
    f.name,
    coalesce(
      p.display_name,
      p.username,
      nullif(split_part(u.email, '@', 1), '')
    ),
    i.role,
    i.permissions,
    i.expires_at
  from public.family_invites i
  join public.families f on f.id = i.family_id
  left join public.profiles p on p.id = i.created_by
  left join auth.users u on u.id = i.created_by
  where i.code_hash = p_code_hash
    and family_private.is_invite_redeemable(i);
end;
$$;

-- The caller joins a family with a code and gets their new member id. The
-- membership takes the invite's role; a kid invite also writes one
-- member_permissions row per module. The invite is marked used by the caller.
--
-- Errors, checked in this order:
-- * 42501 when there is no caller.
-- * 23514 when the code hash isn't 64 lowercase hex characters.
-- * 23505 when the caller is already in a family, whatever the code. This
--   comes before looking at the invite, so a member learns nothing about it.
-- * P0002 when the code is unknown, expired, used, revoked or orphaned. All
--   get the same message, so the caller never learns which.
--
-- Locking, in this order, so a concurrent call either waits or finds the
-- result:
-- 1. The invite's family row, for key share. delete_family (F12) locks it for
--    update before its cascade deletes the invite, so taking it first avoids a
--    deadlock with this function's membership insert, which needs the same
--    lock for its foreign key. A family deleted meanwhile is gone afterwards,
--    and so is its invite.
-- 2. The invite row, for update. A second redeem of the same code, or a revoke
--    (revoke_family_invite locks it too), waits and then sees the invite used
--    or revoked: only one of them succeeds.
-- 3. The creator's membership, for share. Removing or demoting the creator
--    (remove_family_member, F12) waits for this call, or this call sees it
--    already done.
-- Two redeems by the same caller with different codes both pass the
-- membership check; the unique user_id on family_members refuses the second,
-- with the same 23505.
create function public.redeem_family_invite(p_code_hash text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  invite_family_id uuid;
  invite public.family_invites;
  new_member_id uuid;
begin
  if caller_id is null then
    raise exception 'Sign in to use an invite code.'
      using errcode = '42501';
  end if;

  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'The invite code is not valid.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.family_members m
    where m.user_id = caller_id
  ) then
    raise exception 'You''re already in a family.'
      using errcode = '23505';
  end if;

  select i.family_id into invite_family_id
  from public.family_invites i
  where i.code_hash = p_code_hash;

  if invite_family_id is not null then
    perform 1
    from public.families f
    where f.id = invite_family_id
    for key share;
  end if;

  select i.* into invite
  from public.family_invites i
  where i.code_hash = p_code_hash
  for update;

  if invite.id is not null then
    perform 1
    from public.family_members m
    where m.family_id = invite.family_id
      and m.user_id = invite.created_by
    for share;
  end if;

  -- An unknown code leaves every field of invite null, which is not
  -- redeemable.
  if family_private.is_invite_redeemable(invite) is not true then
    raise exception 'This code isn''t valid anymore.'
      using errcode = 'P0002';
  end if;

  begin
    insert into public.family_members (family_id, user_id, role)
    values (invite.family_id, caller_id, invite.role)
    returning id into new_member_id;
  exception
    when unique_violation then
      raise exception 'You''re already in a family.'
        using errcode = '23505';
  end;

  if invite.role = 'kid' then
    insert into public.member_permissions (member_id, module, level)
    select new_member_id, e.module, e.level
    from jsonb_each_text(invite.permissions) as e(module, level);
  end if;

  update public.family_invites i
  set used_at = now(),
      used_by = caller_id
  where i.id = invite.id;

  return new_member_id;
end;
$$;

-- F08's list, recreated with the same signature: a parent's invites that can
-- still be redeemed (see family_private.is_invite_redeemable), newest first.
-- An invite whose creator is no longer a parent of the family is left out, as
-- it can't be redeemed. created_by_name follows get_family()'s displayName:
-- the creator's display name, else username, else the part of their email
-- before the '@'.
--
-- Errors: 42501 when the caller isn't a parent.
create or replace function public.list_family_invites()
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
    and family_private.is_invite_redeemable(i)
  order by i.created_at desc, i.id;
end;
$$;

revoke all on function
  public.preview_family_invite(text),
  public.redeem_family_invite(text),
  public.list_family_invites()
from public, anon;
grant execute on function
  public.preview_family_invite(text),
  public.redeem_family_invite(text),
  public.list_family_invites()
to authenticated;

comment on function public.preview_family_invite(text) is
  'What a code invites the caller to (0 or 1 rows); zero rows for any code that can''t be redeemed, without saying why. 42501 without a caller, 23514 for a malformed code hash.';
comment on function public.redeem_family_invite(text) is
  'The caller joins a family with a code and gets the member id. 42501 without a caller, 23514 for a malformed code hash, 23505 when already in a family, P0002 for any code that can''t be redeemed.';
comment on function public.list_family_invites() is
  'A parent''s invites that can still be redeemed (unused, unrevoked, unexpired, creator still a parent), newest first, with the creator''s name. 42501 for a non-parent.';

commit;
