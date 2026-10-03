begin;
create extension if not exists pgtap;
select plan(7);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('71000000-0000-0000-0000-000000000001', 'expense-subtypes@example.test', 'not-used', now(), '{}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok($$
  insert into public.expenses (user_id, description, amount, category, expense_date)
  values ('71000000-0000-0000-0000-000000000001', 'Old style fixture', 10, 'transport', '2026-09-01')
$$, 'old writes omitting subtype remain valid');
select is((select subtype from public.expenses where description = 'Old style fixture'), null::text, 'old writes store null subtype');

select lives_ok($$
  insert into public.expenses (user_id, description, amount, category, subtype, expense_date)
  values ('71000000-0000-0000-0000-000000000001', 'Car fixture', 10, 'car', null, '2026-09-01'),
    ('71000000-0000-0000-0000-000000000001', 'Maintenance fixture', 10, 'car', 'car_maintenance', '2026-09-01'),
    ('71000000-0000-0000-0000-000000000001', 'Fuel fixture', 10, 'car', 'car_fuel', '2026-09-01'),
    ('71000000-0000-0000-0000-000000000001', 'Repairs fixture', 10, 'car', 'car_repairs', '2026-09-01')
$$, 'Car accepts null and every supported subtype');

select throws_ok($$
  insert into public.expenses (user_id, description, amount, category, subtype, expense_date)
  values ('71000000-0000-0000-0000-000000000001', 'Wrong parent', 10, 'transport', 'car_fuel', '2026-09-01')
$$, '23514', null, 'wrong parent is rejected by the database');
select throws_ok($$
  insert into public.expenses (user_id, description, amount, category, subtype, expense_date)
  values ('71000000-0000-0000-0000-000000000001', 'Unknown subtype', 10, 'car', 'fuel', '2026-09-01')
$$, '23514', null, 'unknown subtype is rejected by the database');
select throws_ok($$
  update public.expenses set category = 'groceries' where description = 'Fuel fixture'
$$, '23514', null, 'direct updates cannot retain an incompatible subtype');
select throws_ok($$
  insert into public.expenses (user_id, description, amount, category, expense_date)
  values ('71000000-0000-0000-0000-000000000001', 'Unknown category', 10, 'vehicle', '2026-09-01')
$$, '23514', null, 'unknown categories remain invalid');

select * from finish();
rollback;
