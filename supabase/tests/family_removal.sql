begin;
create extension if not exists pgtap;
select plan(70);

-- F12: remove_family_member() and delete_family().
--
-- Users (prefix f1200000):
--   family A ('Family A'): 01 creator, 02 second parent, 03 kid, 04 kid
--   family B ('Family B'): 05 creator, 06 kid, 07 second parent
--   08 has no family.
-- Member ids: a2..a5 in family a1, b2..b4 in family b1, in user order.
-- Users 01-04 and 06 each have one expense.

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f1200000-0000-4000-8000-000000000001', 'f12-a-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1200000-0000-4000-8000-000000000002', 'f12-a-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1200000-0000-4000-8000-000000000003', 'f12-a-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1200000-0000-4000-8000-000000000004', 'f12-a-kid-two@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1200000-0000-4000-8000-000000000005', 'f12-b-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1200000-0000-4000-8000-000000000006', 'f12-b-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1200000-0000-4000-8000-000000000007', 'f12-b-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1200000-0000-4000-8000-000000000008', 'f12-no-family@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('f1200000-0000-4000-8000-0000000000a1', 'Family A', 'f1200000-0000-4000-8000-000000000001'),
  ('f1200000-0000-4000-8000-0000000000b1', 'Family B', 'f1200000-0000-4000-8000-000000000005');

insert into public.family_members (id, family_id, user_id, role) values
  ('f1200000-0000-4000-8000-0000000000a2', 'f1200000-0000-4000-8000-0000000000a1', 'f1200000-0000-4000-8000-000000000001', 'parent'),
  ('f1200000-0000-4000-8000-0000000000a3', 'f1200000-0000-4000-8000-0000000000a1', 'f1200000-0000-4000-8000-000000000002', 'parent'),
  ('f1200000-0000-4000-8000-0000000000a4', 'f1200000-0000-4000-8000-0000000000a1', 'f1200000-0000-4000-8000-000000000003', 'kid'),
  ('f1200000-0000-4000-8000-0000000000a5', 'f1200000-0000-4000-8000-0000000000a1', 'f1200000-0000-4000-8000-000000000004', 'kid'),
  ('f1200000-0000-4000-8000-0000000000b2', 'f1200000-0000-4000-8000-0000000000b1', 'f1200000-0000-4000-8000-000000000005', 'parent'),
  ('f1200000-0000-4000-8000-0000000000b3', 'f1200000-0000-4000-8000-0000000000b1', 'f1200000-0000-4000-8000-000000000006', 'kid'),
  ('f1200000-0000-4000-8000-0000000000b4', 'f1200000-0000-4000-8000-0000000000b1', 'f1200000-0000-4000-8000-000000000007', 'parent');

-- Kids a4 and a5 each have two rows, kid b3 one.
insert into public.member_permissions (member_id, module, level) values
  ('f1200000-0000-4000-8000-0000000000a4', 'expenses', 'edit'),
  ('f1200000-0000-4000-8000-0000000000a4', 'family_finance', 'view'),
  ('f1200000-0000-4000-8000-0000000000a5', 'expenses', 'edit'),
  ('f1200000-0000-4000-8000-0000000000a5', 'investments', 'edit'),
  ('f1200000-0000-4000-8000-0000000000b3', 'expenses', 'edit');

insert into public.expenses (user_id, description, amount, category, expense_date) values
  ('f1200000-0000-4000-8000-000000000001', 'F12 creator lunch', 12.50, 'groceries', '2026-10-01'),
  ('f1200000-0000-4000-8000-000000000002', 'F12 parent fuel', 40.00, 'transport', '2026-10-02'),
  ('f1200000-0000-4000-8000-000000000003', 'F12 kid comic', 5.00, 'entertainment', '2026-10-03'),
  ('f1200000-0000-4000-8000-000000000004', 'F12 kid snack', 2.00, 'groceries', '2026-10-04'),
  ('f1200000-0000-4000-8000-000000000006', 'F12 b kid toy', 9.00, 'entertainment', '2026-10-05');

-- Every membership as 'member:role', read as the table owner so RLS never
-- hides a row.
create function pg_temp.all_members()
returns text[]
language sql
security definer
as $$
  select coalesce(array_agg(right(m.id::text, 2) || ':' || m.role order by m.id), '{}')
  from public.family_members m
  where m.id::text like 'f1200000-%'
$$;

-- Every permission row as 'member:module', read as the table owner.
create function pg_temp.all_permissions()
returns text[]
language sql
security definer
as $$
  select coalesce(array_agg(right(p.member_id::text, 2) || ':' || p.module
    order by p.member_id, p.module), '{}')
  from public.member_permissions p
  where p.member_id::text like 'f1200000-%'
$$;

-- Every notice as 'user:kind:family name:seen', read as the table owner.
create function pg_temp.all_notices()
returns text[]
language sql
security definer
as $$
  select coalesce(array_agg(
    right(n.user_id::text, 2) || ':' || n.kind || ':' || n.family_name || ':'
      || case when n.seen_at is null then 'unseen' else 'seen' end
    order by n.user_id, n.kind
  ), '{}')
  from public.account_notices n
  where n.user_id::text like 'f1200000-%'
$$;

-- Every family's expenses, as the users who own them, read as the table owner.
create function pg_temp.expense_owners()
returns text[]
language sql
security definer
as $$
  select coalesce(array_agg(right(e.user_id::text, 2) order by e.user_id), '{}')
  from public.expenses e
  where e.user_id::text like 'f1200000-%'
$$;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from pg_catalog.pg_proc p
   where p.oid in (
       'public.remove_family_member(uuid)'::regprocedure,
       'public.delete_family(text)'::regprocedure
     )
     and p.prosecdef
     and p.provolatile = 'v'
     and p.proconfig = array['search_path=""']),
  2,
  'both RPCs are security definer, volatile and pin an empty search_path'
);
select function_privs_are('public', 'remove_family_member', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated can execute remove_family_member');
select function_privs_are('public', 'delete_family', array['text'], 'authenticated', array['EXECUTE'],
  'authenticated can execute delete_family');
select function_privs_are('public', 'remove_family_member', array['uuid'], 'anon', array[]::text[],
  'anon cannot execute remove_family_member');
select function_privs_are('public', 'delete_family', array['text'], 'anon', array[]::text[],
  'anon cannot execute delete_family');

-- ---------------------------------------------------------------------------
-- A second parent can't remove anyone or delete the family
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000a4') $$,
  '42501', 'Only the family''s creator can remove members.',
  'a second parent cannot remove a kid'
);
select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000a2') $$,
  '42501', 'Only the family''s creator can remove members.',
  'a second parent cannot remove the creator'
);
select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000a3') $$,
  '42501', 'Only the family''s creator can remove members.',
  'a second parent cannot remove themselves'
);
select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-00000000ffff') $$,
  '42501', 'Only the family''s creator can remove members.',
  'a second parent gets 42501, not 404, for an unknown member'
);
select throws_ok(
  $$ select public.delete_family('Family A') $$,
  '42501', 'Only the family''s creator can delete the family.',
  'a second parent cannot delete the family, even with the right name'
);
select throws_ok(
  $$ select public.delete_family('wrong') $$,
  '42501', 'Only the family''s creator can delete the family.',
  'a second parent gets 42501, not 422, for a wrong name'
);

-- ---------------------------------------------------------------------------
-- A kid can't remove anyone or delete the family
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000a5') $$,
  '42501', 'Only the family''s creator can remove members.',
  'a kid cannot remove a sibling'
);
select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000a4') $$,
  '42501', 'Only the family''s creator can remove members.',
  'a kid cannot remove themselves'
);
select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000a2') $$,
  '42501', 'Only the family''s creator can remove members.',
  'a kid cannot remove the creator'
);
select throws_ok(
  $$ select public.delete_family('Family A') $$,
  '42501', 'Only the family''s creator can delete the family.',
  'a kid cannot delete the family'
);

-- ---------------------------------------------------------------------------
-- Users without a family, or without a user id
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000008","role":"authenticated"}', true);
select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000a4') $$,
  '42501', 'Only the family''s creator can remove members.',
  'a user without a family cannot remove anyone'
);
select throws_ok(
  $$ select public.delete_family('Family A') $$,
  '42501', 'Only the family''s creator can delete the family.',
  'a user without a family cannot delete a family'
);

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000a4') $$,
  '42501', 'Only the family''s creator can remove members.',
  'a caller without a user id cannot remove anyone'
);
select throws_ok(
  $$ select public.delete_family('Family A') $$,
  '42501', 'Only the family''s creator can delete the family.',
  'a caller without a user id cannot delete a family'
);

-- ---------------------------------------------------------------------------
-- The creator: refused for themselves, other families and unknown members
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000a2') $$,
  '42501', 'You can''t remove yourself from a family you created. Delete the family instead.',
  'the creator cannot remove themselves'
);
select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000b3') $$,
  'P0002', 'That family member wasn''t found.',
  'the creator cannot remove another family''s kid'
);
select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000b2') $$,
  'P0002', 'That family member wasn''t found.',
  'another family''s creator is not found either, so nothing about them is revealed'
);
select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-00000000ffff') $$,
  'P0002', 'That family member wasn''t found.',
  'an unknown member is not found'
);
select throws_ok(
  $$ select public.remove_family_member(null) $$,
  'P0002', 'That family member wasn''t found.',
  'a null member id is not found'
);

-- A wrong confirmation name.
select throws_ok(
  $$ select public.delete_family('Family B') $$,
  '23514', 'Type the family''s name to confirm.',
  'another family''s name is refused'
);
select throws_ok(
  $$ select public.delete_family('Family') $$,
  '23514', 'Type the family''s name to confirm.',
  'part of the name is refused'
);
select throws_ok(
  $$ select public.delete_family('Family  A') $$,
  '23514', 'Type the family''s name to confirm.',
  'whitespace inside the name still counts'
);
select throws_ok(
  $$ select public.delete_family('   ') $$,
  '23514', 'Type the family''s name to confirm.',
  'a blank name is refused'
);
select throws_ok(
  $$ select public.delete_family(null) $$,
  '23514', 'Type the family''s name to confirm.',
  'a null name is refused'
);

reset role;
select is(
  pg_temp.all_members(),
  array['a2:parent', 'a3:parent', 'a4:kid', 'a5:kid', 'b2:parent', 'b3:kid', 'b4:parent'],
  'the refused calls removed no memberships'
);
select is(
  (select count(*)::integer from public.families where id::text like 'f1200000-%'),
  2,
  'the refused calls deleted no family'
);
select is(pg_temp.all_notices(), '{}'::text[], 'the refused calls wrote no notices');

-- ---------------------------------------------------------------------------
-- The creator removes a kid and a second parent
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000a4') $$,
  'the creator can remove a kid'
);
select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000a4') $$,
  'P0002', 'That family member wasn''t found.',
  'removing the same member again is not found'
);

select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select lives_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000b4') $$,
  'a creator can remove a second parent'
);
select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000a5') $$,
  'P0002', 'That family member wasn''t found.',
  'another family''s creator cannot remove a kid'
);

reset role;
select is(
  pg_temp.all_members(),
  array['a2:parent', 'a3:parent', 'a5:kid', 'b2:parent', 'b3:kid'],
  'only the two removed memberships are gone'
);
select is(
  pg_temp.all_permissions(),
  array['a5:expenses', 'a5:investments', 'b3:expenses'],
  'the removed kid''s permissions cascaded, and nobody else''s changed'
);
select is(
  pg_temp.all_notices(),
  array[
    '03:removed_from_family:Family A:unseen',
    '07:removed_from_family:Family B:unseen'
  ],
  'each removed user got one removed_from_family notice with the family''s name'
);
select is(
  pg_temp.expense_owners(),
  array['01', '02', '03', '04', '06'],
  'removing members leaves every expense in place'
);

-- The removed kid sees no family, their notice and their own expense.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.get_my_membership()),
  0,
  'the removed kid has no membership'
);
select is(public.get_family(), null, 'the removed kid sees no family');
select is(
  (select array_agg(kind || ':' || family_name) from public.get_my_notices()),
  array['removed_from_family:Family A'],
  'the removed kid sees their notice'
);
select is(
  (select array_agg(description) from public.expenses),
  array['F12 kid comic'],
  'the removed kid still reads their own expense'
);

-- The rest of family A no longer sees the removed kid.
select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.family_members),
  3,
  'the second parent now sees three members in family A'
);
select is(
  (select count(*)::integer from public.get_my_notices()),
  0,
  'members who stay get no notice'
);

-- ---------------------------------------------------------------------------
-- The creator deletes family A
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.delete_family(E' \tfAMILY a\n ') $$,
  'the creator can delete the family, ignoring case and surrounding whitespace'
);

reset role;
select is(
  (select count(*)::integer from public.families where id = 'f1200000-0000-4000-8000-0000000000a1'),
  0,
  'family A is gone'
);
select is(
  pg_temp.all_members(),
  array['b2:parent', 'b3:kid'],
  'every family A membership cascaded, the creator''s included; family B is untouched'
);
select is(
  pg_temp.all_permissions(),
  array['b3:expenses'],
  'family A''s permission rows cascaded; family B''s are untouched'
);
select is(
  pg_temp.all_notices(),
  array[
    '02:family_deleted:Family A:unseen',
    '03:removed_from_family:Family A:unseen',
    '04:family_deleted:Family A:unseen',
    '07:removed_from_family:Family B:unseen'
  ],
  'every other remaining member got a family_deleted notice; the creator and the removed kid did not'
);
select is(
  (select count(*)::integer from public.account_notices
   where user_id = 'f1200000-0000-4000-8000-000000000001'),
  0,
  'the creator gets no notice'
);
select is(
  pg_temp.expense_owners(),
  array['01', '02', '03', '04', '06'],
  'deleting the family leaves every expense in place'
);
select is(
  (select count(*)::integer from public.families where id = 'f1200000-0000-4000-8000-0000000000b1'),
  1,
  'family B still exists'
);

-- Former members see no family, and still read their own expenses.
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::integer from public.get_my_membership()), 0, 'the former creator has no membership');
select is(public.get_family(), null, 'the former creator sees no family');
select is(
  (select array_agg(description) from public.expenses),
  array['F12 creator lunch'],
  'the former creator still reads their own expense'
);
select throws_ok(
  $$ select public.delete_family('Family A') $$,
  '42501', 'Only the family''s creator can delete the family.',
  'deleting again is refused: the former creator has no family'
);
select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000a5') $$,
  '42501', 'Only the family''s creator can remove members.',
  'the former creator can no longer remove anyone'
);

select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::integer from public.get_my_membership()), 0, 'the former second parent has no membership');
select is(
  (select array_agg(kind || ':' || family_name) from public.get_my_notices()),
  array['family_deleted:Family A'],
  'the former second parent sees a family_deleted notice'
);
select is(
  (select array_agg(description) from public.expenses),
  array['F12 parent fuel'],
  'the former second parent still reads their own expense'
);

select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::integer from public.get_my_membership()), 0, 'the former kid has no membership');
select is(
  (select array_agg(kind || ':' || family_name) from public.get_my_notices()),
  array['family_deleted:Family A'],
  'the former kid sees a family_deleted notice'
);
select is(
  (select array_agg(description) from public.expenses),
  array['F12 kid snack'],
  'the former kid still reads their own expense'
);

-- Family B is unaffected.
select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000006","role":"authenticated"}', true);
select is(
  (select family_name from public.get_my_membership()),
  'Family B',
  'a member of another family keeps their membership'
);
select is((select count(*)::integer from public.get_my_notices()), 0, 'a member of another family gets no notice');

-- A former creator can start over.
select set_config('request.jwt.claims', '{"sub":"f1200000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.create_family('Family A again') $$,
  'the former creator can create a new family'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select public.remove_family_member('f1200000-0000-4000-8000-0000000000b3') $$,
  '42501', null, 'anon cannot call remove_family_member'
);
select throws_ok(
  $$ select public.delete_family('Family B') $$,
  '42501', null, 'anon cannot call delete_family'
);

reset role;
select * from finish();
rollback;
