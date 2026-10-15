begin;
create extension if not exists pgtap;
select plan(89);

-- F06: the family_private helpers, the read policies, get_my_membership() and
-- get_family().
--
-- Users (prefix f0600000):
--   family A: 01 creator (display name "Ana"), 02 second parent (username
--             only), 03 kid (no profile row: falls back to the email), 04 kid
--             (display name and username)
--   family B: 05 creator, 06 second parent, 07 kid, 08 kid
--   09 has no family.
-- Member ids: a2..a5 in family a1, b2..b5 in family b1, in user order.
-- Timestamps are fixed and the time zone is UTC, so get_family() can be
-- compared as whole JSON documents.
set local timezone = 'UTC';

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f0600000-0000-4000-8000-000000000001', 'fam-a-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0600000-0000-4000-8000-000000000002', 'fam-a-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0600000-0000-4000-8000-000000000003', 'fam-a-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0600000-0000-4000-8000-000000000004', 'fam-a-kid-two@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0600000-0000-4000-8000-000000000005', 'fam-b-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0600000-0000-4000-8000-000000000006', 'fam-b-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0600000-0000-4000-8000-000000000007', 'fam-b-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0600000-0000-4000-8000-000000000008', 'fam-b-kid-two@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0600000-0000-4000-8000-000000000009', 'no-family@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

-- Setup as the table owner (usernames can only be set by trusted roles).
insert into public.profiles (id, email, username, display_name)
values
  ('f0600000-0000-4000-8000-000000000001', 'fam-a-creator@example.test', null, 'Ana'),
  ('f0600000-0000-4000-8000-000000000002', 'fam-a-parent@example.test', 'bogdan.p', null),
  ('f0600000-0000-4000-8000-000000000004', 'fam-a-kid-two@example.test', 'kid.two', 'Kid Two'),
  ('f0600000-0000-4000-8000-000000000005', 'fam-b-creator@example.test', null, 'Bianca'),
  ('f0600000-0000-4000-8000-000000000006', 'fam-b-parent@example.test', null, null);

insert into public.families (id, name, creator_id, created_at) values
  ('f0600000-0000-4000-8000-0000000000a1', 'Family A', 'f0600000-0000-4000-8000-000000000001', '2026-01-01 08:00:00+00'),
  ('f0600000-0000-4000-8000-0000000000b1', 'Family B', 'f0600000-0000-4000-8000-000000000005', '2026-02-01 08:00:00+00');

-- In family A the kid 03 joins before the second parent 02, so the order of
-- get_family() (creator, parents, kids) differs from the join order.
insert into public.family_members (id, family_id, user_id, role, joined_at, last_active_at) values
  ('f0600000-0000-4000-8000-0000000000a2', 'f0600000-0000-4000-8000-0000000000a1', 'f0600000-0000-4000-8000-000000000001', 'parent', '2026-01-01 09:00:00+00', '2026-10-01 08:00:00+00'),
  ('f0600000-0000-4000-8000-0000000000a3', 'f0600000-0000-4000-8000-0000000000a1', 'f0600000-0000-4000-8000-000000000002', 'parent', '2026-01-03 09:00:00+00', null),
  ('f0600000-0000-4000-8000-0000000000a4', 'f0600000-0000-4000-8000-0000000000a1', 'f0600000-0000-4000-8000-000000000003', 'kid', '2026-01-02 09:00:00+00', '2026-10-02 08:00:00+00'),
  ('f0600000-0000-4000-8000-0000000000a5', 'f0600000-0000-4000-8000-0000000000a1', 'f0600000-0000-4000-8000-000000000004', 'kid', '2026-01-04 09:00:00+00', '2026-10-03 08:00:00+00'),
  ('f0600000-0000-4000-8000-0000000000b2', 'f0600000-0000-4000-8000-0000000000b1', 'f0600000-0000-4000-8000-000000000005', 'parent', '2026-02-01 09:00:00+00', '2026-10-04 08:00:00+00'),
  ('f0600000-0000-4000-8000-0000000000b3', 'f0600000-0000-4000-8000-0000000000b1', 'f0600000-0000-4000-8000-000000000006', 'parent', '2026-02-02 09:00:00+00', null),
  ('f0600000-0000-4000-8000-0000000000b4', 'f0600000-0000-4000-8000-0000000000b1', 'f0600000-0000-4000-8000-000000000007', 'kid', '2026-02-03 09:00:00+00', null),
  ('f0600000-0000-4000-8000-0000000000b5', 'f0600000-0000-4000-8000-0000000000b1', 'f0600000-0000-4000-8000-000000000008', 'kid', '2026-02-04 09:00:00+00', null);

-- Kid 03 has two rows, kid 04 one, kid 07 one and kid 08 none (all off).
insert into public.member_permissions (member_id, module, level) values
  ('f0600000-0000-4000-8000-0000000000a4', 'expenses', 'edit'),
  ('f0600000-0000-4000-8000-0000000000a4', 'family_finance', 'view'),
  ('f0600000-0000-4000-8000-0000000000a5', 'investments', 'edit'),
  ('f0600000-0000-4000-8000-0000000000b4', 'net_worth', 'edit');

-- Returns the EXPLAIN output of a query as one string, to check how the
-- policies are planned for the current role.
create function pg_temp.plan_of(p_query text)
returns text
language plpgsql
as $$
declare
  line record;
  result text := '';
begin
  for line in execute 'explain ' || p_query loop
    result := result || line."QUERY PLAN" || E'\n';
  end loop;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from pg_catalog.pg_proc p
   where p.oid in (
       'family_private.my_family_id()'::regprocedure,
       'family_private.is_parent(uuid)'::regprocedure,
       'family_private.is_creator(uuid)'::regprocedure,
       'family_private.member_level(text)'::regprocedure,
       'family_private.member_permissions_json(uuid)'::regprocedure,
       'public.get_my_membership()'::regprocedure,
       'public.get_family()'::regprocedure
     )
     and p.prosecdef
     and p.provolatile = 's'
     and p.proconfig = array['search_path=""']),
  7,
  'the helpers and RPCs are security definer, stable and pin an empty search_path'
);
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_catalog.pg_proc p
   where p.oid in (
       'family_private.my_family_id()'::regprocedure,
       'family_private.is_parent(uuid)'::regprocedure,
       'family_private.is_creator(uuid)'::regprocedure,
       'family_private.member_level(text)'::regprocedure,
       'public.get_my_membership()'::regprocedure,
       'public.get_family()'::regprocedure
     )
     and has_function_privilege('authenticated', p.oid, 'execute')),
  array['get_family', 'get_my_membership', 'is_creator', 'is_parent', 'member_level', 'my_family_id'],
  'authenticated can execute the four helpers and the two RPCs'
);
select is(
  (select count(*)::integer from pg_catalog.pg_proc p
   where p.oid in (
       'family_private.my_family_id()'::regprocedure,
       'family_private.is_parent(uuid)'::regprocedure,
       'family_private.is_creator(uuid)'::regprocedure,
       'family_private.member_level(text)'::regprocedure,
       'family_private.member_permissions_json(uuid)'::regprocedure,
       'family_private.module_keys()'::regprocedure,
       'public.get_my_membership()'::regprocedure,
       'public.get_family()'::regprocedure
     )
     and has_function_privilege('anon', p.oid, 'execute')),
  0,
  'anon can execute none of the family functions'
);
select ok(
  not has_function_privilege('authenticated', 'family_private.member_permissions_json(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'family_private.module_keys()', 'execute'),
  'the internal building blocks are not granted to authenticated'
);
select is(
  (select array_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ',')
     order by tablename)
   from pg_catalog.pg_policies
   where schemaname = 'public' and tablename in ('families', 'family_members', 'member_permissions')),
  array[
    'families:families_select_member:SELECT:authenticated',
    'family_members:family_members_select_member:SELECT:authenticated',
    'member_permissions:member_permissions_select_family:SELECT:authenticated'
  ],
  'each family table has exactly one policy, for select by authenticated'
);
select is(
  family_private.module_keys(),
  array['expenses', 'investments', 'net_worth', 'family_finance'],
  'module_keys lists the catalogue in order'
);
-- Each key must appear in F03's check (family_tables.sql proves that check's
-- exact module and level pairs).
select is(
  (select array_agg(k order by k)
   from unnest(family_private.module_keys()) as k
   where exists (
       select 1 from pg_catalog.pg_constraint c
       where c.conname = 'member_permissions_level_allowed'
         and c.conrelid = 'public.member_permissions'::regclass
         and pg_get_constraintdef(c.oid) like '%''' || k || '''::text%'
     )),
  array['expenses', 'family_finance', 'investments', 'net_worth'],
  'module_keys matches the modules in the member_permissions check'
);

-- ---------------------------------------------------------------------------
-- A user without a family sees nothing
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0600000-0000-4000-8000-000000000009","role":"authenticated"}', true);

select is((select count(*)::integer from public.families), 0, 'a non-member reads no families');
select is((select count(*)::integer from public.family_members), 0, 'a non-member reads no members');
select is((select count(*)::integer from public.member_permissions), 0, 'a non-member reads no permissions');
select is(family_private.my_family_id(), null, 'my_family_id is null without a family');
select is(family_private.is_parent('f0600000-0000-4000-8000-0000000000a1'), false, 'is_parent is false without a family');
select is(family_private.is_creator('f0600000-0000-4000-8000-0000000000a1'), false, 'is_creator is false without a family');
select is(family_private.member_level('expenses'), null, 'member_level is null without a family');
select is((select count(*)::integer from public.get_my_membership()), 0, 'get_my_membership returns zero rows without a family');
select is(public.get_family(), null, 'get_family returns null without a family');

-- ---------------------------------------------------------------------------
-- Kid 03 in family A (expenses edit, family_finance view)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f0600000-0000-4000-8000-000000000003","role":"authenticated"}', true);

-- Policies that call a helper reading family_members work (no recursion).
select is(
  (select array_agg(id order by id) from public.families),
  array['f0600000-0000-4000-8000-0000000000a1'::uuid],
  'a kid reads only their own family'
);
select is(
  (select array_agg(id order by id) from public.family_members),
  array[
    'f0600000-0000-4000-8000-0000000000a2', 'f0600000-0000-4000-8000-0000000000a3',
    'f0600000-0000-4000-8000-0000000000a4', 'f0600000-0000-4000-8000-0000000000a5'
  ]::uuid[],
  'a kid reads every member of their own family'
);
select is(
  (select count(*)::integer from public.member_permissions),
  2,
  'a kid reads exactly their own two permission rows'
);
select is(
  (select count(*)::integer from public.member_permissions
   where member_id <> 'f0600000-0000-4000-8000-0000000000a4'),
  0,
  'a kid cannot read a sibling''s permissions'
);
select is(
  (select count(*)::integer from public.member_permissions
   where member_id = 'f0600000-0000-4000-8000-0000000000a5'),
  0,
  'a kid cannot read a sibling''s permissions even by member id'
);
select is(
  (select count(*)::integer from public.families where id = 'f0600000-0000-4000-8000-0000000000b1')
  + (select count(*)::integer from public.family_members where family_id = 'f0600000-0000-4000-8000-0000000000b1'),
  0,
  'a kid reads nothing of another family'
);
select is(family_private.my_family_id(), 'f0600000-0000-4000-8000-0000000000a1'::uuid, 'my_family_id returns the kid''s family');
select is(family_private.is_parent('f0600000-0000-4000-8000-0000000000a1'), false, 'is_parent is false for a kid');
select is(family_private.is_creator('f0600000-0000-4000-8000-0000000000a1'), false, 'is_creator is false for a kid');
select is(family_private.member_level('expenses'), 'edit', 'member_level returns a kid''s stored edit level');
select is(family_private.member_level('family_finance'), 'view', 'member_level returns a kid''s stored view level');
select is(family_private.member_level('investments'), 'off', 'member_level treats a missing row as off');
select throws_ok(
  $$ select family_private.member_level('boats') $$,
  '23514', null, 'member_level refuses an unknown module'
);
select throws_ok(
  $$ select family_private.member_level(null) $$,
  '23514', null, 'member_level refuses a null module'
);
select results_eq(
  $$ select member_id, family_id, family_name, role, is_creator, permissions from public.get_my_membership() $$,
  $$ values (
    'f0600000-0000-4000-8000-0000000000a4'::uuid,
    'f0600000-0000-4000-8000-0000000000a1'::uuid,
    'Family A',
    'kid',
    false,
    '{"expenses": "edit", "investments": "off", "net_worth": "off", "family_finance": "view"}'::jsonb
  ) $$,
  'get_my_membership returns the kid''s row with every module filled in'
);
select is(
  public.get_family(),
  $json${
    "family": {"id": "f0600000-0000-4000-8000-0000000000a1", "name": "Family A", "createdAt": "2026-01-01T08:00:00+00:00"},
    "members": [
      {"memberId": "f0600000-0000-4000-8000-0000000000a2", "userId": "f0600000-0000-4000-8000-000000000001",
       "role": "parent", "isCreator": true, "displayName": "Ana", "username": null,
       "joinedAt": "2026-01-01T09:00:00+00:00"},
      {"memberId": "f0600000-0000-4000-8000-0000000000a3", "userId": "f0600000-0000-4000-8000-000000000002",
       "role": "parent", "isCreator": false, "displayName": "bogdan.p", "username": "bogdan.p",
       "joinedAt": "2026-01-03T09:00:00+00:00"},
      {"memberId": "f0600000-0000-4000-8000-0000000000a4", "userId": "f0600000-0000-4000-8000-000000000003",
       "role": "kid", "isCreator": false, "displayName": "fam-a-kid", "username": null,
       "joinedAt": "2026-01-02T09:00:00+00:00", "lastActiveAt": "2026-10-02T08:00:00+00:00",
       "permissions": {"expenses": "edit", "investments": "off", "net_worth": "off", "family_finance": "view"}},
      {"memberId": "f0600000-0000-4000-8000-0000000000a5", "userId": "f0600000-0000-4000-8000-000000000004",
       "role": "kid", "isCreator": false, "displayName": "Kid Two", "username": "kid.two",
       "joinedAt": "2026-01-04T09:00:00+00:00"}
    ]
  }$json$::jsonb,
  'get_family shows a kid every member, with lastActiveAt and permissions only on their own entry'
);
select is(
  (select count(*)::integer from jsonb_array_elements(public.get_family() -> 'members') as e
   where e ->> 'memberId' <> 'f0600000-0000-4000-8000-0000000000a4'
     and (e ? 'lastActiveAt' or e ? 'permissions')),
  0,
  'a kid sees no one else''s lastActiveAt or permissions'
);
select is(
  (select array_agg(e ->> 'displayName' order by n)
   from jsonb_array_elements(public.get_family() -> 'members') with ordinality as t(e, n)),
  array['Ana', 'bogdan.p', 'fam-a-kid', 'Kid Two'],
  'displayName falls back from display_name to username to the email''s local part'
);

-- The policies run each helper once per query, as an InitPlan.
select matches(
  pg_temp.plan_of('select * from public.family_members'),
  'InitPlan',
  'the family_members policy evaluates my_family_id once per query'
);
select matches(
  pg_temp.plan_of('select * from public.families'),
  'InitPlan',
  'the families policy evaluates my_family_id once per query'
);
select matches(
  pg_temp.plan_of('select * from public.member_permissions'),
  'InitPlan',
  'the member_permissions policy evaluates its helpers once per query'
);

-- ---------------------------------------------------------------------------
-- Kid 04 in family A (only investments edit)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f0600000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select is(
  (select array_agg(member_id::text || ':' || module || ':' || level) from public.member_permissions),
  array['f0600000-0000-4000-8000-0000000000a5:investments:edit'],
  'the second kid reads only their own permission row'
);
select is(family_private.member_level('expenses'), 'off', 'member_level is off for a module the kid has no row for');
select is(
  (select permissions from public.get_my_membership()),
  '{"expenses": "off", "investments": "edit", "net_worth": "off", "family_finance": "off"}'::jsonb,
  'get_my_membership fills every missing module with off'
);
select is(
  (select array_agg(e ->> 'memberId')
   from jsonb_array_elements(public.get_family() -> 'members') as e
   where e ? 'permissions' or e ? 'lastActiveAt'),
  array['f0600000-0000-4000-8000-0000000000a5'],
  'the second kid sees lastActiveAt and permissions only on their own entry'
);

-- ---------------------------------------------------------------------------
-- Second parent 02 in family A
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f0600000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(
  (select array_agg(id order by id) from public.families),
  array['f0600000-0000-4000-8000-0000000000a1'::uuid],
  'a parent reads only their own family'
);
select is(
  (select count(*)::integer from public.family_members),
  4,
  'a parent reads every member of their own family'
);
select is(
  (select count(*)::integer from public.family_members where family_id <> 'f0600000-0000-4000-8000-0000000000a1'),
  0,
  'a parent reads no member of another family'
);
select is(
  (select array_agg(member_id::text || ':' || module || ':' || level order by member_id, module)
   from public.member_permissions),
  array[
    'f0600000-0000-4000-8000-0000000000a4:expenses:edit',
    'f0600000-0000-4000-8000-0000000000a4:family_finance:view',
    'f0600000-0000-4000-8000-0000000000a5:investments:edit'
  ],
  'a parent reads every kid''s permissions in their family and none of another family'
);
select is(family_private.my_family_id(), 'f0600000-0000-4000-8000-0000000000a1'::uuid, 'my_family_id returns the parent''s family');
select is(family_private.is_parent('f0600000-0000-4000-8000-0000000000a1'), true, 'is_parent is true in the parent''s own family');
select is(family_private.is_parent('f0600000-0000-4000-8000-0000000000b1'), false, 'is_parent is false for another family');
select is(family_private.is_parent(null), false, 'is_parent is false for a null family');
select is(family_private.is_creator('f0600000-0000-4000-8000-0000000000a1'), false, 'is_creator is false for a second parent');
select is(family_private.member_level('expenses'), 'edit', 'member_level is edit for a parent');
select is(family_private.member_level('family_finance'), 'edit', 'member_level is edit for a parent even where kids stop at view');
select results_eq(
  $$ select member_id, family_id, family_name, role, is_creator, permissions from public.get_my_membership() $$,
  $$ values (
    'f0600000-0000-4000-8000-0000000000a3'::uuid,
    'f0600000-0000-4000-8000-0000000000a1'::uuid,
    'Family A',
    'parent',
    false,
    null::jsonb
  ) $$,
  'get_my_membership returns a second parent''s row with null permissions'
);
select is(
  public.get_family(),
  $json${
    "family": {"id": "f0600000-0000-4000-8000-0000000000a1", "name": "Family A", "createdAt": "2026-01-01T08:00:00+00:00"},
    "members": [
      {"memberId": "f0600000-0000-4000-8000-0000000000a2", "userId": "f0600000-0000-4000-8000-000000000001",
       "role": "parent", "isCreator": true, "displayName": "Ana", "username": null,
       "joinedAt": "2026-01-01T09:00:00+00:00", "lastActiveAt": "2026-10-01T08:00:00+00:00",
       "permissions": null},
      {"memberId": "f0600000-0000-4000-8000-0000000000a3", "userId": "f0600000-0000-4000-8000-000000000002",
       "role": "parent", "isCreator": false, "displayName": "bogdan.p", "username": "bogdan.p",
       "joinedAt": "2026-01-03T09:00:00+00:00", "lastActiveAt": null,
       "permissions": null},
      {"memberId": "f0600000-0000-4000-8000-0000000000a4", "userId": "f0600000-0000-4000-8000-000000000003",
       "role": "kid", "isCreator": false, "displayName": "fam-a-kid", "username": null,
       "joinedAt": "2026-01-02T09:00:00+00:00", "lastActiveAt": "2026-10-02T08:00:00+00:00",
       "permissions": {"expenses": "edit", "investments": "off", "net_worth": "off", "family_finance": "view"}},
      {"memberId": "f0600000-0000-4000-8000-0000000000a5", "userId": "f0600000-0000-4000-8000-000000000004",
       "role": "kid", "isCreator": false, "displayName": "Kid Two", "username": "kid.two",
       "joinedAt": "2026-01-04T09:00:00+00:00", "lastActiveAt": "2026-10-03T08:00:00+00:00",
       "permissions": {"expenses": "off", "investments": "edit", "net_worth": "off", "family_finance": "off"}}
    ]
  }$json$::jsonb,
  'get_family shows a parent every member with lastActiveAt and permissions'
);

-- ---------------------------------------------------------------------------
-- Creator 01 of family A
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f0600000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(family_private.is_creator('f0600000-0000-4000-8000-0000000000a1'), true, 'is_creator is true for the creator');
select is(family_private.is_creator('f0600000-0000-4000-8000-0000000000b1'), false, 'is_creator is false for another family');
select is(family_private.is_creator(null), false, 'is_creator is false for a null family');
select is(family_private.is_parent('f0600000-0000-4000-8000-0000000000a1'), true, 'is_parent is true for the creator');
select is(
  (select is_creator from public.get_my_membership()),
  true,
  'get_my_membership marks the creator'
);
select is(
  (select permissions from public.get_my_membership()),
  null,
  'get_my_membership returns null permissions for the creator'
);
select is(
  (select array_agg(e ->> 'memberId')
   from jsonb_array_elements(public.get_family() -> 'members') as e
   where (e ->> 'isCreator')::boolean),
  array['f0600000-0000-4000-8000-0000000000a2'],
  'get_family marks only the creator'
);
select is(
  (select count(*)::integer from public.member_permissions),
  3,
  'the creator reads every kid''s permissions in the family'
);

-- ---------------------------------------------------------------------------
-- Family B, seen from its own members
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f0600000-0000-4000-8000-000000000005","role":"authenticated"}', true);

select is(
  (select array_agg(id order by id) from public.families),
  array['f0600000-0000-4000-8000-0000000000b1'::uuid],
  'the other family''s creator reads only their own family'
);
select is(
  (select count(*)::integer from public.family_members where family_id = 'f0600000-0000-4000-8000-0000000000a1'),
  0,
  'the other family''s creator reads no member of family A'
);
select is(
  (select array_agg(member_id::text || ':' || module || ':' || level) from public.member_permissions),
  array['f0600000-0000-4000-8000-0000000000b4:net_worth:edit'],
  'the other family''s creator reads only their own kids'' permissions'
);
select is(family_private.is_parent('f0600000-0000-4000-8000-0000000000a1'), false, 'a parent of family B is not a parent of family A');
select is(
  public.get_family() -> 'family' ->> 'id',
  'f0600000-0000-4000-8000-0000000000b1',
  'get_family returns the caller''s own family'
);
select is(
  (select array_agg(e ->> 'memberId' order by n)
   from jsonb_array_elements(public.get_family() -> 'members') with ordinality as t(e, n)),
  array[
    'f0600000-0000-4000-8000-0000000000b2', 'f0600000-0000-4000-8000-0000000000b3',
    'f0600000-0000-4000-8000-0000000000b4', 'f0600000-0000-4000-8000-0000000000b5'
  ],
  'get_family lists only the caller''s family, creator first, then parents, then kids'
);
select is(
  (select e -> 'permissions'
   from jsonb_array_elements(public.get_family() -> 'members') as e
   where e ->> 'memberId' = 'f0600000-0000-4000-8000-0000000000b5'),
  '{"expenses": "off", "investments": "off", "net_worth": "off", "family_finance": "off"}'::jsonb,
  'a kid with no permission rows shows every module as off'
);
select is(
  (select e ->> 'displayName'
   from jsonb_array_elements(public.get_family() -> 'members') as e
   where e ->> 'memberId' = 'f0600000-0000-4000-8000-0000000000b3'),
  'fam-b-parent',
  'displayName uses the email when the profile has neither a display name nor a username'
);

select set_config('request.jwt.claims', '{"sub":"f0600000-0000-4000-8000-000000000007","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.member_permissions),
  1,
  'a kid in family B reads only their own permission row'
);
select is(
  (select count(*)::integer from public.family_members where family_id = 'f0600000-0000-4000-8000-0000000000a1')
  + (select count(*)::integer from public.member_permissions
     where member_id in ('f0600000-0000-4000-8000-0000000000a4', 'f0600000-0000-4000-8000-0000000000a5')),
  0,
  'a kid in family B reads nothing of family A'
);
select is(family_private.member_level('net_worth'), 'edit', 'member_level reads the kid''s own family rows');
select is(family_private.member_level('expenses'), 'off', 'member_level is off without a row in family B too');

-- ---------------------------------------------------------------------------
-- Writes stay closed: the new policies are select only
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f0600000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok($$
  update public.families set name = 'Renamed' where id = 'f0600000-0000-4000-8000-0000000000a1'
$$, '42501', null, 'a creator still cannot update the family directly');
select throws_ok($$
  update public.family_members set role = 'parent' where id = 'f0600000-0000-4000-8000-0000000000a4'
$$, '42501', null, 'a parent still cannot update a membership directly');
select throws_ok($$
  delete from public.family_members where id = 'f0600000-0000-4000-8000-0000000000a5'
$$, '42501', null, 'a parent still cannot delete a membership directly');
select throws_ok($$
  insert into public.member_permissions (member_id, module, level)
  values ('f0600000-0000-4000-8000-0000000000a5', 'expenses', 'edit')
$$, '42501', null, 'a parent still cannot write permissions directly');
select throws_ok($$
  select family_private.member_permissions_json('f0600000-0000-4000-8000-0000000000b4')
$$, '42501', null, 'a signed-in user cannot call member_permissions_json to read another family');

-- ---------------------------------------------------------------------------
-- Signed-out callers
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok($$ select public.get_my_membership() $$, '42501', null, 'anon cannot call get_my_membership');
select throws_ok($$ select public.get_family() $$, '42501', null, 'anon cannot call get_family');
select throws_ok($$ select family_private.my_family_id() $$, '42501', null, 'anon cannot call the helpers');
select throws_ok($$ select * from public.families $$, '42501', null, 'anon cannot read families');

-- authenticated without a sub (a malformed token) gets nothing either.
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

select is((select count(*)::integer from public.family_members), 0, 'a caller without a user id reads no members');
select is((select count(*)::integer from public.get_my_membership()), 0, 'a caller without a user id has no membership');
select is(public.get_family(), null, 'a caller without a user id gets no family');

-- ---------------------------------------------------------------------------
-- After the family is deleted, its former members see nothing
-- ---------------------------------------------------------------------------

reset role;
delete from public.families where id = 'f0600000-0000-4000-8000-0000000000b1';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0600000-0000-4000-8000-000000000006","role":"authenticated"}', true);

select is((select count(*)::integer from public.get_my_membership()), 0, 'a former member has no membership after the family is deleted');
select is(public.get_family(), null, 'a former member gets no family after it is deleted');
select is(
  (select count(*)::integer from public.families) + (select count(*)::integer from public.family_members),
  0,
  'a former member reads nothing after the family is deleted'
);

reset role;
select * from finish();
rollback;
