begin;

-- MCP access (docs/mcp-access-plan.md, M2).
--
-- 1. profiles.mcp_enabled: the per-user switch, off by default.
-- 2. mcp_private.access_status(user): the one access rule (the switch, and for
--    a kid the mcp permission and a real email). Everything below calls it.
-- 3. my_mcp_access(): the caller's access, for the consent page, the settings
--    page and /api/mcp's OAuth path.
-- 4. A trigger stops a kid who can't use MCP from turning the switch on.
-- 5. public.mcp_tokens: personal access tokens, stored as a SHA-256 hash.
--    Signed-in users read their own rows without the hash; every write goes
--    through create_mcp_token, regenerate_mcp_token and revoke_mcp_token.
-- 6. authenticate_mcp_token(hash): the per-request check for a personal token,
--    for the server's secret key only.
--
-- Same conventions as the family functions: security definer, set search_path
-- = '', fully qualified names, the caller is app_private.current_user_id(),
-- and error messages written for users.
--
-- Kids can't use personal tokens. A later `personal_tokens` kid permission
-- only needs mcp_private.personal_tokens_allowed() changed.

-- Private helpers for MCP access.
-- Keep this schema out of the Supabase exposed-schema list.
create schema if not exists mcp_private;
revoke all on schema mcp_private from public, anon, authenticated, service_role;
grant usage on schema mcp_private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The switch
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column mcp_enabled boolean not null default false;

comment on column public.profiles.mcp_enabled is
  'Whether AI assistants (MCP clients) may use this account. Off by default; while off, every app and personal token of the user is refused.';

-- ---------------------------------------------------------------------------
-- The access rule
-- ---------------------------------------------------------------------------

-- Must match KID_EMAIL_DOMAIN in src/lib/family/kid-account.ts. Change both together.
create function mcp_private.kid_email_domain()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'kids.ifam.invalid'
$$;

-- Why a kid can't use MCP, whatever their switch says:
-- * 'not_permitted' when their mcp permission is off (a missing row is off);
-- * 'email_required' when they have no real email: theirs is still the
--   generated one, or there is none. A kid's new email replaces the generated
--   one only once it's confirmed, so this is "has a confirmed real email".
-- Null for anyone who isn't a kid member, and for a kid who passes both.
create function mcp_private.kid_block_reason(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((
      select p.level
      from public.member_permissions p
      where p.member_id = m.id and p.module = 'mcp'
    ), 'off') = 'off' then 'not_permitted'
    when u.email is null
      or right(lower(u.email), char_length(mcp_private.kid_email_domain()) + 1)
        = '@' || mcp_private.kid_email_domain()
      then 'email_required'
  end
  from public.family_members m
  left join auth.users u on u.id = m.user_id
  where m.user_id = p_user_id
    and m.role = 'kid'
$$;

-- 'ok' | 'mcp_off' | 'not_permitted' | 'email_required', for any user. A user
-- without a profile row counts as switched off.
create function mcp_private.access_status(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not coalesce((
      select p.mcp_enabled from public.profiles p where p.id = p_user_id
    ), false) then 'mcp_off'
    else coalesce(mcp_private.kid_block_reason(p_user_id), 'ok')
  end
$$;

-- Whether the user may hold personal tokens: everyone but kid members.
create function mcp_private.personal_tokens_allowed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.family_members m
    where m.user_id = p_user_id
      and m.role = 'kid'
  )
$$;

-- kid_block_reason for the caller, for the switch guard below, which runs as
-- the caller and so can't call the ungranted helpers.
create function mcp_private.my_kid_block_reason()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select mcp_private.kid_block_reason(app_private.current_user_id())
$$;

-- The expires_at for an expiry choice, from now(): '1m', '3m' and '6m' are
-- months, 'never' is null. Anything else raises 22023, so the database accepts
-- only these four.
create function mcp_private.token_expires_at(p_expiry text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  case p_expiry
    when '1m' then return now() + interval '1 month';
    when '3m' then return now() + interval '3 months';
    when '6m' then return now() + interval '6 months';
    when 'never' then return null;
    else
      raise exception 'Choose an expiry: 1 month, 3 months, 6 months or never.'
        using errcode = '22023';
  end case;
end;
$$;

revoke all on all functions in schema mcp_private from public, anon, authenticated, service_role;
grant execute on function mcp_private.my_kid_block_reason() to authenticated;

comment on function mcp_private.kid_email_domain() is
  'The domain of generated kid emails. Mirrors KID_EMAIL_DOMAIN in src/lib/family/kid-account.ts.';
comment on function mcp_private.kid_block_reason(uuid) is
  'not_permitted (mcp permission off) or email_required (no real email) for a kid member; null otherwise. Ungranted.';
comment on function mcp_private.access_status(uuid) is
  'ok, mcp_off, not_permitted or email_required: whether the user may use MCP right now. Ungranted.';
comment on function mcp_private.personal_tokens_allowed(uuid) is
  'Whether the user may hold personal MCP tokens: false for kid members. Ungranted.';
comment on function mcp_private.my_kid_block_reason() is
  'kid_block_reason for the caller. Granted to authenticated for the profiles switch guard.';
comment on function mcp_private.token_expires_at(text) is
  'expires_at for an expiry choice (1m, 3m, 6m or never, which is null). 22023 for anything else. Ungranted.';

-- ---------------------------------------------------------------------------
-- The caller's access
-- ---------------------------------------------------------------------------

create function public.my_mcp_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', mcp_private.access_status(app_private.current_user_id()),
    'personalTokens', mcp_private.personal_tokens_allowed(app_private.current_user_id())
  )
$$;

revoke all on function public.my_mcp_access() from public, anon;
grant execute on function public.my_mcp_access() to authenticated;

comment on function public.my_mcp_access() is
  'The caller''s MCP access as {status, personalTokens}: status is ok, mcp_off, not_permitted or email_required; personalTokens is false for kids.';

-- ---------------------------------------------------------------------------
-- Switch guard
-- ---------------------------------------------------------------------------

-- Same pattern as guard_profile_avatar_path (20261018000100), and security
-- invoker for the same reason: `current_user` tells the API roles apart from
-- trusted writers. The API roles can't turn the switch on (insert or update)
-- for a kid whose mcp permission is off or who has no real email. Turning it
-- off is always allowed. The owner policies already limit the API roles to
-- their own row, so the caller's reason is the row's.
create function public.guard_profile_mcp_enabled()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  reason text;
begin
  if current_user in ('authenticated', 'anon')
    and new.mcp_enabled
    and not (tg_op = 'UPDATE' and old.mcp_enabled)
  then
    reason := mcp_private.my_kid_block_reason();
    if reason = 'not_permitted' then
      raise exception 'A parent needs to turn on AI assistants for you.'
        using errcode = '42501';
    elsif reason = 'email_required' then
      raise exception 'Add and confirm an email address in Settings to use AI assistants.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_profile_mcp_enabled() from public, anon, authenticated;

comment on function public.guard_profile_mcp_enabled() is
  'Trigger: refuses (42501) the API roles turning profiles.mcp_enabled on for a kid without the mcp permission or a real email.';

create trigger profiles_guard_mcp_enabled
before insert or update of mcp_enabled on public.profiles
for each row execute function public.guard_profile_mcp_enabled();

-- ---------------------------------------------------------------------------
-- Personal tokens
-- ---------------------------------------------------------------------------

create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  prefix text not null,
  created_at timestamptz not null default now(),
  regenerated_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz,          -- null: never expires
  revoked_at timestamptz,
  constraint mcp_tokens_name_valid check (name = btrim(name) and char_length(name) between 1 and 40),
  constraint mcp_tokens_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint mcp_tokens_prefix_format check (prefix ~ '^sl_mcp_[A-Za-z0-9_-]{6}$')
);

-- Serves the owner policy, the user_id cascade and the live-token count.
create index mcp_tokens_user_id_idx on public.mcp_tokens (user_id);

alter table public.mcp_tokens enable row level security;

-- Reads only, and never the hash, so no API bug can send one to the browser.
-- Writes go through the functions below.
revoke all on table public.mcp_tokens from public, anon, authenticated;
grant select (
  id, user_id, name, prefix, created_at, regenerated_at, last_used_at, expires_at, revoked_at
) on table public.mcp_tokens to authenticated;

create policy mcp_tokens_select_own
on public.mcp_tokens for select to authenticated
using (user_id = (select app_private.current_user_id()));

comment on table public.mcp_tokens is
  'Personal MCP access tokens. Revoked rows are kept for the record. Written only by the mcp token functions.';
comment on column public.mcp_tokens.token_hash is
  'Lowercase hex SHA-256 of the whole token. Not readable by signed-in users.';
comment on column public.mcp_tokens.prefix is
  'The token''s first 13 characters (sl_mcp_ and 6 more), shown in the token list.';
comment on column public.mcp_tokens.expires_at is
  'When the token stops working; null when it never expires.';

-- Creates a token for the caller. Refuses kids (42501), an expiry other than
-- the four choices (22023) and an 11th live token (P0001). A live token is
-- neither revoked nor expired. The advisory lock serialises one user's
-- creates, so two at once can't both pass the count.
create function public.create_mcp_token(
  p_name text,
  p_token_hash text,
  p_prefix text,
  p_expiry text
)
returns table (
  id uuid,
  user_id uuid,
  name text,
  prefix text,
  created_at timestamptz,
  regenerated_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  new_expires_at timestamptz;
begin
  if not mcp_private.personal_tokens_allowed(caller_id) then
    raise exception 'Kids connect AI assistants through the app''s sign-in page, not with tokens.'
      using errcode = '42501';
  end if;

  new_expires_at := mcp_private.token_expires_at(p_expiry);

  perform pg_advisory_xact_lock(hashtextextended('mcp_tokens:' || caller_id::text, 0));

  if (
    select count(*)
    from public.mcp_tokens t
    where t.user_id = caller_id
      and t.revoked_at is null
      and (t.expires_at is null or t.expires_at > now())
  ) >= 10 then
    raise exception 'You can have at most 10 personal tokens. Revoke one to create another.'
      using errcode = 'P0001';
  end if;

  return query
  insert into public.mcp_tokens as t (user_id, name, token_hash, prefix, expires_at)
  values (caller_id, p_name, p_token_hash, p_prefix, new_expires_at)
  returning t.id, t.user_id, t.name, t.prefix, t.created_at, t.regenerated_at,
    t.last_used_at, t.expires_at, t.revoked_at;
end;
$$;

-- Swaps a new secret into one of the caller's tokens that isn't revoked (an
-- expired one can be regenerated), in one statement, so the old secret stops
-- working at once. The same checks as create_mcp_token; the cap counts the
-- caller's other live tokens, since regenerating an expired token makes it
-- live again. P0002 for an unknown, revoked or other user's token.
create function public.regenerate_mcp_token(
  p_id uuid,
  p_token_hash text,
  p_prefix text,
  p_expiry text
)
returns table (
  id uuid,
  user_id uuid,
  name text,
  prefix text,
  created_at timestamptz,
  regenerated_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  new_expires_at timestamptz;
begin
  if not mcp_private.personal_tokens_allowed(caller_id) then
    raise exception 'Kids connect AI assistants through the app''s sign-in page, not with tokens.'
      using errcode = '42501';
  end if;

  new_expires_at := mcp_private.token_expires_at(p_expiry);

  perform pg_advisory_xact_lock(hashtextextended('mcp_tokens:' || caller_id::text, 0));

  -- Locked, so a revoke can't land between this check and the update.
  perform 1
  from public.mcp_tokens t
  where t.id = p_id
    and t.user_id = caller_id
    and t.revoked_at is null
  for update;

  if not found then
    raise exception 'Token not found.'
      using errcode = 'P0002';
  end if;

  if (
    select count(*)
    from public.mcp_tokens t
    where t.user_id = caller_id
      and t.id <> p_id
      and t.revoked_at is null
      and (t.expires_at is null or t.expires_at > now())
  ) >= 10 then
    raise exception 'You can have at most 10 personal tokens. Revoke one to create another.'
      using errcode = 'P0001';
  end if;

  return query
  update public.mcp_tokens as t
  set token_hash = p_token_hash,
    prefix = p_prefix,
    expires_at = new_expires_at,
    regenerated_at = now(),
    last_used_at = null
  where t.id = p_id
  returning t.id, t.user_id, t.name, t.prefix, t.created_at, t.regenerated_at,
    t.last_used_at, t.expires_at, t.revoked_at;
end;
$$;

-- Revokes one of the caller's tokens. Expired tokens can be revoked too, since
-- the list shows them until they are. False, changing nothing, for an unknown,
-- already revoked or other user's token.
create function public.revoke_mcp_token(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.mcp_tokens t
  set revoked_at = now()
  where t.id = p_id
    and t.user_id = app_private.current_user_id()
    and t.revoked_at is null;

  return found;
end;
$$;

-- The per-request check for a personal token, with no signed-in user. Status,
-- checked in this order: unknown, revoked, expired, kid_token (the owner has
-- since joined a family as a kid), then access_status(owner). token_id and
-- user_id are set whenever the token exists; email (from auth.users) only for
-- ok. On ok it bumps last_used_at when that's null or more than 5 minutes old,
-- the same throttle as touch_last_active.
create function public.authenticate_mcp_token(p_token_hash text)
returns table (
  status text,
  token_id uuid,
  user_id uuid,
  email text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  token public.mcp_tokens%rowtype;
  v_status text;
begin
  select * into token
  from public.mcp_tokens t
  where t.token_hash = p_token_hash;

  if not found then
    return query select 'unknown'::text, null::uuid, null::uuid, null::text;
    return;
  end if;

  if token.revoked_at is not null then
    v_status := 'revoked';
  elsif token.expires_at is not null and token.expires_at <= now() then
    v_status := 'expired';
  elsif not mcp_private.personal_tokens_allowed(token.user_id) then
    v_status := 'kid_token';
  else
    v_status := mcp_private.access_status(token.user_id);
  end if;

  if v_status <> 'ok' then
    return query select v_status, token.id, token.user_id, null::text;
    return;
  end if;

  update public.mcp_tokens t
  set last_used_at = now()
  where t.id = token.id
    and (t.last_used_at is null or t.last_used_at < now() - interval '5 minutes');

  return query
  select 'ok'::text, token.id, token.user_id, u.email::text
  from auth.users u
  where u.id = token.user_id;
end;
$$;

revoke all on function
  public.create_mcp_token(text, text, text, text),
  public.regenerate_mcp_token(uuid, text, text, text),
  public.revoke_mcp_token(uuid)
from public, anon;
grant execute on function
  public.create_mcp_token(text, text, text, text),
  public.regenerate_mcp_token(uuid, text, text, text),
  public.revoke_mcp_token(uuid)
to authenticated;

revoke all on function public.authenticate_mcp_token(text) from public, anon, authenticated;
grant execute on function public.authenticate_mcp_token(text) to service_role;

comment on function public.create_mcp_token(text, text, text, text) is
  'Creates a personal MCP token for the caller and returns it without the hash. Expiry is 1m, 3m, 6m or never. 42501 for kids, 22023 for another expiry, P0001 at 10 live tokens, 23514 for a bad name, hash or prefix.';
comment on function public.regenerate_mcp_token(uuid, text, text, text) is
  'Replaces the hash, prefix and expiry of one of the caller''s unrevoked tokens, sets regenerated_at and clears last_used_at. 42501 for kids, 22023 for a bad expiry, P0001 at the cap, P0002 for an unknown, revoked or other user''s token.';
comment on function public.revoke_mcp_token(uuid) is
  'Revokes one of the caller''s unrevoked tokens (expired ones included). False for an unknown, already revoked or other user''s token.';
comment on function public.authenticate_mcp_token(text) is
  'Checks a personal MCP token by hash: unknown, revoked, expired, kid_token, mcp_off, not_permitted, email_required or ok (with the owner''s email). Bumps last_used_at at most every 5 minutes. service_role only.';

commit;
