begin;
create extension if not exists pgtap;
select plan(34);

-- F07: create_family(p_name).
--
-- Users (prefix f0700000):
--   01, 02 and 03 have no family and create one in this file.
--   04 created family X (member a2), and 05 is a kid in it (member a3).
insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f0700000-0000-4000-8000-000000000001', 'create-one@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0700000-0000-4000-8000-000000000002', 'create-two@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0700000-0000-4000-8000-000000000003', 'create-three@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0700000-0000-4000-8000-000000000004', 'create-x-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0700000-0000-4000-8000-000000000005', 'create-x-kid@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

-- Setup as the table owner: the family first, then the creator's membership.
insert into public.families (id, name, creator_id) values
  ('f0700000-0000-4000-8000-0000000000a1', 'Family X', 'f0700000-0000-4000-8000-000000000004');
insert into public.family_members (id, family_id, user_id, role) values
  ('f0700000-0000-4000-8000-0000000000a2', 'f0700000-0000-4000-8000-0000000000a1', 'f0700000-0000-4000-8000-000000000004', 'parent'),
  ('f0700000-0000-4000-8000-0000000000a3', 'f0700000-0000-4000-8000-0000000000a1', 'f0700000-0000-4000-8000-000000000005', 'kid');

-- The ids create_family returns, by caller.
create temporary table created_families (
  user_id uuid primary key,
  family_id uuid not null
);
grant select, insert on created_families to authenticated;

-- Fires F05's deferred "creator is a parent" check now, as a commit would,
-- then defers it again so later inserts in this file are checked as usual.
create function pg_temp.check_creator_now()
returns void
language plpgsql
as $$
begin
  set constraints public.families_creator_is_parent immediate;
  set constraints public.families_creator_is_parent deferred;
end;
$$;

-- ---------------------------------------------------------------------------
-- The function's shape and grants
-- ---------------------------------------------------------------------------

select is_definer('public', 'create_family', array['text'], 'create_family is security definer');
select is(
  (select proconfig from pg_catalog.pg_proc where oid = 'public.create_family(text)'::regprocedure),
  array['search_path=""'],
  'create_family runs with an empty search_path'
);
select function_privs_are('public', 'create_family', array['text'], 'anon', array[]::text[],
  'anon cannot execute create_family');
select function_privs_are('public', 'create_family', array['text'], 'authenticated', array['EXECUTE'],
  'authenticated can execute create_family');

-- ---------------------------------------------------------------------------
-- No caller
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

select throws_ok(
  $$ select public.create_family('The Smiths') $$,
  '42501', 'Sign in to create a family.',
  'create_family refuses a request without a user'
);

-- ---------------------------------------------------------------------------
-- User 01: invalid names, then a valid create
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f0700000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.create_family('') $$,
  '23514', 'Enter a family name.',
  'create_family refuses an empty name'
);
select throws_ok(
  $$ select public.create_family('    ') $$,
  '23514', 'Enter a family name.',
  'create_family refuses a name of spaces'
);
select throws_ok(
  $$ select public.create_family(E' \t\n ') $$,
  '23514', 'Enter a family name.',
  'create_family refuses a name of tabs and newlines'
);
select throws_ok(
  $$ select public.create_family(null) $$,
  '23514', 'Enter a family name.',
  'create_family refuses a null name'
);
select throws_ok(
  $$ select public.create_family(repeat('x', 61)) $$,
  '23514', 'Use at most 60 characters.',
  'create_family refuses a name longer than 60 characters'
);
select throws_ok(
  $$ select public.create_family('  ' || repeat('x', 61) || '  ') $$,
  '23514', 'Use at most 60 characters.',
  'create_family measures the name after trimming'
);
select is(family_private.my_family_id(), null, 'refused names leave the user without a family');

select lives_ok(
  $$ insert into created_families (user_id, family_id)
     select 'f0700000-0000-4000-8000-000000000001', public.create_family(E'  The Smiths\t\n') $$,
  'a user without a family can create one'
);
select is(
  (select family_id from created_families where user_id = 'f0700000-0000-4000-8000-000000000001'),
  family_private.my_family_id(),
  'create_family returns the id of the caller''s new family'
);
select results_eq(
  $$ select f.name, f.creator_id from public.families f
     where f.id = (select family_id from created_families
                   where user_id = 'f0700000-0000-4000-8000-000000000001') $$,
  $$ values ('The Smiths', 'f0700000-0000-4000-8000-000000000001'::uuid) $$,
  'the family stores the trimmed name and the caller as creator'
);
select results_eq(
  $$ select family_id, family_name, role, is_creator, permissions from public.get_my_membership() $$,
  $$ select family_id, 'The Smiths', 'parent', true, null::jsonb from created_families
     where user_id = 'f0700000-0000-4000-8000-000000000001' $$,
  'the creator becomes a parent of the new family'
);
select is((select count(*)::integer from public.family_members), 1, 'the new family has only its creator');
select is(
  family_private.is_creator(family_private.my_family_id()), true,
  'is_creator is true for the new family'
);
select is(
  family_private.is_parent(family_private.my_family_id()), true,
  'is_parent is true for the new family'
);
select lives_ok(
  $$ select pg_temp.check_creator_now() $$,
  'the new family passes the deferred creator check'
);

select throws_ok(
  $$ select public.create_family('The Smiths Again') $$,
  '23505', 'You''re already in a family.',
  'create_family refuses a second family for the same user'
);
select is(
  (select f.name from public.families f where f.id = family_private.my_family_id()),
  'The Smiths',
  'the refused second create leaves the first family as it was'
);

-- ---------------------------------------------------------------------------
-- Members of an existing family
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f0700000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.create_family('Another family') $$,
  '23505', 'You''re already in a family.',
  'create_family refuses a family''s creator'
);

select set_config('request.jwt.claims', '{"sub":"f0700000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select throws_ok(
  $$ select public.create_family('Kid family') $$,
  '23505', 'You''re already in a family.',
  'create_family refuses a kid in a family'
);

-- ---------------------------------------------------------------------------
-- Users 02 and 03: the longest name, and a name another family already has
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f0700000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ insert into created_families (user_id, family_id)
     select 'f0700000-0000-4000-8000-000000000002', public.create_family('  ' || repeat('n', 60) || '  ') $$,
  'create_family accepts a name of exactly 60 characters'
);
select is(
  (select f.name from public.families f where f.id = family_private.my_family_id()),
  repeat('n', 60),
  'the 60-character name is stored without the padding'
);

select set_config('request.jwt.claims', '{"sub":"f0700000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ insert into created_families (user_id, family_id)
     select 'f0700000-0000-4000-8000-000000000003', public.create_family('The Smiths') $$,
  'two families may share a name'
);
select is(
  (select count(*)::integer from public.families),
  1,
  'the new creator reads only their own family'
);

-- ---------------------------------------------------------------------------
-- As the table owner: what was written in total
-- ---------------------------------------------------------------------------

reset role;

select is(
  (select count(*)::integer from public.families
   where creator_id in (
     'f0700000-0000-4000-8000-000000000001',
     'f0700000-0000-4000-8000-000000000002',
     'f0700000-0000-4000-8000-000000000003'
   )),
  3,
  'each successful create wrote exactly one family'
);
select is(
  (select count(*)::integer from public.families
   where creator_id in ('f0700000-0000-4000-8000-000000000004', 'f0700000-0000-4000-8000-000000000005')),
  1,
  'refused creates by members wrote no family'
);
select results_eq(
  $$ select m.user_id, m.family_id, m.role from public.family_members m
     where m.user_id in (select user_id from created_families)
     order by m.user_id $$,
  $$ select user_id, family_id, 'parent'::text from created_families order by user_id $$,
  'each creator has exactly one membership, as a parent of the family they created'
);
select is(
  (select count(*)::integer from public.member_permissions p
   join public.family_members m on m.id = p.member_id
   where m.user_id in (select user_id from created_families)),
  0,
  'creating a family writes no permission rows'
);
select lives_ok(
  $$ select pg_temp.check_creator_now() $$,
  'every new family passes the deferred creator check'
);

set local role anon;
select throws_ok(
  $$ select public.create_family('Anonymous family') $$,
  '42501', 'permission denied for function create_family',
  'anon cannot call create_family'
);
reset role;

select * from finish();
rollback;
