begin;

create extension if not exists pgtap;

select plan(18);

-- These fixtures are rolled back with the test transaction. The selected
-- roles below exercise the same auth.uid() claim used by the application.
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
    '10000000-0000-0000-0000-000000000001',
    'investments-rls-a@example.test',
    'not-used',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'investments-rls-b@example.test',
    'not-used',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  )
on conflict (id) do nothing;

insert into public.investment_accounts (id, user_id, broker_id)
values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'xtb'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'banca_transilvania'
  );

insert into public.investment_transactions (
  id,
  investment_account_id,
  instrument,
  currency,
  side,
  amount,
  quantity,
  unit_price,
  executed_at
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'VWCE.DE',
    'EUR',
    'buy',
    150,
    1.5,
    100,
    '2026-01-01T10:00:00Z'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'TLV.BX',
    'RON',
    'buy',
    8750,
    100,
    87.5,
    '2026-01-01T10:00:00Z'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select is(
  (select count(*)::integer from public.investment_accounts),
  1,
  'owner sees only their investment account'
);
select is(
  (select count(*)::integer from public.investment_transactions),
  1,
  'owner sees only transactions through their account'
);

select lives_ok($$
  insert into public.investment_transactions (
    investment_account_id, instrument, currency, side, amount, quantity,
    unit_price, executed_at
  ) values (
    '20000000-0000-0000-0000-000000000001', 'AAPL.US', 'USD', 'buy',
    250, 0.5, 500, '2026-01-02T10:00:00Z'
  )
$$, 'owner can insert a valid fractional transaction');

select is(
  (select count(*)::integer
   from public.investment_transactions
   where instrument = 'AAPL.US'),
  1,
  'owner can read the inserted transaction'
);

select lives_ok($$
  delete from public.investment_transactions
  where instrument = 'AAPL.US'
$$, 'owner can delete their transaction');

select is(
  (select count(*)::integer
   from public.investment_transactions
   where instrument = 'AAPL.US'),
  0,
  'owner deletion is effective'
);

select throws_ok($$
  insert into public.investment_transactions (
    investment_account_id, instrument, currency, side, amount, quantity,
    unit_price, executed_at
  ) values (
    '20000000-0000-0000-0000-000000000002', 'TLV.BX', 'RON', 'buy',
    10, 1, 10, '2026-01-02T10:00:00Z'
  )
$$, '42501', null, 'cross-user transaction insert is rejected');

select throws_ok($$
  insert into public.investment_transactions (
    investment_account_id, instrument, currency, side, amount, quantity,
    unit_price, executed_at
  ) values (
    '20000000-0000-0000-0000-000000000999', 'VWCE.DE', 'EUR', 'buy',
    10, 1, 10, '2026-01-02T10:00:00Z'
  )
$$, '42501', null, 'orphan or inaccessible transaction insert is rejected');

select throws_ok($$
  insert into public.investment_accounts (user_id, broker_id)
  values ('10000000-0000-0000-0000-000000000001', 'unsupported-broker')
$$, '23514', null, 'unsupported broker is rejected by a database check');

select throws_ok($$
  insert into public.investment_transactions (
    investment_account_id, instrument, currency, side, amount, quantity,
    unit_price, executed_at
  ) values (
    '20000000-0000-0000-0000-000000000001', 'VWCE.DE', 'eur', 'buy',
    10, 1, 10, '2026-01-02T10:00:00Z'
  )
$$, '23514', null, 'lowercase currency is rejected by a database check');

select throws_ok($$
  insert into public.investment_transactions (
    investment_account_id, instrument, currency, side, amount, quantity,
    unit_price, executed_at
  ) values (
    '20000000-0000-0000-0000-000000000001', 'VWCE.DE', 'EUR', 'buy',
    0, 1, 10, '2026-01-02T10:00:00Z'
  )
$$, '23514', null, 'non-positive amount is rejected by a database check');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select is(
  (select count(*)::integer from public.investment_accounts),
  1,
  'second user sees only their investment account'
);
select is(
  (select count(*)::integer from public.investment_transactions),
  1,
  'second user sees only their transactions'
);

select lives_ok($$
  delete from public.investment_transactions
  where id = '30000000-0000-0000-0000-000000000001'
$$, 'cross-user delete is harmless and affects no visible row');

select is(
  (select count(*)::integer
   from public.investment_transactions
   where id = '30000000-0000-0000-0000-000000000001'),
  0,
  'cross-user transaction remains invisible after delete attempt'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer
   from public.investment_transactions
   where id = '30000000-0000-0000-0000-000000000001'),
  1,
  'cross-user delete did not remove the owner transaction'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select count(*) from public.investment_accounts $$,
  '42501', null,
  'anonymous account reads are rejected'
);
select throws_ok(
  $$ delete from public.investment_transactions $$,
  '42501', null,
  'anonymous transaction deletes are rejected'
);

reset role;
select * from finish();
rollback;
