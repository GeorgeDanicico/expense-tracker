begin;

-- Phase 1 (F06): who can read what in a family.
--
-- 1. Helpers in family_private that answer questions about the caller:
--    my_family_id(), is_parent(family_id), is_creator(family_id) and
--    member_level(module). Policies and later RPCs build on them.
-- 2. Select policies on families, family_members and member_permissions.
--    Writes still have no grant at all; they go through RPCs (F07 on).
-- 3. Two read RPCs for the app: get_my_membership() and get_family().
--
-- Conventions every later family task copies:
-- * The caller is always app_private.current_user_id(), never auth.uid().
-- * Helpers and RPCs are security definer with set search_path = '' and fully
--   qualified names. Security definer functions run as their owner, who isn't
--   subject to RLS, so a policy on family_members can call a helper that reads
--   family_members without recursing into that same policy.
-- * Policies wrap each helper call in a sub-select, such as
--   (select family_private.my_family_id()), so Postgres runs it once per
--   query (an InitPlan) instead of once per row.
-- * Every function revokes all from public and anon, then grants execute to
--   authenticated only.

-- ---------------------------------------------------------------------------
-- Private building blocks (no grants: only the functions below call them, and
-- security definer functions call them as their owner).
-- ---------------------------------------------------------------------------

-- The module keys of the permission catalogue, in catalogue order. Must match
-- MODULE_KEYS in src/lib/permissions.ts and the member_permissions_level_allowed
-- check from F03. Change all three together.
create function family_private.module_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['expenses', 'investments', 'net_worth', 'family_finance']
$$;

-- A member's permissions as a JSON object with every module key.
-- * Kid: { "expenses": "edit", "investments": "off", ... }. A module without a
--   member_permissions row is "off".
-- * Parent: null. Parents have no permission rows and pass every check (see
--   can() in src/lib/permissions.ts), and "edit" isn't a level every module
--   allows (family_finance stops at "view"), so an all-"edit" object would not
--   fit the catalogue. A null here always means "parent".
-- * Unknown member: null.
-- This reads any member's rows, so it must stay ungranted: callers check that
-- the caller may see this member first.
create function family_private.member_permissions_json(p_member_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when m.role = 'kid' then (
    select jsonb_object_agg(k.module, coalesce(p.level, 'off'))
    from unnest(family_private.module_keys()) as k(module)
    left join public.member_permissions p
      on p.member_id = m.id
     and p.module = k.module
  ) end
  from public.family_members m
  where m.id = p_member_id
$$;

-- ---------------------------------------------------------------------------
-- Helpers about the caller (granted to authenticated, for use in policies).
--
-- Parameter names match the shared names in docs/family-phase-1-tasks.md.
-- Where a parameter shares its name with a column, the body qualifies the
-- parameter with the function name (is_parent.family_id) and the column with a
-- table alias (m.family_id), so neither is ambiguous.
-- ---------------------------------------------------------------------------

-- The caller's family id, or null when the caller has no family (or no user).
create function family_private.my_family_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
$$;

-- Whether the caller is a parent in the given family. False for a null family.
create function family_private.is_parent(family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members m
    where m.user_id = app_private.current_user_id()
      and m.family_id = is_parent.family_id
      and m.role = 'parent'
  )
$$;

-- Whether the caller created the given family. False for a null family. F05
-- guarantees the creator is also a parent member of it.
create function family_private.is_creator(family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.families f
    where f.id = is_creator.family_id
      and f.creator_id = app_private.current_user_id()
  )
$$;

-- The caller's level for a module:
-- * parent: 'edit' for every module (parents pass every check);
-- * kid: the stored level, or 'off' when there is no row;
-- * no family: null. "No family passes every check" is the app's rule for the
--   caller's own data, so each caller decides what null means for it.
-- An unknown module raises 23514, so a typo in a policy fails loudly instead
-- of quietly reading as 'off'.
create function family_private.member_level(module text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_member_id uuid;
  caller_role text;
  stored_level text;
begin
  if member_level.module is null
    or not (member_level.module = any (family_private.module_keys()))
  then
    raise exception 'Unknown module: %', member_level.module
      using errcode = '23514';
  end if;

  select m.id, m.role into caller_member_id, caller_role
  from public.family_members m
  where m.user_id = app_private.current_user_id();

  if not found then
    return null;
  end if;

  if caller_role = 'parent' then
    return 'edit';
  end if;

  select p.level into stored_level
  from public.member_permissions p
  where p.member_id = caller_member_id
    and p.module = member_level.module;

  return coalesce(stored_level, 'off');
end;
$$;

revoke all on function
  family_private.module_keys(),
  family_private.member_permissions_json(uuid),
  family_private.my_family_id(),
  family_private.is_parent(uuid),
  family_private.is_creator(uuid),
  family_private.member_level(text)
from public, anon, authenticated, service_role;

grant execute on function
  family_private.my_family_id(),
  family_private.is_parent(uuid),
  family_private.is_creator(uuid),
  family_private.member_level(text)
to authenticated;

comment on function family_private.module_keys() is
  'The permission catalogue''s module keys. Mirrors MODULE_KEYS in src/lib/permissions.ts.';
comment on function family_private.member_permissions_json(uuid) is
  'A kid''s permissions with every module (missing rows are off); null for a parent. Ungranted: callers check visibility first.';
comment on function family_private.my_family_id() is
  'The caller''s family id, or null without a family.';
comment on function family_private.is_parent(uuid) is
  'Whether the caller is a parent in the given family.';
comment on function family_private.is_creator(uuid) is
  'Whether the caller created the given family.';
comment on function family_private.member_level(text) is
  'The caller''s level for a module: edit for parents, the stored level or off for kids, null without a family. Unknown modules raise 23514.';

-- ---------------------------------------------------------------------------
-- Read policies. Select only: there are no write grants on these tables.
-- ---------------------------------------------------------------------------

-- Members see their own family.
create policy families_select_member on public.families
for select to authenticated
using (id = (select family_private.my_family_id()));

-- Members see every membership in their family, their own included.
create policy family_members_select_member on public.family_members
for select to authenticated
using (family_id = (select family_private.my_family_id()));

-- Parents see every kid's permissions in their family; kids see only their
-- own. The sub-select on family_members runs under that table's policy, which
-- already limits it to the caller's family.
create policy member_permissions_select_family on public.member_permissions
for select to authenticated
using (
  member_id in (
    select m.id
    from public.family_members m
    where m.family_id = (select family_private.my_family_id())
      and (
        m.user_id = (select app_private.current_user_id())
        or (select family_private.is_parent(family_private.my_family_id()))
      )
  )
);

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

-- The caller's membership: zero rows without a family, otherwise one row.
-- permissions follows family_private.member_permissions_json: every module for
-- a kid, null for a parent.
create function public.get_my_membership()
returns table (
  member_id uuid,
  family_id uuid,
  family_name text,
  role text,
  is_creator boolean,
  permissions jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.family_id,
    f.name,
    m.role,
    f.creator_id = m.user_id,
    family_private.member_permissions_json(m.id)
  from public.family_members m
  join public.families f on f.id = m.family_id
  where m.user_id = app_private.current_user_id()
$$;

-- The caller's family and its members, or null without a family:
--
-- {
--   "family": { "id", "name", "createdAt" },
--   "members": [{
--     "memberId", "userId", "role", "isCreator",
--     "displayName", "username", "joinedAt",
--     "lastActiveAt", "permissions"     -- only when visible, see below
--   }]
-- }
--
-- * displayName: profiles.display_name, else profiles.username, else the part
--   of auth.users.email before the '@'. The profile row may be missing.
-- * lastActiveAt and permissions: a parent gets both keys for every member; a
--   kid gets them only on their own entry. When not visible the keys are left
--   out entirely (not null), so a missing key always means "hidden".
-- * permissions: every module for a kid (missing rows are "off"); null for a
--   parent, who has no permission rows and passes every check.
-- * Members are ordered creator first, then the other parents, then kids,
--   each group by joinedAt.
-- * Timestamps are ISO 8601 strings with an offset.
create function public.get_family()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'family', jsonb_build_object(
      'id', f.id,
      'name', f.name,
      'createdAt', f.created_at
    ),
    'members', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'memberId', m.id,
          'userId', m.user_id,
          'role', m.role,
          'isCreator', m.user_id = f.creator_id,
          'displayName', coalesce(
            p.display_name,
            p.username,
            nullif(split_part(u.email, '@', 1), '')
          ),
          'username', p.username,
          'joinedAt', m.joined_at
        )
        || case
          when caller.role = 'parent' or m.id = caller.id then jsonb_build_object(
            'lastActiveAt', m.last_active_at,
            'permissions', family_private.member_permissions_json(m.id)
          )
          else '{}'::jsonb
        end
        order by m.user_id = f.creator_id desc, m.role = 'parent' desc, m.joined_at, m.id
      ), '[]'::jsonb)
      from public.family_members m
      left join public.profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.family_id = f.id
    )
  )
  from public.family_members caller
  join public.families f on f.id = caller.family_id
  where caller.user_id = app_private.current_user_id()
$$;

revoke all on function public.get_my_membership(), public.get_family()
  from public, anon;
grant execute on function public.get_my_membership(), public.get_family()
  to authenticated;

comment on function public.get_my_membership() is
  'The caller''s membership (0 or 1 rows). permissions has every module for a kid and is null for a parent.';
comment on function public.get_family() is
  'The caller''s family and members as camelCase JSON, or null without a family. lastActiveAt and permissions appear for every member to parents, and only on their own entry to kids.';

commit;
