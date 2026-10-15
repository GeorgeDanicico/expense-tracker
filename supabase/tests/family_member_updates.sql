begin;
create extension if not exists pgtap;
select plan(66);

-- F10: set_member_permissions() and touch_last_active().
--
-- Users (prefix f1000000):
--   family A: 01 creator, 02 second parent, 03 kid, 04 kid
--   family B: 05 creator, 06 kid
--   07 has no family.
-- Member ids: a2..a5 in family a1, b2..b3 in family b1, in user order.

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f1000000-0000-4000-8000-000000000001', 'f10-a-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1000000-0000-4000-8000-000000000002', 'f10-a-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1000000-0000-4000-8000-000000000003', 'f10-a-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1000000-0000-4000-8000-000000000004', 'f10-a-kid-two@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1000000-0000-4000-8000-000000000005', 'f10-b-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1000000-0000-4000-8000-000000000006', 'f10-b-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1000000-0000-4000-8000-000000000007', 'f10-no-family@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('f1000000-0000-4000-8000-0000000000a1', 'Family A', 'f1000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-0000000000b1', 'Family B', 'f1000000-0000-4000-8000-000000000005');

-- last_active_at, relative to now() (the transaction's start time, the same
-- clock touch_last_active() uses):
--   a2 null, a3 4 minutes ago, a4 6 minutes ago, a5 long ago,
--   b2 exactly 5 minutes ago, b3 null.
insert into public.family_members (id, family_id, user_id, role, last_active_at) values
  ('f1000000-0000-4000-8000-0000000000a2', 'f1000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-000000000001', 'parent', null),
  ('f1000000-0000-4000-8000-0000000000a3', 'f1000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-000000000002', 'parent', now() - interval '4 minutes'),
  ('f1000000-0000-4000-8000-0000000000a4', 'f1000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-000000000003', 'kid', now() - interval '6 minutes'),
  ('f1000000-0000-4000-8000-0000000000a5', 'f1000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-000000000004', 'kid', '2026-01-01 08:00:00+00'),
  ('f1000000-0000-4000-8000-0000000000b2', 'f1000000-0000-4000-8000-0000000000b1', 'f1000000-0000-4000-8000-000000000005', 'parent', now() - interval '5 minutes'),
  ('f1000000-0000-4000-8000-0000000000b3', 'f1000000-0000-4000-8000-0000000000b1', 'f1000000-0000-4000-8000-000000000006', 'kid', null);

-- Kid a4 has two rows, kid a5 none, kid b3 one.
insert into public.member_permissions (member_id, module, level) values
  ('f1000000-0000-4000-8000-0000000000a4', 'expenses', 'edit'),
  ('f1000000-0000-4000-8000-0000000000a4', 'family_finance', 'view'),
  ('f1000000-0000-4000-8000-0000000000b3', 'investments', 'edit');

-- Every stored permission row as 'member:module=level', read as the table
-- owner so RLS never hides a row.
create function pg_temp.all_permissions()
returns text[]
language sql
security definer
as $$
  select coalesce(array_agg(
    right(p.member_id::text, 2) || ':' || p.module || '=' || p.level
    order by p.member_id, p.module
  ), '{}')
  from public.member_permissions p
$$;

-- A member's last_active_at, read as the table owner.
create function pg_temp.last_active(p_member_id uuid)
returns timestamptz
language sql
security definer
as $$
  select m.last_active_at from public.family_members m where m.id = p_member_id
$$;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from pg_catalog.pg_proc p
   where p.oid in (
       'public.set_member_permissions(uuid, jsonb)'::regprocedure,
       'public.touch_last_active()'::regprocedure
     )
     and p.prosecdef
     and p.provolatile = 'v'
     and p.proconfig = array['search_path=""']),
  2,
  'both RPCs are security definer, volatile and pin an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.set_member_permissions(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.touch_last_active()', 'execute'),
  'authenticated can execute both RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.set_member_permissions(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.touch_last_active()', 'execute')
  and not has_function_privilege('anon', 'family_private.is_valid_permissions(jsonb)', 'execute'),
  'anon can execute none of the new functions'
);
select ok(
  not has_function_privilege('authenticated', 'family_private.is_valid_permissions(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'family_private.is_valid_permissions(jsonb)', 'execute'),
  'the validator is not granted to authenticated or service_role'
);
select is(
  (select p.provolatile::text || ':' || array_to_string(p.proconfig, ',')
   from pg_catalog.pg_proc p
   where p.oid = 'family_private.is_valid_permissions(jsonb)'::regprocedure),
  'i:search_path=""',
  'the validator is immutable and pins an empty search_path'
);

-- ---------------------------------------------------------------------------
-- The validator (as the owner)
-- ---------------------------------------------------------------------------

select ok(
  family_private.is_valid_permissions('{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off"}'),
  'the young_kid preset is valid'
);
select ok(
  family_private.is_valid_permissions('{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"off"}'),
  'the teen preset is valid'
);
select ok(
  family_private.is_valid_permissions('{"family_finance":"view","net_worth":"off","investments":"off","expenses":"off"}'),
  'every module off except family_finance at view is valid, in any key order'
);
select is(
  family_private.is_valid_permissions('{"expenses":"edit","investments":"off","net_worth":"off"}'),
  false,
  'a missing module is invalid'
);
select is(
  family_private.is_valid_permissions('{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","boats":"off"}'),
  false,
  'an unknown extra module is invalid'
);
select is(
  family_private.is_valid_permissions('{"Expenses":"edit","investments":"off","net_worth":"off","family_finance":"off"}'),
  false,
  'module keys are case-sensitive'
);
select is(
  family_private.is_valid_permissions('{"expenses":"view","investments":"off","net_worth":"off","family_finance":"off"}'),
  false,
  'view is not allowed for expenses'
);
select is(
  family_private.is_valid_permissions('{"expenses":"off","investments":"off","net_worth":"off","family_finance":"edit"}'),
  false,
  'edit is not allowed for family_finance'
);
select is(
  family_private.is_valid_permissions('{"expenses":"full","investments":"off","net_worth":"off","family_finance":"off"}'),
  false,
  'an unknown level is invalid'
);
select is(
  family_private.is_valid_permissions('{"expenses":"Edit","investments":"off","net_worth":"off","family_finance":"off"}'),
  false,
  'levels are case-sensitive'
);
select is(
  family_private.is_valid_permissions('{"expenses":null,"investments":"off","net_worth":"off","family_finance":"off"}'),
  false,
  'a JSON null level is invalid'
);
select is(
  family_private.is_valid_permissions('{"expenses":["edit"],"investments":"off","net_worth":"off","family_finance":"off"}'),
  false,
  'a non-string level is invalid'
);
select is(family_private.is_valid_permissions('{}'), false, 'an empty object is invalid');
select is(family_private.is_valid_permissions('["expenses"]'), false, 'an array is invalid');
select is(family_private.is_valid_permissions('"edit"'), false, 'a string is invalid');
select is(family_private.is_valid_permissions('null'), false, 'a JSON null is invalid');
select is(family_private.is_valid_permissions(null), false, 'SQL null is invalid');

-- ---------------------------------------------------------------------------
-- Kids and users without a family can't change anyone's permissions
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a4',
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"view"}') $$,
  '42501', 'Only parents can change a kid''s permissions.',
  'a kid cannot change their own permissions'
);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a5',
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"view"}') $$,
  '42501', 'Only parents can change a kid''s permissions.',
  'a kid cannot change a sibling''s permissions'
);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000b3',
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"view"}') $$,
  '42501', 'Only parents can change a kid''s permissions.',
  'a kid gets 42501, not 404, for another family''s kid'
);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-00000000ffff',
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"view"}') $$,
  '42501', 'Only parents can change a kid''s permissions.',
  'a kid gets 42501, not 404, for an unknown member'
);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a4', '{}') $$,
  '42501', 'Only parents can change a kid''s permissions.',
  'a kid gets 42501, not 422, for invalid permissions'
);

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000007","role":"authenticated"}', true);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a4',
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"view"}') $$,
  '42501', 'Only parents can change a kid''s permissions.',
  'a user without a family cannot change anyone''s permissions'
);

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a4',
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"view"}') $$,
  '42501', 'Only parents can change a kid''s permissions.',
  'a caller without a user id cannot change anyone''s permissions'
);

select is(
  pg_temp.all_permissions(),
  array['a4:expenses=edit', 'a4:family_finance=view', 'b3:investments=edit'],
  'the refused calls changed no permission rows'
);

-- ---------------------------------------------------------------------------
-- A second parent: refused for parents, other families and invalid JSON
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a2',
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"view"}') $$,
  '42501', 'Parents always have full access, so their permissions can''t be changed.',
  'a parent cannot change the creator''s permissions'
);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a3',
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"view"}') $$,
  '42501', 'Parents always have full access, so their permissions can''t be changed.',
  'a parent cannot change their own permissions'
);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000b3',
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"view"}') $$,
  'P0002', 'That family member wasn''t found.',
  'a parent cannot change another family''s kid'
);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000b2',
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"view"}') $$,
  'P0002', 'That family member wasn''t found.',
  'another family''s parent is not found either, so their role is not revealed'
);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-00000000ffff',
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"view"}') $$,
  'P0002', 'That family member wasn''t found.',
  'an unknown member is not found'
);
select throws_ok(
  $$ select public.set_member_permissions(null,
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"view"}') $$,
  'P0002', 'That family member wasn''t found.',
  'a null member id is not found'
);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a4',
       '{"expenses":"edit","investments":"edit","net_worth":"edit"}') $$,
  '23514', 'Choose an allowed level for every module.',
  'permissions missing a module are refused'
);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a4',
       '{"expenses":"view","investments":"edit","net_worth":"edit","family_finance":"view"}') $$,
  '23514', 'Choose an allowed level for every module.',
  'a level the module does not allow is refused'
);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a4',
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"view","boats":"off"}') $$,
  '23514', 'Choose an allowed level for every module.',
  'an unknown module is refused'
);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a4', '["edit"]') $$,
  '23514', 'Choose an allowed level for every module.',
  'permissions that are not an object are refused'
);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a4', null) $$,
  '23514', 'Choose an allowed level for every module.',
  'null permissions are refused'
);

select is(
  pg_temp.all_permissions(),
  array['a4:expenses=edit', 'a4:family_finance=view', 'b3:investments=edit'],
  'the refused calls still changed no permission rows'
);

-- ---------------------------------------------------------------------------
-- Parents replace a kid's permissions
-- ---------------------------------------------------------------------------

-- The second parent (not the creator) turns a4's two rows into four, flipping
-- every module.
select lives_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a4',
       '{"expenses":"off","investments":"edit","net_worth":"edit","family_finance":"off"}') $$,
  'a second parent can change a kid''s permissions'
);
select is(
  pg_temp.all_permissions(),
  array[
    'a4:expenses=off', 'a4:family_finance=off', 'a4:investments=edit', 'a4:net_worth=edit',
    'b3:investments=edit'
  ],
  'the update replaces every module of that kid and nothing else'
);
select is(
  (select count(*)::integer from public.member_permissions
   where member_id = 'f1000000-0000-4000-8000-0000000000a4'),
  4,
  'the parent reads the kid''s four new rows through the read policy'
);

-- The creator gives a5, who had no rows, the teen preset.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a5',
       '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"off"}') $$,
  'the creator can change a kid''s permissions'
);
select is(
  pg_temp.all_permissions(),
  array[
    'a4:expenses=off', 'a4:family_finance=off', 'a4:investments=edit', 'a4:net_worth=edit',
    'a5:expenses=edit', 'a5:family_finance=off', 'a5:investments=edit', 'a5:net_worth=edit',
    'b3:investments=edit'
  ],
  'a kid without rows gets a row for every module'
);

-- Saving the same kid twice applies the second set in full.
select lives_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a4',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"view"}') $$,
  'a kid''s permissions can be changed again'
);
select is(
  pg_temp.all_permissions(),
  array[
    'a4:expenses=edit', 'a4:family_finance=view', 'a4:investments=off', 'a4:net_worth=off',
    'a5:expenses=edit', 'a5:family_finance=off', 'a5:investments=edit', 'a5:net_worth=edit',
    'b3:investments=edit'
  ],
  'the second change replaces the first'
);

-- Family B's creator can't reach family A's kid.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a4',
       '{"expenses":"off","investments":"off","net_worth":"off","family_finance":"off"}') $$,
  'P0002', 'That family member wasn''t found.',
  'another family''s creator cannot change a kid''s permissions'
);

-- The kid sees the new levels.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(
  (select permissions from public.get_my_membership()),
  '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"view"}'::jsonb,
  'the kid''s membership shows the new permissions'
);

-- ---------------------------------------------------------------------------
-- touch_last_active
-- ---------------------------------------------------------------------------

-- The creator (a2) has never been active: the first touch writes now().
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.touch_last_active() $$, 'a parent can touch their last activity');
select is(
  pg_temp.last_active('f1000000-0000-4000-8000-0000000000a2'),
  now(),
  'a null last_active_at is set to now()'
);

-- Snapshot every row's physical version. An update that writes always creates
-- a new row version with a new ctid, so a ctid that hasn't changed proves the
-- row was not written.
reset role;
create temp table member_versions as
select m.id, m.ctid::text as version, m.last_active_at
from public.family_members m;
set local role authenticated;

select lives_ok($$ select public.touch_last_active() $$, 'touching again within 5 minutes succeeds');

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.touch_last_active() $$, 'a parent active 4 minutes ago can touch');

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select lives_ok($$ select public.touch_last_active() $$, 'a parent active exactly 5 minutes ago can touch');

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000007","role":"authenticated"}', true);
select lives_ok($$ select public.touch_last_active() $$, 'a user without a family can touch, and nothing happens');

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select lives_ok($$ select public.touch_last_active() $$, 'a caller without a user id can touch, and nothing happens');

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.touch_last_active() $$, 'a kid active 6 minutes ago can touch');

reset role;
select is(
  pg_temp.last_active('f1000000-0000-4000-8000-0000000000a4'),
  now(),
  'a last_active_at older than 5 minutes is set to now()'
);
select is(
  (select array_agg(right(v.id::text, 2) order by v.id)
   from member_versions v
   join public.family_members m on m.id = v.id
   where m.ctid::text <> v.version or m.last_active_at is distinct from v.last_active_at),
  array['a4'],
  'only the kid''s stale row was written; recent rows, other members and other families were not'
);
select is(
  pg_temp.last_active('f1000000-0000-4000-8000-0000000000a3'),
  now() - interval '4 minutes',
  'a last_active_at 4 minutes old is left alone'
);
select is(
  pg_temp.last_active('f1000000-0000-4000-8000-0000000000b2'),
  now() - interval '5 minutes',
  'a last_active_at exactly 5 minutes old is left alone'
);
select is(
  (select count(*)::integer from public.family_members
   where user_id = 'f1000000-0000-4000-8000-000000000007'),
  0,
  'touching without a family creates no membership'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select public.set_member_permissions('f1000000-0000-4000-8000-0000000000a4',
       '{"expenses":"off","investments":"off","net_worth":"off","family_finance":"off"}') $$,
  '42501', null, 'anon cannot call set_member_permissions'
);
select throws_ok($$ select public.touch_last_active() $$, '42501', null, 'anon cannot call touch_last_active');

reset role;
select * from finish();
rollback;
