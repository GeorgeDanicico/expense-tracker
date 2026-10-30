begin;
create extension if not exists pgtap;
select plan(93);

-- F13: profiles.managed_by_family and must_change_password, their guard, the
-- mark being cleared when a membership is deleted, and add_managed_kid(),
-- complete_password_change() and require_password_change().
--
-- Users (prefix f1300000):
--   family A: 01 creator, 02 second parent, 03 kid (no profile row)
--   family B: 04 creator, 05 kid (must change password)
--   06 marked for A, must change password, no family yet (the matching account)
--   07 marked for B, no family
--   08 unmarked, no family
--   09 marked for A, but already a kid in family B
--   10 no profile row, no family
--   11 no profile row, no family (creates its own profile)
-- Member ids: a2..a4 in family a1, b2..b4 in family b1, in user order.

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f1300000-0000-4000-8000-000000000001', 'f13-a-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1300000-0000-4000-8000-000000000002', 'f13-a-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1300000-0000-4000-8000-000000000003', 'f13-a-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1300000-0000-4000-8000-000000000004', 'f13-b-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1300000-0000-4000-8000-000000000005', 'f13-b-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1300000-0000-4000-8000-000000000006', 'f13-new-kid@kids.ifam.invalid', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1300000-0000-4000-8000-000000000007', 'f13-b-new-kid@kids.ifam.invalid', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1300000-0000-4000-8000-000000000008', 'f13-unmarked@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1300000-0000-4000-8000-000000000009', 'f13-taken@kids.ifam.invalid', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1300000-0000-4000-8000-000000000010', 'f13-no-profile@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1300000-0000-4000-8000-000000000011', 'f13-new-profile@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('f1300000-0000-4000-8000-0000000000a1', 'Family A', 'f1300000-0000-4000-8000-000000000001'),
  ('f1300000-0000-4000-8000-0000000000b1', 'Family B', 'f1300000-0000-4000-8000-000000000004');

insert into public.family_members (id, family_id, user_id, role) values
  ('f1300000-0000-4000-8000-0000000000a2', 'f1300000-0000-4000-8000-0000000000a1', 'f1300000-0000-4000-8000-000000000001', 'parent'),
  ('f1300000-0000-4000-8000-0000000000a3', 'f1300000-0000-4000-8000-0000000000a1', 'f1300000-0000-4000-8000-000000000002', 'parent'),
  ('f1300000-0000-4000-8000-0000000000a4', 'f1300000-0000-4000-8000-0000000000a1', 'f1300000-0000-4000-8000-000000000003', 'kid'),
  ('f1300000-0000-4000-8000-0000000000b2', 'f1300000-0000-4000-8000-0000000000b1', 'f1300000-0000-4000-8000-000000000004', 'parent'),
  ('f1300000-0000-4000-8000-0000000000b3', 'f1300000-0000-4000-8000-0000000000b1', 'f1300000-0000-4000-8000-000000000005', 'kid'),
  ('f1300000-0000-4000-8000-0000000000b4', 'f1300000-0000-4000-8000-0000000000b1', 'f1300000-0000-4000-8000-000000000009', 'kid');

-- As the server would write them (the test runs as a trusted role).
insert into public.profiles (id, email, username, managed_by_family, must_change_password) values
  ('f1300000-0000-4000-8000-000000000001', 'f13-a-creator@example.test', null, null, false),
  ('f1300000-0000-4000-8000-000000000002', 'f13-a-parent@example.test', null, null, false),
  ('f1300000-0000-4000-8000-000000000004', 'f13-b-creator@example.test', null, null, false),
  ('f1300000-0000-4000-8000-000000000005', 'f13-b-kid@example.test', null, null, true),
  ('f1300000-0000-4000-8000-000000000006', 'f13-new-kid@kids.ifam.invalid', 'f13.new.kid', 'f1300000-0000-4000-8000-0000000000a1', true),
  ('f1300000-0000-4000-8000-000000000007', 'f13-b-new-kid@kids.ifam.invalid', 'f13.b.new.kid', 'f1300000-0000-4000-8000-0000000000b1', true),
  ('f1300000-0000-4000-8000-000000000008', 'f13-unmarked@example.test', null, null, false),
  ('f1300000-0000-4000-8000-000000000009', 'f13-taken@kids.ifam.invalid', 'f13.taken', 'f1300000-0000-4000-8000-0000000000a1', true);

-- A profile's two F13 columns as 'family-suffix:flag' (family-suffix is the
-- last two characters of managed_by_family, or '-'), or null without a row.
-- Read as the table owner so RLS never hides a row.
create function pg_temp.kid_state(p_user_id uuid)
returns text
language sql
security definer
as $$
  select coalesce(right(p.managed_by_family::text, 2), '-') || ':' || p.must_change_password::text
  from public.profiles p
  where p.id = p_user_id
$$;

-- Every must_change_password that is true, as user-id suffixes.
create function pg_temp.flagged()
returns text[]
language sql
security definer
as $$
  select coalesce(array_agg(right(p.id::text, 2) order by p.id), '{}')
  from public.profiles p
  where p.id::text like 'f1300000-%'
    and p.must_change_password
$$;

-- A user's membership as 'family-suffix:role', or null.
create function pg_temp.membership(p_user_id uuid)
returns text
language sql
security definer
as $$
  select right(m.family_id::text, 2) || ':' || m.role
  from public.family_members m
  where m.user_id = p_user_id
$$;

-- A user's member id, or null.
create function pg_temp.member_id(p_user_id uuid)
returns uuid
language sql
security definer
as $$
  select m.id from public.family_members m where m.user_id = p_user_id
$$;

-- A member's permission rows as 'module=level'.
create function pg_temp.permissions_of(p_user_id uuid)
returns text[]
language sql
security definer
as $$
  select coalesce(array_agg(p.module || '=' || p.level order by p.module), '{}')
  from public.member_permissions p
  join public.family_members m on m.id = p.member_id
  where m.user_id = p_user_id
$$;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select col_type_is('public', 'profiles', 'managed_by_family', 'uuid',
  'profiles.managed_by_family is a uuid');
select col_is_null('public', 'profiles', 'managed_by_family',
  'profiles.managed_by_family is nullable');
select fk_ok('public', 'profiles', 'managed_by_family', 'public', 'families', 'id',
  'profiles.managed_by_family references families');
select col_type_is('public', 'profiles', 'must_change_password', 'boolean',
  'profiles.must_change_password is a boolean');
select col_not_null('public', 'profiles', 'must_change_password',
  'profiles.must_change_password is not null');
select col_default_is('public', 'profiles', 'must_change_password', 'false',
  'profiles.must_change_password defaults to false');
select is(
  (select c.confdeltype::text from pg_catalog.pg_constraint c
   where c.conrelid = 'public.profiles'::regclass
     and c.contype = 'f'
     and c.confrelid = 'public.families'::regclass),
  'n',
  'deleting a family sets managed_by_family to null'
);
select has_index('public', 'profiles', 'profiles_managed_by_family_idx',
  'managed_by_family is indexed');

select is(
  (select count(*)::integer from pg_catalog.pg_proc p
   where p.oid in (
       'public.add_managed_kid(uuid, jsonb)'::regprocedure,
       'public.complete_password_change()'::regprocedure,
       'public.require_password_change(uuid)'::regprocedure
     )
     and p.prosecdef
     and p.provolatile = 'v'
     and p.proconfig = array['search_path=""']),
  3,
  'the three RPCs are security definer, volatile and pin an empty search_path'
);
select is(
  (select p.prorettype::regtype::text from pg_catalog.pg_proc p
   where p.oid = 'public.add_managed_kid(uuid, jsonb)'::regprocedure)
  || ',' ||
  (select p.prorettype::regtype::text from pg_catalog.pg_proc p
   where p.oid = 'public.complete_password_change()'::regprocedure)
  || ',' ||
  (select p.prorettype::regtype::text from pg_catalog.pg_proc p
   where p.oid = 'public.require_password_change(uuid)'::regprocedure),
  'uuid,void,uuid',
  'add_managed_kid and require_password_change return a uuid; complete_password_change returns void'
);
select ok(
  has_function_privilege('authenticated', 'public.add_managed_kid(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.complete_password_change()', 'execute')
  and has_function_privilege('authenticated', 'public.require_password_change(uuid)', 'execute'),
  'authenticated can execute the three RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.add_managed_kid(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.complete_password_change()', 'execute')
  and not has_function_privilege('anon', 'public.require_password_change(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.guard_profile_managed_account()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_profile_managed_account()', 'execute'),
  'anon can execute none of the new functions, and nobody calls the guard directly'
);
select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
   from pg_catalog.pg_proc p
   where p.oid = 'public.guard_profile_managed_account()'::regprocedure),
  'false:search_path=""',
  'the guard is security invoker and pins an empty search_path'
);
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
   from pg_catalog.pg_proc p
   where p.oid = 'family_private.clear_managed_mark_on_removal()'::regprocedure)
  and not has_function_privilege('authenticated', 'family_private.clear_managed_mark_on_removal()', 'execute')
  and not has_function_privilege('service_role', 'family_private.clear_managed_mark_on_removal()', 'execute'),
  'the removal trigger is security definer, pins an empty search_path and is not granted'
);

-- ---------------------------------------------------------------------------
-- The guard: signed-in users can't set or change either column
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000008","role":"authenticated"}', true);

select throws_ok(
  $$ update public.profiles set managed_by_family = 'f1300000-0000-4000-8000-0000000000a1'
     where id = 'f1300000-0000-4000-8000-000000000008' $$,
  '42501', 'Kid account settings can only be changed by the server.',
  'a user cannot mark their own account for a family'
);
select throws_ok(
  $$ update public.profiles set must_change_password = true
     where id = 'f1300000-0000-4000-8000-000000000008' $$,
  '42501', 'Kid account settings can only be changed by the server.',
  'a user cannot set their own must_change_password'
);

select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000006","role":"authenticated"}', true);

select throws_ok(
  $$ update public.profiles set must_change_password = false
     where id = 'f1300000-0000-4000-8000-000000000006' $$,
  '42501', 'Kid account settings can only be changed by the server.',
  'a kid cannot clear their own must_change_password directly'
);
select throws_ok(
  $$ update public.profiles set managed_by_family = null
     where id = 'f1300000-0000-4000-8000-000000000006' $$,
  '42501', 'Kid account settings can only be changed by the server.',
  'a kid cannot unmark their own account'
);
select throws_ok(
  $$ update public.profiles set managed_by_family = 'f1300000-0000-4000-8000-0000000000b1'
     where id = 'f1300000-0000-4000-8000-000000000006' $$,
  '42501', 'Kid account settings can only be changed by the server.',
  'a kid cannot move their account to another family'
);
select lives_ok(
  $$ update public.profiles
     set managed_by_family = 'f1300000-0000-4000-8000-0000000000a1', must_change_password = true
     where id = 'f1300000-0000-4000-8000-000000000006' $$,
  'writing back the unchanged values is allowed'
);
select lives_ok(
  $$ update public.profiles set display_name = 'New Kid'
     where id = 'f1300000-0000-4000-8000-000000000006' $$,
  'a kid can still change their display name'
);
select lives_ok(
  $$ insert into public.profiles (id, email, currency)
     values ('f1300000-0000-4000-8000-000000000006', 'f13-new-kid@kids.ifam.invalid', 'RON')
     on conflict (id) do update set email = excluded.email, currency = excluded.currency $$,
  'the account currency upsert still works for a kid account'
);
select throws_ok(
  $$ delete from public.profiles where id = 'f1300000-0000-4000-8000-000000000006' $$,
  '42501', 'Kid accounts can only be removed by the server.',
  'a kid cannot delete their profile to reset the flags'
);
select throws_ok(
  $$ update public.profiles set username = 'f13.renamed'
     where id = 'f1300000-0000-4000-8000-000000000006' $$,
  '42501', 'Usernames can only be set by the server.',
  'F04''s username guard still applies'
);

select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select throws_ok(
  $$ delete from public.profiles where id = 'f1300000-0000-4000-8000-000000000005' $$,
  '42501', 'Kid accounts can only be removed by the server.',
  'a user who must change their password cannot delete their profile'
);

select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000011","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.profiles (id, email, must_change_password)
     values ('f1300000-0000-4000-8000-000000000011', 'f13-new-profile@example.test', true) $$,
  '42501', 'Kid account settings can only be changed by the server.',
  'a user cannot create their profile with must_change_password'
);
select throws_ok(
  $$ insert into public.profiles (id, email, managed_by_family)
     values ('f1300000-0000-4000-8000-000000000011', 'f13-new-profile@example.test', 'f1300000-0000-4000-8000-0000000000a1') $$,
  '42501', 'Kid account settings can only be changed by the server.',
  'a user cannot create their profile marked for a family'
);
select lives_ok(
  $$ insert into public.profiles (id, email, managed_by_family, must_change_password)
     values ('f1300000-0000-4000-8000-000000000011', 'f13-new-profile@example.test', null, false) $$,
  'a user can create their profile with the default values'
);
select lives_ok(
  $$ delete from public.profiles where id = 'f1300000-0000-4000-8000-000000000011' $$,
  'a user without either flag can still delete their own profile'
);

reset role;
select is(pg_temp.kid_state('f1300000-0000-4000-8000-000000000006'), 'a1:true',
  'the refused writes left the kid account marked and flagged');
select is(pg_temp.kid_state('f1300000-0000-4000-8000-000000000008'), '-:false',
  'the refused writes left the unmarked account alone');
select is(pg_temp.kid_state('f1300000-0000-4000-8000-000000000011'), null,
  'the deleted profile is gone');

-- The service role, used by the server's admin client (F28), may set both.
set local role service_role;
select lives_ok(
  $$ update public.profiles
     set managed_by_family = 'f1300000-0000-4000-8000-0000000000b1', must_change_password = true
     where id = 'f1300000-0000-4000-8000-000000000008' $$,
  'the service role can set both columns'
);
select lives_ok(
  $$ update public.profiles set managed_by_family = null, must_change_password = false
     where id = 'f1300000-0000-4000-8000-000000000008' $$,
  'the service role can clear both columns'
);
reset role;
select is(pg_temp.kid_state('f1300000-0000-4000-8000-000000000008'), '-:false',
  'the service role''s writes were saved');

-- ---------------------------------------------------------------------------
-- add_managed_kid: refused for kids and users without a family
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-000000000006',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}') $$,
  '42501', 'Only parents can add a kid.',
  'a kid cannot add a kid, even one marked for their family'
);

select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000008","role":"authenticated"}', true);
select throws_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-000000000006',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}') $$,
  '42501', 'Only parents can add a kid.',
  'a user without a family cannot add a kid'
);

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-000000000006',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}') $$,
  '42501', 'Only parents can add a kid.',
  'a caller without a user id cannot add a kid'
);

-- ---------------------------------------------------------------------------
-- add_managed_kid: a parent only adds an account marked for their family
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select throws_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-000000000007',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}') $$,
  'P0002', 'That account wasn''t found.',
  'an account marked for another family is not found'
);
select throws_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-000000000008',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}') $$,
  'P0002', 'That account wasn''t found.',
  'an unmarked account is not found'
);
select throws_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-000000000010',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}') $$,
  'P0002', 'That account wasn''t found.',
  'an account without a profile row is not found'
);
select throws_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-00000000ffff',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}') $$,
  'P0002', 'That account wasn''t found.',
  'an unknown user is not found'
);
select throws_ok(
  $$ select public.add_managed_kid(null,
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}') $$,
  'P0002', 'That account wasn''t found.',
  'a null user id is not found'
);
select throws_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-000000000009',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}') $$,
  '23505', 'That account is already in a family.',
  'an account marked for the family but already in another family is refused'
);
select throws_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-000000000006',
       '{"expenses":"edit","investments":"off","net_worth":"off"}') $$,
  '23514', 'Choose an allowed level for every module.',
  'permissions missing a module are refused'
);
select throws_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-000000000006',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"edit","mcp":"off","ai":"off"}') $$,
  '23514', 'Choose an allowed level for every module.',
  'a level the module does not allow is refused'
);
select throws_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-000000000006', null) $$,
  '23514', 'Choose an allowed level for every module.',
  'null permissions are refused'
);

reset role;
select is(pg_temp.membership('f1300000-0000-4000-8000-000000000006'), null,
  'the refused calls added no membership for the matching account');
select is(pg_temp.membership('f1300000-0000-4000-8000-000000000007'), null,
  'nor for the other family''s account');
select is(pg_temp.membership('f1300000-0000-4000-8000-000000000008'), null,
  'nor for the unmarked account');
select is(pg_temp.membership('f1300000-0000-4000-8000-000000000009'), 'b1:kid',
  'the account already in a family stays where it was');

-- The second parent (not the creator) adds the matching account.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select set_config('f13.new_member_id',
       public.add_managed_kid('f1300000-0000-4000-8000-000000000006',
         '{"expenses":"edit","investments":"off","net_worth":"edit","family_finance":"view","mcp":"off","ai":"off"}')::text,
       true) $$,
  'a parent can add an account marked for their family'
);

reset role;
select is(pg_temp.membership('f1300000-0000-4000-8000-000000000006'), 'a1:kid',
  'the account becomes a kid in the caller''s family');
select is(current_setting('f13.new_member_id')::uuid,
  pg_temp.member_id('f1300000-0000-4000-8000-000000000006'),
  'add_managed_kid returns the new member id');
select is(pg_temp.permissions_of('f1300000-0000-4000-8000-000000000006'),
  array['ai=off', 'expenses=edit', 'family_finance=view', 'investments=off', 'mcp=off', 'net_worth=edit'],
  'a permission row is written for every module');
select is(pg_temp.kid_state('f1300000-0000-4000-8000-000000000006'), 'a1:true',
  'the account stays marked and must still change its password');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-000000000006',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}') $$,
  '23505', 'That account is already in a family.',
  'adding the same account twice is refused'
);

-- The other family's creator adds their own account.
select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select lives_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-000000000007',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}') $$,
  'a creator can add an account marked for their family'
);
reset role;
select is(pg_temp.membership('f1300000-0000-4000-8000-000000000007'), 'b1:kid',
  'that account becomes a kid in the other family');

-- ---------------------------------------------------------------------------
-- complete_password_change: the caller's own row only
-- ---------------------------------------------------------------------------

select is(pg_temp.flagged(), array['05', '06', '07', '09'],
  'before: four accounts must change their password');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.complete_password_change() $$,
  'a kid can complete their password change');
select is(pg_temp.flagged(), array['05', '07', '09'],
  'only the caller''s flag is cleared');
select is(pg_temp.kid_state('f1300000-0000-4000-8000-000000000006'), 'a1:false',
  'the account stays marked');
select lives_ok($$ select public.complete_password_change() $$,
  'completing it again is harmless');
select is(pg_temp.flagged(), array['05', '07', '09'],
  'the second call changes nothing');

select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000010","role":"authenticated"}', true);
select lives_ok($$ select public.complete_password_change() $$,
  'a caller without a profile row gets no error');
select is(pg_temp.kid_state('f1300000-0000-4000-8000-000000000010'), null,
  'and no profile row is created');

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select lives_ok($$ select public.complete_password_change() $$,
  'a caller without a user id gets no error');
select is(pg_temp.flagged(), array['05', '07', '09'],
  'and changes nothing');

-- ---------------------------------------------------------------------------
-- require_password_change: parents, for kids in their family
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.require_password_change('f1300000-0000-4000-8000-0000000000a4') $$,
  '42501', 'Only parents can reset a kid''s password.',
  'a kid cannot require their own password change'
);
select throws_ok(
  $$ select public.require_password_change(pg_temp.member_id('f1300000-0000-4000-8000-000000000006')) $$,
  '42501', 'Only parents can reset a kid''s password.',
  'a kid cannot require a sibling''s password change'
);

select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000008","role":"authenticated"}', true);
select throws_ok(
  $$ select public.require_password_change('f1300000-0000-4000-8000-0000000000a4') $$,
  '42501', 'Only parents can reset a kid''s password.',
  'a user without a family cannot require a password change'
);

select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.require_password_change('f1300000-0000-4000-8000-0000000000a2') $$,
  '42501', 'Only a kid''s password can be reset.',
  'a parent cannot require the creator''s password change'
);
select throws_ok(
  $$ select public.require_password_change('f1300000-0000-4000-8000-0000000000a3') $$,
  '42501', 'Only a kid''s password can be reset.',
  'a parent cannot require their own password change'
);
select throws_ok(
  $$ select public.require_password_change('f1300000-0000-4000-8000-0000000000b3') $$,
  'P0002', 'That family member wasn''t found.',
  'a parent cannot require another family''s kid to change their password'
);
select throws_ok(
  $$ select public.require_password_change('f1300000-0000-4000-8000-0000000000b2') $$,
  'P0002', 'That family member wasn''t found.',
  'another family''s parent is not found either, so their role is not revealed'
);
select throws_ok(
  $$ select public.require_password_change('f1300000-0000-4000-8000-00000000ffff') $$,
  'P0002', 'That family member wasn''t found.',
  'an unknown member is not found'
);
select is(pg_temp.flagged(), array['05', '07', '09'],
  'the refused calls changed no flag');

select is(
  public.require_password_change(pg_temp.member_id('f1300000-0000-4000-8000-000000000006')),
  'f1300000-0000-4000-8000-000000000006'::uuid,
  'a parent can require a kid''s password change, and gets the kid''s user id'
);
select is(
  public.require_password_change('f1300000-0000-4000-8000-0000000000a4'),
  'f1300000-0000-4000-8000-000000000003'::uuid,
  'it also works for a kid without a profile row'
);
select is(pg_temp.flagged(), array['03', '05', '06', '07', '09'],
  'both kids must now change their password, and nobody else');
select is(pg_temp.kid_state('f1300000-0000-4000-8000-000000000003'), '-:true',
  'the missing profile row is created with the flag and no family mark');

-- ---------------------------------------------------------------------------
-- Removing a kid clears their mark for that family
-- ---------------------------------------------------------------------------

-- The creator removes the managed kid with F12's remove_family_member.
select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.remove_family_member(pg_temp.member_id('f1300000-0000-4000-8000-000000000006')) $$,
  'the creator can remove a managed kid'
);
select is(pg_temp.membership('f1300000-0000-4000-8000-000000000006'), null,
  'the kid is no longer a member');
select is(pg_temp.kid_state('f1300000-0000-4000-8000-000000000006'), '-:true',
  'removing the kid clears their mark and keeps the flag');

select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.add_managed_kid('f1300000-0000-4000-8000-000000000006',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}') $$,
  'P0002', 'That account wasn''t found.',
  'a parent cannot re-add a removed kid'
);

-- Family B's creator removes 09, who is marked for family A: that mark isn't
-- B's, so it stays.
select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select lives_ok(
  $$ select public.remove_family_member('f1300000-0000-4000-8000-0000000000b4') $$,
  'the other family''s creator can remove a kid marked for a different family'
);
select is(pg_temp.kid_state('f1300000-0000-4000-8000-000000000009'), 'a1:true',
  'a mark for a different family is left alone');

-- Any other path that deletes the membership clears the mark too.
reset role;
delete from public.family_members
where user_id = 'f1300000-0000-4000-8000-000000000007';
select is(pg_temp.kid_state('f1300000-0000-4000-8000-000000000007'), '-:true',
  'deleting the membership directly clears the mark as well');

-- ---------------------------------------------------------------------------
-- Deleting the family clears the mark
-- ---------------------------------------------------------------------------

-- Kid 03 is a member of family A; mark it, as if the family had created it.
update public.profiles set managed_by_family = 'f1300000-0000-4000-8000-0000000000a1'
where id = 'f1300000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1300000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.delete_family('Family A') $$,
  'the creator can still delete a family with a managed kid in it'
);

reset role;
select is(pg_temp.membership('f1300000-0000-4000-8000-000000000003'), null,
  'the managed kid''s membership is gone');
select is(pg_temp.kid_state('f1300000-0000-4000-8000-000000000003'), '-:true',
  'deleting the family unmarks its kid accounts and keeps the flag');
select is(pg_temp.kid_state('f1300000-0000-4000-8000-000000000009'), '-:true',
  'including one that was never a member');

select * from finish();
rollback;
