begin;
create extension if not exists pgtap;
select plan(38);

-- Users: 01 creates family A, 02 is a kid in A, 03 creates family B,
-- 04 is a kid in B, 05 has no family, 06 is a kid in A used for the catalogue check.
insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f0300000-0000-4000-8000-000000000001', 'family-a-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0300000-0000-4000-8000-000000000002', 'family-a-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0300000-0000-4000-8000-000000000003', 'family-b-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0300000-0000-4000-8000-000000000004', 'family-b-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0300000-0000-4000-8000-000000000005', 'no-family@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0300000-0000-4000-8000-000000000006', 'family-a-kid-two@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

-- Structure
select has_schema('family_private', 'family_private schema exists');
select ok(not has_schema_privilege('anon', 'family_private', 'usage'), 'anon has no usage on family_private');
select ok(has_schema_privilege('authenticated', 'family_private', 'usage'), 'authenticated has usage on family_private');
select has_index('public', 'family_members', 'family_members_family_id_idx', array['family_id'], 'family_members is indexed by family_id');
select ok(
  (select bool_and(relrowsecurity) from pg_catalog.pg_class
   where oid in ('public.families'::regclass, 'public.family_members'::regclass, 'public.member_permissions'::regclass)),
  'RLS is enabled on all three tables'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'public' and tablename in ('families', 'family_members', 'member_permissions')
     and cmd <> 'SELECT'),
  0,
  'the three tables have no write policies (F06 adds the read policies)'
);

-- Setup as the table owner
select lives_ok($$
  insert into public.families (id, name, creator_id) values
    ('f0300000-0000-4000-8000-0000000000a1', 'Family A', 'f0300000-0000-4000-8000-000000000001'),
    ('f0300000-0000-4000-8000-0000000000b1', 'Family B', 'f0300000-0000-4000-8000-000000000003')
$$, 'families can be created');
select lives_ok($$
  insert into public.family_members (id, family_id, user_id, role) values
    ('f0300000-0000-4000-8000-0000000000a2', 'f0300000-0000-4000-8000-0000000000a1', 'f0300000-0000-4000-8000-000000000001', 'parent'),
    ('f0300000-0000-4000-8000-0000000000a3', 'f0300000-0000-4000-8000-0000000000a1', 'f0300000-0000-4000-8000-000000000002', 'kid'),
    ('f0300000-0000-4000-8000-0000000000a4', 'f0300000-0000-4000-8000-0000000000a1', 'f0300000-0000-4000-8000-000000000006', 'kid'),
    ('f0300000-0000-4000-8000-0000000000b2', 'f0300000-0000-4000-8000-0000000000b1', 'f0300000-0000-4000-8000-000000000003', 'parent'),
    ('f0300000-0000-4000-8000-0000000000b3', 'f0300000-0000-4000-8000-0000000000b1', 'f0300000-0000-4000-8000-000000000004', 'kid')
$$, 'members can be added');
select lives_ok($$
  insert into public.member_permissions (member_id, module, level) values
    ('f0300000-0000-4000-8000-0000000000a3', 'expenses', 'edit'),
    ('f0300000-0000-4000-8000-0000000000a3', 'family_finance', 'view'),
    ('f0300000-0000-4000-8000-0000000000b3', 'expenses', 'off')
$$, 'allowed permissions can be stored');
select is(
  (select joined_at is not null and last_active_at is null from public.family_members
   where id = 'f0300000-0000-4000-8000-0000000000a2'),
  true,
  'joined_at defaults to now and last_active_at starts empty'
);
select isnt(
  (select id from public.family_members where user_id = 'f0300000-0000-4000-8000-000000000001'),
  null,
  'member ids are generated'
);

-- Families
select throws_ok($$
  insert into public.families (name, creator_id) values ('', 'f0300000-0000-4000-8000-000000000005')
$$, '23514', null, 'an empty family name is rejected');
select throws_ok($$
  insert into public.families (name, creator_id) values (' Family ', 'f0300000-0000-4000-8000-000000000005')
$$, '23514', null, 'an untrimmed family name is rejected');
select throws_ok($$
  insert into public.families (name, creator_id) values (repeat('a', 61), 'f0300000-0000-4000-8000-000000000005')
$$, '23514', null, 'a family name over 60 characters is rejected');
select lives_ok($$
  insert into public.families (name, creator_id) values (repeat('a', 60), 'f0300000-0000-4000-8000-000000000005')
$$, 'a 60-character family name is accepted');

-- Members
select throws_ok($$
  insert into public.family_members (family_id, user_id, role)
  values ('f0300000-0000-4000-8000-0000000000b1', 'f0300000-0000-4000-8000-000000000001', 'parent')
$$, '23505', null, 'a user cannot join a second family');
select throws_ok($$
  insert into public.family_members (family_id, user_id, role)
  values ('f0300000-0000-4000-8000-0000000000a1', 'f0300000-0000-4000-8000-000000000002', 'kid')
$$, '23505', null, 'a user cannot be added twice to the same family');
select throws_ok($$
  insert into public.family_members (family_id, user_id, role)
  values ('f0300000-0000-4000-8000-0000000000a1', 'f0300000-0000-4000-8000-000000000005', 'admin')
$$, '23514', null, 'an unknown role is rejected');

-- Permissions
select throws_ok($$
  insert into public.member_permissions (member_id, module, level)
  values ('f0300000-0000-4000-8000-0000000000a3', 'boats', 'edit')
$$, '23514', null, 'an unknown module is rejected');
select throws_ok($$
  insert into public.member_permissions (member_id, module, level)
  values ('f0300000-0000-4000-8000-0000000000a3', 'investments', 'view')
$$, '23514', null, 'a level the module does not allow is rejected');
select throws_ok($$
  insert into public.member_permissions (member_id, module, level)
  values ('f0300000-0000-4000-8000-0000000000a3', 'investments', 'admin')
$$, '23514', null, 'an unknown level is rejected');
select throws_ok($$
  insert into public.member_permissions (member_id, module, level)
  values ('f0300000-0000-4000-8000-0000000000a3', 'expenses', 'off')
$$, '23505', null, 'a member has at most one level per module');

-- The check allows exactly MODULE_LEVELS from src/lib/permissions.ts.
create function pg_temp.accepts_permission(p_module text, p_level text)
returns boolean
language plpgsql
as $$
begin
  insert into public.member_permissions (member_id, module, level)
  values ('f0300000-0000-4000-8000-0000000000a4', p_module, p_level);
  delete from public.member_permissions where member_id = 'f0300000-0000-4000-8000-0000000000a4';
  return true;
exception when check_violation then
  return false;
end;
$$;
select results_eq(
  $$
    select m, l
    from unnest(array['expenses', 'investments', 'net_worth', 'family_finance', 'boats']) as m
    cross join unnest(array['off', 'view', 'edit', 'admin']) as l
    where pg_temp.accepts_permission(m, l)
    order by m, l
  $$,
  $$
    select m, l from (values
      ('expenses', 'edit'), ('expenses', 'off'),
      ('family_finance', 'off'), ('family_finance', 'view'),
      ('investments', 'edit'), ('investments', 'off'),
      ('net_worth', 'edit'), ('net_worth', 'off')
    ) as allowed(m, l)
    order by m, l
  $$,
  'the check allows exactly the module and level pairs of the catalogue'
);

-- Direct reads as a signed-in user without a family. What members can read is
-- tested in family_read_access.sql (F06).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0300000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select is((select count(*)::integer from public.families), 0, 'a user without a family cannot read families');
select is((select count(*)::integer from public.family_members), 0, 'a user without a family cannot read family_members');
select is((select count(*)::integer from public.member_permissions), 0, 'a user without a family cannot read member_permissions');

-- Direct writes as a signed-in member of family B
select set_config('request.jwt.claims', '{"sub":"f0300000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$
  insert into public.families (name, creator_id) values ('Mine', 'f0300000-0000-4000-8000-000000000003')
$$, '42501', null, 'authenticated cannot insert families');
select throws_ok($$
  update public.families set name = 'Renamed' where id = 'f0300000-0000-4000-8000-0000000000b1'
$$, '42501', null, 'authenticated cannot update families');
select throws_ok($$
  delete from public.families where id = 'f0300000-0000-4000-8000-0000000000b1'
$$, '42501', null, 'authenticated cannot delete families');
select throws_ok($$
  insert into public.family_members (family_id, user_id, role)
  values ('f0300000-0000-4000-8000-0000000000a1', 'f0300000-0000-4000-8000-000000000005', 'kid')
$$, '42501', null, 'authenticated cannot insert family_members');
select throws_ok($$
  update public.family_members set role = 'parent' where id = 'f0300000-0000-4000-8000-0000000000b3'
$$, '42501', null, 'authenticated cannot update family_members');
select throws_ok($$
  insert into public.member_permissions (member_id, module, level)
  values ('f0300000-0000-4000-8000-0000000000b3', 'investments', 'edit')
$$, '42501', null, 'authenticated cannot insert member_permissions');
select throws_ok($$
  delete from public.member_permissions where member_id = 'f0300000-0000-4000-8000-0000000000b3'
$$, '42501', null, 'authenticated cannot delete member_permissions');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from public.family_members $$, '42501', null, 'anon cannot read family_members');

-- Deletion, as the table owner again
reset role;
select throws_ok($$
  delete from auth.users where id = 'f0300000-0000-4000-8000-000000000003'
$$, '23503', null, 'a family creator cannot be deleted while the family exists');

delete from public.families where id = 'f0300000-0000-4000-8000-0000000000a1';
select is(
  (select count(*)::integer from public.family_members where family_id = 'f0300000-0000-4000-8000-0000000000a1'),
  0,
  'deleting a family deletes its members'
);
select is(
  (select count(*)::integer from public.member_permissions
   where member_id in ('f0300000-0000-4000-8000-0000000000a3', 'f0300000-0000-4000-8000-0000000000a4')),
  0,
  'deleting a family deletes its members'' permissions'
);
select is(
  (select count(*)::integer from public.member_permissions where member_id = 'f0300000-0000-4000-8000-0000000000b3'),
  1,
  'deleting a family leaves other families alone'
);

select * from finish();
rollback;
