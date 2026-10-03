begin;
create extension if not exists pgtap;
select plan(26);

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000031', 'tabs-a@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000032', 'tabs-b@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.expenses (id, user_id, description, amount, category, expense_date)
values ('60000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000031', 'Unrelated expense', 12.34, 'transport', '2026-10-01');
insert into public.categories (id, user_id, name, color)
values ('70000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000031', 'Unrelated category', '#ffffff');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000031","role":"authenticated"}', true);

select lives_ok($$
  insert into public.expense_tabs (id, user_id, name, category_keys)
  values ('40000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000031', 'Car', array['car'])
$$, 'owner can create a category tab');
select lives_ok($$
  insert into public.expense_tabs (id, user_id, name, subtype_keys)
  values ('40000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000031', 'Fuel', array['car_fuel'])
$$, 'owner can create a subtype-only tab');
select is((select count(*)::integer from public.expense_tabs), 2, 'owner can retrieve saved tabs');
select is((select name from public.expense_tabs where id = '40000000-0000-4000-8000-000000000031'), 'Car', 'saved name reloads');
select is((select subtype_keys from public.expense_tabs where id = '40000000-0000-4000-8000-000000000032'), array['car_fuel'], 'saved array reloads');

select throws_ok($$
  insert into public.expense_tabs (user_id, name, category_keys)
  values ('10000000-0000-4000-8000-000000000032', 'Forged owner', array['car'])
$$, '42501', null, 'cross-owner insert is rejected');
select throws_ok($$
  update public.expense_tabs set user_id = '10000000-0000-4000-8000-000000000032'
  where id = '40000000-0000-4000-8000-000000000031'
$$, '42501', null, 'ownership reassignment is rejected');
select throws_ok($$
  insert into public.expense_tabs (user_id, name) values ('10000000-0000-4000-8000-000000000031', 'Empty')
$$, '23514', null, 'empty selection is rejected');
select throws_ok($$
  insert into public.expense_tabs (user_id, name, category_keys)
  values ('10000000-0000-4000-8000-000000000031', 'Invalid', array['boats'])
$$, '23514', null, 'unknown category is rejected');
select throws_ok($$
  insert into public.expense_tabs (user_id, name, subtype_keys)
  values ('10000000-0000-4000-8000-000000000031', 'Invalid', array['diesel'])
$$, '23514', null, 'unknown subtype is rejected');
select throws_ok($$
  insert into public.expense_tabs (user_id, name, category_keys)
  values ('10000000-0000-4000-8000-000000000031', 'Invalid', array['car', null])
$$, '23514', null, 'null category entry is rejected');
select throws_ok($$
  insert into public.expense_tabs (user_id, name, subtype_keys)
  values ('10000000-0000-4000-8000-000000000031', 'Invalid', array['car_fuel', null])
$$, '23514', null, 'null subtype entry is rejected');
select throws_ok($$
  insert into public.expense_tabs (user_id, name, category_keys)
  values ('10000000-0000-4000-8000-000000000031', ' ', array['car'])
$$, '23514', null, 'blank name is rejected');
select throws_ok($$
  insert into public.expense_tabs (user_id, name, category_keys)
  values ('10000000-0000-4000-8000-000000000031', ' Car ', array['car'])
$$, '23514', null, 'untrimmed names are rejected');

select lives_ok($$
  update public.expense_tabs set name = 'Car spending', category_keys = array['car', 'transport']
  where id = '40000000-0000-4000-8000-000000000031'
$$, 'owner can rename and edit selections');
select is((select name from public.expense_tabs where id = '40000000-0000-4000-8000-000000000031'), 'Car spending', 'renaming preserves the stable identifier');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000032","role":"authenticated"}', true);
select is((select count(*)::integer from public.expense_tabs), 0, 'another owner cannot retrieve tabs');
with changed as (
  update public.expense_tabs set name = 'Stolen' where id = '40000000-0000-4000-8000-000000000031' returning id
) select is((select count(*)::integer from changed), 0, 'cross-owner update affects no rows');
with removed as (
  delete from public.expense_tabs where id = '40000000-0000-4000-8000-000000000031' returning id
) select is((select count(*)::integer from removed), 0, 'cross-owner deletion affects no rows');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000031","role":"authenticated"}', true);
with removed as (
  delete from public.expense_tabs where id = '40000000-0000-4000-8000-000000000031' returning id
) select is((select count(*)::integer from removed), 1, 'owner can delete the selected tab');
select is((select count(*)::integer from public.expense_tabs), 1, 'other tab survives deletion');
select is((select amount::numeric from public.expenses where id = '60000000-0000-4000-8000-000000000031'), 12.34::numeric, 'tab deletion preserves expenses');
select is((select name from public.categories where id = '70000000-0000-4000-8000-000000000031'), 'Unrelated category', 'tab deletion preserves categories');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from public.expense_tabs $$, '42501', null, 'anonymous reads are rejected');
select throws_ok($$
  insert into public.expense_tabs (user_id, name, category_keys)
  values ('10000000-0000-4000-8000-000000000031', 'Anon', array['car'])
$$, '42501', null, 'anonymous inserts are rejected');
select throws_ok($$ delete from public.expense_tabs $$, '42501', null, 'anonymous deletion is rejected');

reset role;
select * from finish();
rollback;
