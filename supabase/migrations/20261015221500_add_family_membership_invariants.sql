begin;

-- Phase 1 (F05): invariants on families and their members that hold no matter
-- how a row is written (RPCs, the service role or a migration).
--
-- 1. A membership never moves: family_members.family_id and user_id are fixed.
-- 2. A family's creator has a parent membership in it (deferred check, so
--    create_family can insert the family and then the membership).
-- 3. The creator's membership can't be deleted or demoted, except when the
--    whole family is deleted.
-- 4. member_permissions rows exist only for kid members.
--
-- Violations raise 23514 (check_violation). The trigger functions are
-- security definer so RLS policies (F06 on) never hide the rows they check.

-- 1. family_id and user_id never change.
create function family_private.prevent_membership_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.family_id is distinct from old.family_id or new.user_id is distinct from old.user_id then
    raise exception 'A membership''s family and user cannot change.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger family_members_prevent_move
before update of family_id, user_id on public.family_members
for each row execute function family_private.prevent_membership_move();

-- 2. The creator must have a parent membership in the family. Checked at
-- commit, against the row as it is then: a family deleted later in the same
-- transaction passes. Deleting or demoting that membership afterwards is
-- refused by rule 3, and the membership can't move (rule 1).
create function family_private.check_creator_is_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_creator uuid;
begin
  select f.creator_id into current_creator
  from public.families f
  where f.id = new.id;

  if found and not exists (
    select 1
    from public.family_members m
    where m.family_id = new.id
      and m.user_id = current_creator
      and m.role = 'parent'
  ) then
    raise exception 'A family''s creator must be a parent in that family.'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger families_creator_is_parent
after insert or update of creator_id on public.families
deferrable initially deferred
for each row execute function family_private.check_creator_is_parent();

-- 3. The creator's membership can't be deleted or demoted.
--
-- Deleting a family cascades to family_members, and that cascade has to be
-- allowed to remove the creator's membership too. The cascade runs after the
-- families row is gone, so this trigger looks the family up: if it no longer
-- exists, the whole family is being deleted and the delete is allowed. This is
-- more precise than pg_trigger_depth(), which would also let through a delete
-- issued from any other trigger or a cascade from somewhere else.
--
-- The same goes for deleting the creator's auth.users row, which cascades to
-- family_members: if the user is gone, let the cascade through. The
-- families.creator_id foreign key (on delete restrict) refuses that delete
-- anyway, with 23503, whichever of the two foreign-key actions runs first.
create function family_private.protect_creator_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (old.role <> 'parent' or new.role = 'parent') then
    return new;
  end if;

  if exists (
    select 1
    from public.families f
    where f.id = old.family_id
      and f.creator_id = old.user_id
  ) and (
    tg_op = 'UPDATE'
    or exists (select 1 from auth.users u where u.id = old.user_id)
  ) then
    raise exception 'The family creator''s membership cannot be removed or demoted.'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger family_members_protect_creator
before delete or update of role on public.family_members
for each row execute function family_private.protect_creator_membership();

-- 4. Permission rows only for kids, checked from both sides. Locking the
-- member row (for share) makes an insert wait for a concurrent role change,
-- and the role change waits for that lock in turn, so neither can slip past
-- the other.
create function family_private.require_kid_for_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_role text;
begin
  select m.role into member_role
  from public.family_members m
  where m.id = new.member_id
  for share;

  -- A missing member is left to the foreign key, which reports it as 23503.
  if found and member_role <> 'kid' then
    raise exception 'Only kids have module permissions.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger member_permissions_require_kid
before insert or update of member_id on public.member_permissions
for each row execute function family_private.require_kid_for_permissions();

create function family_private.prevent_kid_promotion_with_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'kid' and new.role <> 'kid' and exists (
    select 1 from public.member_permissions p where p.member_id = old.id
  ) then
    raise exception 'Delete a kid''s permissions before changing their role.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger family_members_kid_permissions
before update of role on public.family_members
for each row execute function family_private.prevent_kid_promotion_with_permissions();

-- Trigger functions run without an EXECUTE grant; nobody calls them directly.
revoke all on function
  family_private.prevent_membership_move(),
  family_private.check_creator_is_parent(),
  family_private.protect_creator_membership(),
  family_private.require_kid_for_permissions(),
  family_private.prevent_kid_promotion_with_permissions()
from public, anon, authenticated, service_role;

comment on trigger families_creator_is_parent on public.families is
  'Deferred: at commit, the creator must have a parent membership in the family.';
comment on trigger family_members_protect_creator on public.family_members is
  'The creator''s membership cannot be deleted or demoted, except by deleting the whole family.';

commit;
