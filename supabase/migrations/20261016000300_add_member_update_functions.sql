begin;

-- Phase 1 (F10): two writes on a family membership.
--
-- 1. set_member_permissions(p_member_id, p_permissions): a parent replaces a
--    kid's permission rows in their own family.
-- 2. touch_last_active(): the caller's family_members.last_active_at, written
--    at most once every 5 minutes.
--
-- Same conventions as F06 (20261015230000_add_family_read_access.sql):
-- security definer, set search_path = '', fully qualified names, the caller is
-- app_private.current_user_id(), and execute is granted to authenticated only.

-- ---------------------------------------------------------------------------
-- Private building block (no grants: only security definer code calls it).
-- ---------------------------------------------------------------------------

-- Whether p_permissions is a complete permissions object from the catalogue:
-- a JSON object with exactly the keys of family_private.module_keys(), each a
-- string level that module allows. False for null and for anything that isn't
-- an object.
--
-- The (module, level) pairs must match MODULE_LEVELS in src/lib/permissions.ts
-- and the member_permissions_level_allowed check from F03, which stays the
-- backstop. Change all three together.
create function family_private.is_valid_permissions(p_permissions jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then
    return false;
  end if;

  return (
    select coalesce(array_agg(k.key order by k.key), '{}')
    from jsonb_object_keys(p_permissions) as k(key)
  ) = (
    select array_agg(k.module order by k.module)
    from unnest(family_private.module_keys()) as k(module)
  )
  and not exists (
    select 1
    from jsonb_each(p_permissions) as e(module, level)
    where jsonb_typeof(e.level) <> 'string'
      or (e.module, e.level #>> '{}') not in (
        ('expenses', 'off'),
        ('expenses', 'edit'),
        ('investments', 'off'),
        ('investments', 'edit'),
        ('net_worth', 'off'),
        ('net_worth', 'edit'),
        ('family_finance', 'off'),
        ('family_finance', 'view')
      )
  );
end;
$$;

revoke all on function family_private.is_valid_permissions(jsonb)
  from public, anon, authenticated, service_role;

comment on function family_private.is_valid_permissions(jsonb) is
  'Whether a permissions object has every module key and only levels the catalogue allows. Mirrors MODULE_LEVELS in src/lib/permissions.ts.';

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

-- A parent replaces a kid's permissions in their own family. p_permissions
-- must list every module (see family_private.is_valid_permissions); all four
-- rows are written, so the kid's permissions afterwards are exactly the JSON.
--
-- Errors, checked in this order:
-- * 42501 when the caller isn't a parent (a kid, or no family). This comes
--   before looking at the target, so a kid learns nothing about member ids.
-- * P0002 when the member doesn't exist or is in another family. Both get the
--   same error, so a parent can't probe other families.
-- * 42501 when the target is a parent: parents have no permission rows.
-- * 23514 when the JSON isn't a complete, valid permissions object.
create function public.set_member_permissions(p_member_id uuid, p_permissions jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_family_id uuid;
  target_role text;
begin
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent';

  if not found then
    raise exception 'Only parents can change a kid''s permissions.'
      using errcode = '42501';
  end if;

  -- Lock the kid's membership so two parents saving at the same time apply
  -- one after the other, instead of both deleting and then both inserting.
  -- It also holds off a concurrent role change or removal until we commit.
  select m.role into target_role
  from public.family_members m
  where m.id = p_member_id
    and m.family_id = caller_family_id
  for no key update;

  if not found then
    raise exception 'That family member wasn''t found.'
      using errcode = 'P0002';
  end if;

  if target_role <> 'kid' then
    raise exception 'Parents always have full access, so their permissions can''t be changed.'
      using errcode = '42501';
  end if;

  if not family_private.is_valid_permissions(p_permissions) then
    raise exception 'Choose an allowed level for every module.'
      using errcode = '23514';
  end if;

  delete from public.member_permissions p
  where p.member_id = p_member_id;

  insert into public.member_permissions (member_id, module, level)
  select p_member_id, e.module, e.level
  from jsonb_each_text(p_permissions) as e(module, level);
end;
$$;

-- Marks the caller as active. Writes only when last_active_at is null or more
-- than 5 minutes old, so most calls change nothing: the update finds the row
-- through the unique index on user_id, the filter rejects it, and no new row
-- version is written. Callers without a family match no row and nothing
-- happens. now() is the transaction's start time.
create function public.touch_last_active()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.family_members m
  set last_active_at = now()
  where m.user_id = app_private.current_user_id()
    and (m.last_active_at is null or m.last_active_at < now() - interval '5 minutes')
$$;

revoke all on function
  public.set_member_permissions(uuid, jsonb),
  public.touch_last_active()
from public, anon;
grant execute on function
  public.set_member_permissions(uuid, jsonb),
  public.touch_last_active()
to authenticated;

comment on function public.set_member_permissions(uuid, jsonb) is
  'A parent replaces a kid''s permissions in their own family. 42501 for a non-parent caller or a parent target, P0002 for an unknown or other-family member, 23514 for invalid permissions.';
comment on function public.touch_last_active() is
  'Sets the caller''s last_active_at to now() when it is null or more than 5 minutes old. Does nothing without a family.';

commit;
