begin;

create extension if not exists pgtap;

select plan(19);

insert into auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '10000000-0000-0000-0000-000000000011',
    'net-worth-rls-a@example.test',
    'not-used',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000012',
    'net-worth-rls-b@example.test',
    'not-used',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  )
on conflict (id) do nothing;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000011","role":"authenticated"}',
  true
);

select lives_ok($$
  select public.create_net_worth_item_with_valuation(
    'BCR current account', 'asset', 'cash', 'EUR', null, 1250.50, '2026-09-19'
  )
$$, 'owner can atomically create a fractional cash item and first valuation');

insert into public.net_worth_items (
  id, user_id, name, kind, category, currency, purchase_amount
)
values (
  '40000000-0000-0000-0000-000000000011',
  '10000000-0000-0000-0000-000000000011',
  'Bucharest apartment',
  'asset',
  'property',
  'EUR',
  180000
);

insert into public.net_worth_valuations (item_id, value, valued_on)
values
  ('40000000-0000-0000-0000-000000000011', 220000.25, '2026-09-18'),
  ('40000000-0000-0000-0000-000000000011', 221000.25, '2026-09-19');

select is(
  (select count(*)::integer from public.net_worth_items),
  2,
  'owner sees only their manual items'
);
select is(
  (select count(*)::integer from public.net_worth_valuations),
  3,
  'owner sees their item valuations'
);

select lives_ok($$
  update public.net_worth_items
  set name = 'Bucharest apartment, owned share'
  where id = '40000000-0000-0000-0000-000000000011'
$$, 'owner can update item details');

select lives_ok($$
  update public.net_worth_valuations
  set value = 222000.25
  where item_id = '40000000-0000-0000-0000-000000000011'
    and valued_on = '2026-09-19'
$$, 'owner can correct a dated valuation');

select is(
  (select value::numeric from public.net_worth_valuations
   where item_id = '40000000-0000-0000-0000-000000000011'
     and valued_on = '2026-09-19'),
  222000.25::numeric,
  'valuation correction is visible to its owner'
);

select throws_ok($$
  insert into public.net_worth_items (
    user_id, name, kind, category, currency, purchase_amount
  ) values (
    '10000000-0000-0000-0000-000000000012', 'Other user item', 'asset', 'cash', 'EUR', null
  )
$$, '42501', null, 'cross-user item insert is rejected');

select lives_ok($$
  insert into public.net_worth_valuations (item_id, value, valued_on)
  values ('40000000-0000-0000-0000-000000000011', 1, '2026-09-20')
$$, 'owner can add another dated valuation');

select lives_ok($$
  insert into public.net_worth_valuations (item_id, value, valued_on)
  values ('40000000-0000-0000-0000-000000000011', 1, '2026-09-20')
  on conflict (item_id, valued_on) do update set value = excluded.value
$$, 'owner can use an upsert for a corrected date');

select throws_ok($$
  insert into public.net_worth_items (
    user_id, name, kind, category, currency, purchase_amount
  ) values (
    '10000000-0000-0000-0000-000000000011', 'Bad currency', 'asset', 'cash', 'eur', null
  )
$$, '23514', null, 'lowercase currencies are rejected');

select throws_ok($$
  insert into public.net_worth_valuations (item_id, value, valued_on)
  values ('40000000-0000-0000-0000-000000000011', -1, '2026-09-21')
$$, '23514', null, 'negative valuations are rejected');

select throws_ok($$
  insert into public.net_worth_items (
    user_id, name, kind, category, currency, purchase_amount
  ) values (
    '10000000-0000-0000-0000-000000000011', 'Cash baseline', 'asset', 'cash', 'EUR', 10
  )
$$, '23514', null, 'cash cannot carry a purchase amount');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000012","role":"authenticated"}',
  true
);

select is(
  (select count(*)::integer from public.net_worth_items),
  0,
  'second user cannot read the first user items'
);
select is(
  (select count(*)::integer from public.net_worth_valuations),
  0,
  'second user cannot read the first user valuations'
);

select lives_ok($$
  update public.net_worth_items
  set archived_at = now()
  where id = '40000000-0000-0000-0000-000000000011'
$$, 'cross-user item update is harmless and affects no visible row');

select is(
  (select count(*)::integer from public.net_worth_items
   where id = '40000000-0000-0000-0000-000000000011'),
  0,
  'cross-user item remains invisible after update attempt'
);

select throws_ok($$
  insert into public.net_worth_valuations (item_id, value, valued_on)
  values ('40000000-0000-0000-0000-000000000011', 1, '2026-09-22')
$$, '42501', null, 'cross-user valuation insert is rejected');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select count(*) from public.net_worth_items $$,
  '42501', null,
  'anonymous item reads are rejected'
);
select throws_ok(
  $$ insert into public.net_worth_valuations (item_id, value, valued_on)
     values ('40000000-0000-0000-0000-000000000011', 1, '2026-09-23') $$,
  '42501', null,
  'anonymous valuation inserts are rejected'
);

reset role;
select * from finish();
rollback;
