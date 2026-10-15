begin;

-- Phase 1 (F12): the creator removes a member or deletes the whole family.
--
-- 1. remove_family_member(p_member_id): deletes one membership (its
--    permission rows cascade) and leaves the removed user a
--    removed_from_family notice.
-- 2. delete_family(p_confirm_name): leaves every member except the creator a
--    family_deleted notice, then deletes the family. Memberships, permissions
--    (and later invites and other family rows) cascade. Personal finance rows
--    belong to users, not families, so they are untouched.
--
-- Notices (F11) are written in the same transaction as the removal or the
-- deletion, so either both happen or neither does.
--
-- Same conventions as F06 (20261015230000_add_family_read_access.sql):
-- security definer, set search_path = '', fully qualified names, the caller is
-- app_private.current_user_id(), and execute is granted to authenticated only.
-- Messages reach the UI through translateDatabaseError, so they are written
-- for users.
--
-- Locking: both functions lock the caller's families row first.
-- delete_family takes it for update and remove_family_member for share, so a
-- removal and a deletion of the same family run one after the other: the
-- deletion then never writes a family_deleted notice for a member who was
-- just removed, and a removal waiting on a deletion finds no family. Any
-- membership insert (which checks the families foreign key) also waits for
-- the deletion, so a member who joins at that moment either gets a notice or
-- finds no family.

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

-- The creator removes a member of their family. The removed user keeps their
-- account and their own data, and gets a removed_from_family notice.
--
-- Errors, checked in this order:
-- * 42501 when the caller isn't the family's creator (a second parent, a kid,
--   no family, or no caller). This comes before looking at the target, so a
--   non-creator learns nothing about member ids.
-- * P0002 when the member doesn't exist or is in another family. Both get the
--   same error, so the creator can't probe other families.
-- * 42501 when the target is the creator: the creator leaves only by deleting
--   the family. F05's family_members_protect_creator trigger is the backstop.
create function public.remove_family_member(p_member_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  caller_family_id uuid;
  caller_family_name text;
  target_user_id uuid;
begin
  select f.id, f.name into caller_family_id, caller_family_name
  from public.families f
  where f.creator_id = caller_id
  for share;

  if not found then
    raise exception 'Only the family''s creator can remove members.'
      using errcode = '42501';
  end if;

  -- Lock the membership before deleting it, so a concurrent
  -- set_member_permissions (which locks it for no key update) and this
  -- removal apply one after the other. "For update" is the lock the delete
  -- takes anyway; taking it here avoids upgrading a weaker lock later.
  select m.user_id into target_user_id
  from public.family_members m
  where m.id = p_member_id
    and m.family_id = caller_family_id
  for update;

  if not found then
    raise exception 'That family member wasn''t found.'
      using errcode = 'P0002';
  end if;

  if target_user_id = caller_id then
    raise exception 'You can''t remove yourself from a family you created. Delete the family instead.'
      using errcode = '42501';
  end if;

  delete from public.family_members m
  where m.id = p_member_id;

  insert into public.account_notices (user_id, kind, family_name)
  values (target_user_id, 'removed_from_family', caller_family_name);
end;
$$;

-- The creator deletes their family. p_confirm_name must be the family's name,
-- ignoring case and surrounding whitespace. Every other member gets a
-- family_deleted notice carrying the name, then the family row is deleted and
-- everything that belongs to it cascades. F05's
-- family_members_protect_creator trigger lets the creator's membership go
-- because the family itself is gone by then.
--
-- Errors, checked in this order:
-- * 42501 when the caller isn't the family's creator (a second parent, a kid,
--   no family, or no caller).
-- * 23514 when p_confirm_name doesn't match the family name.
create function public.delete_family(p_confirm_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  caller_family_id uuid;
  caller_family_name text;
  -- Trim every kind of whitespace, as create_family does for the name.
  typed_name text := regexp_replace(p_confirm_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  select f.id, f.name into caller_family_id, caller_family_name
  from public.families f
  where f.creator_id = caller_id
  for update;

  if not found then
    raise exception 'Only the family''s creator can delete the family.'
      using errcode = '42501';
  end if;

  if typed_name is null or lower(typed_name) <> lower(caller_family_name) then
    raise exception 'Type the family''s name to confirm.'
      using errcode = '23514';
  end if;

  insert into public.account_notices (user_id, kind, family_name)
  select m.user_id, 'family_deleted', caller_family_name
  from public.family_members m
  where m.family_id = caller_family_id
    and m.user_id <> caller_id;

  delete from public.families f
  where f.id = caller_family_id;
end;
$$;

revoke all on function
  public.remove_family_member(uuid),
  public.delete_family(text)
from public, anon;
grant execute on function
  public.remove_family_member(uuid),
  public.delete_family(text)
to authenticated;

comment on function public.remove_family_member(uuid) is
  'The creator removes a member of their family and leaves them a removed_from_family notice. 42501 for a non-creator caller or the creator themselves, P0002 for an unknown or other-family member.';
comment on function public.delete_family(text) is
  'The creator deletes their family after typing its name (case and surrounding whitespace ignored). Every other member gets a family_deleted notice. 42501 for a non-creator caller, 23514 for a wrong name.';

commit;
