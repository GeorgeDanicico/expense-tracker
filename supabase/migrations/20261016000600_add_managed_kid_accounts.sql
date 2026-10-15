begin;

-- Phase 1 (F13): kid accounts that a parent creates and manages.
--
-- 1. profiles.managed_by_family: the family an account was created for. The
--    server's admin implementation (F28) sets it when it creates the account,
--    and add_managed_kid() only adds an account marked for the caller's family.
-- 2. profiles.must_change_password: the account has to choose a new password
--    before using the app (F31). Set by F28 on create and by
--    require_password_change() (F32); cleared by complete_password_change().
-- 3. A trigger stops the API roles from setting or changing either column.
-- 4. Three RPCs: add_managed_kid, complete_password_change and
--    require_password_change.
--
-- Kid-account state lives here rather than in the auth provider's metadata, so
-- it survives a change of auth provider. Same conventions as F07 and F10:
-- security definer, set search_path = '', fully qualified names, the caller is
-- app_private.current_user_id(), execute granted to authenticated only, and
-- error messages written for users.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column managed_by_family uuid references public.families(id) on delete set null,
  add column must_change_password boolean not null default false;

-- Deleting a family sets the column to null on its kids' profiles; the index
-- keeps that lookup cheap. Most profiles are not managed, so it is partial.
create index profiles_managed_by_family_idx
  on public.profiles (managed_by_family)
  where managed_by_family is not null;

comment on column public.profiles.managed_by_family is
  'The family this account was created for by a parent (a managed kid account). Set only by the server; signed-in users cannot change it.';
comment on column public.profiles.must_change_password is
  'Whether the account must choose a new password before using the app. Set by the server and require_password_change(), cleared by complete_password_change().';

-- ---------------------------------------------------------------------------
-- Guard: the API roles can't set or change either column
-- ---------------------------------------------------------------------------

-- A sibling of F04's guard_profile_username(), and security invoker for the
-- same reason: `current_user` is what tells the API roles ('authenticated',
-- 'anon') apart from trusted writers (the service role, migrations, foreign-key
-- actions and security definer functions, which run as their owner).
--
-- * Insert: both columns must keep their defaults (null and false).
-- * Update: both columns must stay as they are.
-- * Delete: the existing owner policy lets a user delete their own profile.
--   Deleting a row that carries either flag and inserting it again would reset
--   both, so the API roles can't delete such a row.
create function public.guard_profile_managed_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.managed_by_family is not null or old.must_change_password then
      raise exception 'Kid accounts can only be removed by the server.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if new.managed_by_family is distinct from (
      case when tg_op = 'UPDATE' then old.managed_by_family else null end
    )
    or new.must_change_password is distinct from (
      case when tg_op = 'UPDATE' then old.must_change_password else false end
    )
  then
    raise exception 'Kid account settings can only be changed by the server.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_profile_managed_account() from public, anon, authenticated;

create trigger profiles_guard_managed_account
before insert or delete or update of managed_by_family, must_change_password
on public.profiles
for each row execute function public.guard_profile_managed_account();

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

-- A parent adds an account created for their family (F29) as a kid, with the
-- given permissions, and gets the new member id. Only accounts whose
-- profiles.managed_by_family is the caller's family qualify, so a parent can't
-- add an arbitrary existing user as their kid.
--
-- Errors, checked in this order:
-- * 42501 when the caller isn't a parent (a kid, or no family).
-- * P0002 when the account isn't marked for the caller's family. An unknown
--   user, an unmarked account and one marked for another family all get the
--   same error, so a parent learns nothing about other accounts.
-- * 23505 when the account is already in a family.
-- * 23514 when the JSON isn't a complete, valid permissions object.
create function public.add_managed_kid(p_user_id uuid, p_permissions jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_family_id uuid;
  new_member_id uuid;
begin
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent';

  if not found then
    raise exception 'Only parents can add a kid.'
      using errcode = '42501';
  end if;

  -- Lock the profile so the marking can't change before we commit.
  perform 1
  from public.profiles p
  where p.id = p_user_id
    and p.managed_by_family = caller_family_id
  for share;

  if not found then
    raise exception 'That account wasn''t found.'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.family_members m
    where m.user_id = p_user_id
  ) then
    raise exception 'That account is already in a family.'
      using errcode = '23505';
  end if;

  if not family_private.is_valid_permissions(p_permissions) then
    raise exception 'Choose an allowed level for every module.'
      using errcode = '23514';
  end if;

  -- Two calls at once can both pass the check above. The unique user_id on
  -- family_members then refuses the second; give it the same message.
  begin
    insert into public.family_members (family_id, user_id, role)
    values (caller_family_id, p_user_id, 'kid')
    returning id into new_member_id;
  exception
    when unique_violation then
      raise exception 'That account is already in a family.'
        using errcode = '23505';
  end;

  insert into public.member_permissions (member_id, module, level)
  select new_member_id, e.module, e.level
  from jsonb_each_text(p_permissions) as e(module, level);

  return new_member_id;
end;
$$;

-- The caller has chosen a new password (F31). Clears the caller's own flag and
-- touches no other row. Idempotent: an unset flag is left alone (no new row
-- version), and a caller without a profile row matches nothing.
create function public.complete_password_change()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.profiles p
  set must_change_password = false
  where p.id = app_private.current_user_id()
    and p.must_change_password
$$;

-- A parent requires a kid in their family to choose a new password, and gets
-- the kid's user id. F32 calls it as the parent before resetting the kid's
-- password with the admin client, so it doubles as the permission check. A kid
-- without a profile row gets one, so the flag always sticks.
--
-- Errors, checked in this order (the same as set_member_permissions):
-- * 42501 when the caller isn't a parent (a kid, or no family).
-- * P0002 when the member doesn't exist or is in another family.
-- * 42501 when the target is a parent.
create function public.require_password_change(p_member_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_family_id uuid;
  target_role text;
  target_user_id uuid;
begin
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent';

  if not found then
    raise exception 'Only parents can reset a kid''s password.'
      using errcode = '42501';
  end if;

  -- Hold off a concurrent role change or removal until we commit.
  select m.role, m.user_id into target_role, target_user_id
  from public.family_members m
  where m.id = p_member_id
    and m.family_id = caller_family_id
  for no key update;

  if not found then
    raise exception 'That family member wasn''t found.'
      using errcode = 'P0002';
  end if;

  if target_role <> 'kid' then
    raise exception 'Only a kid''s password can be reset.'
      using errcode = '42501';
  end if;

  insert into public.profiles (id, must_change_password)
  values (target_user_id, true)
  on conflict (id) do update
  set must_change_password = true;

  return target_user_id;
end;
$$;

revoke all on function
  public.add_managed_kid(uuid, jsonb),
  public.complete_password_change(),
  public.require_password_change(uuid)
from public, anon;
grant execute on function
  public.add_managed_kid(uuid, jsonb),
  public.complete_password_change(),
  public.require_password_change(uuid)
to authenticated;

comment on function public.add_managed_kid(uuid, jsonb) is
  'A parent adds an account marked for their family as a kid and gets the member id. 42501 for a non-parent caller, P0002 for an account not marked for the caller''s family, 23505 when it is already in a family, 23514 for invalid permissions.';
comment on function public.complete_password_change() is
  'Clears the caller''s own must_change_password. Idempotent; does nothing without a profile row.';
comment on function public.require_password_change(uuid) is
  'A parent sets must_change_password on a kid in their family and gets the kid''s user id. 42501 for a non-parent caller or a parent target, P0002 for an unknown or other-family member.';

commit;
