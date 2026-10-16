begin;
create extension if not exists pgtap;
select plan(352);

-- F43: family members may read each other's finance rows; writes stay owner-only.
--
-- Users (prefix f4300000), with user number NN:
--   family A: 01 creator parent, 02 second parent,
--             03 kid with family_finance 'view', 04 kid with family_finance 'off'
--   family B: 05 creator parent, 06 second parent,
--             07 kid with family_finance 'view', 08 kid with no permission rows
--   09 has no family.
-- Every user owns exactly one fixture row in each finance table. Fixture ids
-- end in "<table digit>00<NN>", so pg_temp.visible() can turn the rows a
-- caller sees back into user numbers:
--   1 expenses, 2 expense_tabs, 3 investment_accounts,
--   4 investment_transactions, 5 net_worth_items, 6 net_worth_valuations.
-- Each expense's amount is its owner's number, for the dashboard checks.

create function pg_temp.uid(n integer)
returns uuid
language sql
immutable
as $$
  select ('f4300000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.rid(t integer, n integer)
returns uuid
language sql
immutable
as $$
  select ('f4300000-0000-4000-8000-0000000' || t || '00' || lpad(n::text, 2, '0'))::uuid
$$;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'f43-user-' || n || '@example.test', 'not-used', now(), '{}', '{}', now(), now()
from generate_series(1, 9) as n
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('f4300000-0000-4000-8000-0000000000a1', 'Family A', pg_temp.uid(1)),
  ('f4300000-0000-4000-8000-0000000000b1', 'Family B', pg_temp.uid(5));

-- Member id of user NN: ...0000000f00NN.
insert into public.family_members (id, family_id, user_id, role) values
  ('f4300000-0000-4000-8000-0000000f0001', 'f4300000-0000-4000-8000-0000000000a1', pg_temp.uid(1), 'parent'),
  ('f4300000-0000-4000-8000-0000000f0002', 'f4300000-0000-4000-8000-0000000000a1', pg_temp.uid(2), 'parent'),
  ('f4300000-0000-4000-8000-0000000f0003', 'f4300000-0000-4000-8000-0000000000a1', pg_temp.uid(3), 'kid'),
  ('f4300000-0000-4000-8000-0000000f0004', 'f4300000-0000-4000-8000-0000000000a1', pg_temp.uid(4), 'kid'),
  ('f4300000-0000-4000-8000-0000000f0005', 'f4300000-0000-4000-8000-0000000000b1', pg_temp.uid(5), 'parent'),
  ('f4300000-0000-4000-8000-0000000f0006', 'f4300000-0000-4000-8000-0000000000b1', pg_temp.uid(6), 'parent'),
  ('f4300000-0000-4000-8000-0000000f0007', 'f4300000-0000-4000-8000-0000000000b1', pg_temp.uid(7), 'kid'),
  ('f4300000-0000-4000-8000-0000000f0008', 'f4300000-0000-4000-8000-0000000000b1', pg_temp.uid(8), 'kid');

insert into public.member_permissions (member_id, module, level) values
  ('f4300000-0000-4000-8000-0000000f0003', 'expenses', 'edit'),
  ('f4300000-0000-4000-8000-0000000f0003', 'family_finance', 'view'),
  ('f4300000-0000-4000-8000-0000000f0004', 'expenses', 'edit'),
  ('f4300000-0000-4000-8000-0000000f0004', 'investments', 'edit'),
  ('f4300000-0000-4000-8000-0000000f0004', 'net_worth', 'edit'),
  ('f4300000-0000-4000-8000-0000000f0004', 'family_finance', 'off'),
  ('f4300000-0000-4000-8000-0000000f0007', 'family_finance', 'view');

-- One row per user in every finance table (inserted as the table owner).
insert into public.expenses (id, user_id, description, amount, category, expense_date)
select pg_temp.rid(1, n), pg_temp.uid(n), 'Family fixture', n, 'transport', '2026-10-05'
from generate_series(1, 9) as n;

insert into public.expense_tabs (id, user_id, name, category_keys)
select pg_temp.rid(2, n), pg_temp.uid(n), 'Fixture tab', array['transport']
from generate_series(1, 9) as n;

insert into public.investment_accounts (id, user_id, broker_id)
select pg_temp.rid(3, n), pg_temp.uid(n), 'xtb'
from generate_series(1, 9) as n;

insert into public.investment_transactions (id, investment_account_id, instrument, currency,
  side, amount, quantity, unit_price, executed_at)
select pg_temp.rid(4, n), pg_temp.rid(3, n), 'VWCE.DE', 'EUR', 'buy', 100, 1, 100, '2026-10-01 10:00:00+00'
from generate_series(1, 9) as n;

insert into public.net_worth_items (id, user_id, name, kind, category, currency)
select pg_temp.rid(5, n), pg_temp.uid(n), 'Fixture cash', 'asset', 'cash', 'RON'
from generate_series(1, 9) as n;

insert into public.net_worth_valuations (id, item_id, value, valued_on)
select pg_temp.rid(6, n), pg_temp.rid(5, n), 1000, '2026-10-01'
from generate_series(1, 9) as n;

-- ---------------------------------------------------------------------------
-- Test helpers (security invoker, so they run under the caller's RLS)
-- ---------------------------------------------------------------------------

-- Act as user n (null: a session without a user).
create function pg_temp.act_as(n integer)
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    case when n is null then '{"role":"authenticated"}'
      else json_build_object('sub', pg_temp.uid(n), 'role', 'authenticated')::text end,
    true
  );
  select null::void;
$$;

-- The user numbers of the fixture rows the caller can read in a table.
create function pg_temp.visible(p_table text)
returns integer[]
language plpgsql
as $$
declare
  result integer[];
begin
  execute format(
    'select coalesce(array_agg(right(id::text, 2)::integer order by id), ''{}'')'
    ' from public.%I where id::text like ''f4300000-%%''',
    p_table
  ) into result;
  return result;
end;
$$;

-- Runs a statement and reports "rows:<n>" or "error:<sqlstate>".
create function pg_temp.attempt(p_sql text)
returns text
language plpgsql
as $$
declare
  affected integer;
begin
  execute p_sql;
  get diagnostics affected = row_count;
  return 'rows:' || affected;
exception when others then
  return 'error:' || sqlstate;
end;
$$;

-- Every way the actor could try to write the victim's rows, with the result
-- that proves the write was refused. "rows:0" means the row was filtered out;
-- "error:42501" means a policy's WITH CHECK failed or the table has no grant
-- for that command (investment tables have no update; net worth no delete).
create function pg_temp.write_attempts(actor integer, victim integer)
returns table (label text, sql text, expected text)
language sql
as $$
  select * from (values
    ('insert an expense for',
     format($q$insert into public.expenses (user_id, description, amount, category, expense_date)
       values (%L, 'Forged', 1, 'transport', '2026-10-06')$q$, pg_temp.uid(victim)),
     'error:42501'),
    ('update an expense of',
     format('update public.expenses set amount = 999 where id = %L', pg_temp.rid(1, victim)),
     'rows:0'),
    ('delete an expense of',
     format('delete from public.expenses where id = %L', pg_temp.rid(1, victim)),
     'rows:0'),
    ('move their own expense to',
     format('update public.expenses set user_id = %L where id = %L', pg_temp.uid(victim), pg_temp.rid(1, actor)),
     'error:42501'),

    ('insert an expense tab for',
     format($q$insert into public.expense_tabs (user_id, name, category_keys)
       values (%L, 'Forged', array['car'])$q$, pg_temp.uid(victim)),
     'error:42501'),
    ('update an expense tab of',
     format($q$update public.expense_tabs set name = 'Forged' where id = %L$q$, pg_temp.rid(2, victim)),
     'rows:0'),
    ('delete an expense tab of',
     format('delete from public.expense_tabs where id = %L', pg_temp.rid(2, victim)),
     'rows:0'),
    ('move their own expense tab to',
     format('update public.expense_tabs set user_id = %L where id = %L', pg_temp.uid(victim), pg_temp.rid(2, actor)),
     'error:42501'),

    ('insert an investment account for',
     format($q$insert into public.investment_accounts (user_id, broker_id)
       values (%L, 'banca_transilvania')$q$, pg_temp.uid(victim)),
     'error:42501'),
    ('update an investment account of',
     format($q$update public.investment_accounts set broker_id = 'banca_transilvania' where id = %L$q$, pg_temp.rid(3, victim)),
     'error:42501'),
    ('delete an investment account of',
     format('delete from public.investment_accounts where id = %L', pg_temp.rid(3, victim)),
     'rows:0'),

    ('insert an investment transaction for',
     format($q$insert into public.investment_transactions (investment_account_id, instrument, currency,
       side, amount, quantity, unit_price, executed_at)
       values (%L, 'VWCE.DE', 'EUR', 'buy', 1, 1, 1, now())$q$, pg_temp.rid(3, victim)),
     'error:42501'),
    ('update an investment transaction of',
     format('update public.investment_transactions set amount = 999 where id = %L', pg_temp.rid(4, victim)),
     'error:42501'),
    ('delete an investment transaction of',
     format('delete from public.investment_transactions where id = %L', pg_temp.rid(4, victim)),
     'rows:0'),

    ('insert a net-worth item for',
     format($q$insert into public.net_worth_items (user_id, name, kind, category, currency)
       values (%L, 'Forged', 'asset', 'cash', 'RON')$q$, pg_temp.uid(victim)),
     'error:42501'),
    ('update a net-worth item of',
     format($q$update public.net_worth_items set name = 'Forged' where id = %L$q$, pg_temp.rid(5, victim)),
     'rows:0'),
    ('delete a net-worth item of',
     format('delete from public.net_worth_items where id = %L', pg_temp.rid(5, victim)),
     'error:42501'),
    ('move their own net-worth item to',
     format('update public.net_worth_items set user_id = %L where id = %L', pg_temp.uid(victim), pg_temp.rid(5, actor)),
     'error:42501'),

    ('insert a valuation for',
     format($q$insert into public.net_worth_valuations (item_id, value, valued_on)
       values (%L, 1, '2026-10-07')$q$, pg_temp.rid(5, victim)),
     'error:42501'),
    ('upsert over an existing valuation of',
     format($q$insert into public.net_worth_valuations (item_id, value, valued_on)
       values (%L, 999, '2026-10-01')
       on conflict (item_id, valued_on) do update set value = excluded.value$q$, pg_temp.rid(5, victim)),
     'error:42501'),
    ('update a valuation of',
     format('update public.net_worth_valuations set value = 999 where id = %L', pg_temp.rid(6, victim)),
     'rows:0'),
    ('delete a valuation of',
     format('delete from public.net_worth_valuations where id = %L', pg_temp.rid(6, victim)),
     'error:42501'),
    ('move their own valuation to an item of',
     format('update public.net_worth_valuations set item_id = %L where id = %L', pg_temp.rid(5, victim), pg_temp.rid(6, actor)),
     'error:42501')
  ) as ops(label, sql, expected)
$$;

-- The fixture rows of every table as one fingerprint, to prove at the end that
-- no refused write changed anything.
create function pg_temp.fingerprint()
returns text
language sql
as $$
  select md5(concat_ws('|',
    (select string_agg(row(e.id, e.user_id, e.amount, e.description)::text, ',' order by e.id)
       from public.expenses e where e.id::text like 'f4300000-%'),
    (select string_agg(row(t.id, t.user_id, t.name)::text, ',' order by t.id)
       from public.expense_tabs t where t.id::text like 'f4300000-%'),
    (select string_agg(row(a.id, a.user_id, a.broker_id)::text, ',' order by a.id)
       from public.investment_accounts a where a.id::text like 'f4300000-%'),
    (select string_agg(row(x.id, x.investment_account_id, x.amount)::text, ',' order by x.id)
       from public.investment_transactions x where x.id::text like 'f4300000-%'),
    (select string_agg(row(i.id, i.user_id, i.name)::text, ',' order by i.id)
       from public.net_worth_items i where i.id::text like 'f4300000-%'),
    (select string_agg(row(v.id, v.item_id, v.value, v.valued_on)::text, ',' order by v.id)
       from public.net_worth_valuations v where v.id::text like 'f4300000-%'),
    (select count(*)::text from public.expenses where user_id::text like 'f4300000-%'),
    (select count(*)::text from public.expense_tabs where user_id::text like 'f4300000-%'),
    (select count(*)::text from public.investment_accounts where user_id::text like 'f4300000-%'),
    (select count(*)::text from public.investment_transactions x
       join public.investment_accounts a on a.id = x.investment_account_id
       where a.user_id::text like 'f4300000-%'),
    (select count(*)::text from public.net_worth_items where user_id::text like 'f4300000-%'),
    (select count(*)::text from public.net_worth_valuations v
       join public.net_worth_items i on i.id = v.item_id
       where i.user_id::text like 'f4300000-%')
  ))
$$;

create temporary table finance_tables (name text primary key);
insert into finance_tables values
  ('expenses'), ('expense_tabs'), ('investment_accounts'),
  ('investment_transactions'), ('net_worth_items'), ('net_worth_valuations');
grant select on finance_tables to authenticated;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select ok(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
   from pg_catalog.pg_proc p
   where p.oid = 'family_private.can_view_finance_of(uuid)'::regprocedure),
  'can_view_finance_of is security definer, stable and pins an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'family_private.can_view_finance_of(uuid)', 'execute')
  and not has_function_privilege('anon', 'family_private.can_view_finance_of(uuid)', 'execute'),
  'authenticated can execute can_view_finance_of and anon cannot'
);
select is(
  (select array_agg((tablename || ':' || policyname || ':' || cmd || ':' || permissive || ':' || array_to_string(roles, ','))::text
     order by tablename, policyname)
   from pg_catalog.pg_policies
   where schemaname = 'public' and tablename in (select name from finance_tables)),
  array[
    'expense_tabs:expense_tabs_delete_own:DELETE:PERMISSIVE:authenticated',
    'expense_tabs:expense_tabs_insert_own:INSERT:PERMISSIVE:authenticated',
    'expense_tabs:expense_tabs_select_own:SELECT:PERMISSIVE:authenticated',
    'expense_tabs:expense_tabs_update_own:UPDATE:PERMISSIVE:authenticated',
    'expenses:Users can create their own expenses:INSERT:PERMISSIVE:authenticated',
    'expenses:Users can delete their own expenses:DELETE:PERMISSIVE:authenticated',
    'expenses:Users can read their own expenses:SELECT:PERMISSIVE:authenticated',
    'expenses:Users can update their own expenses:UPDATE:PERMISSIVE:authenticated',
    'investment_accounts:investment_accounts_delete_own:DELETE:PERMISSIVE:authenticated',
    'investment_accounts:investment_accounts_insert_own:INSERT:PERMISSIVE:authenticated',
    'investment_accounts:investment_accounts_select_own:SELECT:PERMISSIVE:authenticated',
    'investment_transactions:investment_transactions_delete_own:DELETE:PERMISSIVE:authenticated',
    'investment_transactions:investment_transactions_insert_own:INSERT:PERMISSIVE:authenticated',
    'investment_transactions:investment_transactions_select_own:SELECT:PERMISSIVE:authenticated',
    'net_worth_items:net_worth_items_insert_own:INSERT:PERMISSIVE:authenticated',
    'net_worth_items:net_worth_items_select_own:SELECT:PERMISSIVE:authenticated',
    'net_worth_items:net_worth_items_update_own:UPDATE:PERMISSIVE:authenticated',
    'net_worth_valuations:net_worth_valuations_insert_own:INSERT:PERMISSIVE:authenticated',
    'net_worth_valuations:net_worth_valuations_select_own:SELECT:PERMISSIVE:authenticated',
    'net_worth_valuations:net_worth_valuations_update_own:UPDATE:PERMISSIVE:authenticated'
  ],
  'the finance tables keep exactly their policy names, commands and roles'
);
select is(
  (select array_agg(tablename::text order by tablename)
   from pg_catalog.pg_policies
   where schemaname = 'public' and tablename in (select name from finance_tables)
     and cmd = 'SELECT'
     and qual like '%user_id = ( SELECT app_private.current_user_id()%OR family_private.can_view_finance_of(%'),
  array['expense_tabs', 'expenses', 'investment_accounts', 'investment_transactions',
        'net_worth_items', 'net_worth_valuations'],
  'every select policy checks the owner first, then can_view_finance_of'
);
select is(
  (select count(*)::integer
   from pg_catalog.pg_policies
   where schemaname = 'public' and tablename in (select name from finance_tables)
     and cmd <> 'SELECT'
     and coalesce(qual, '') || coalesce(with_check, '') not like '%can_view_finance_of%'
     and coalesce(qual, '') || coalesce(with_check, '') not like '%current_user_id%'
     and coalesce(qual, '') || coalesce(with_check, '') like '%SELECT %uid() AS uid)%'),
  14,
  'the 14 insert, update and delete policies still check only auth.uid(), as before'
);

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

set local role authenticated;

-- Each block checks all six tables for one caller.
select pg_temp.act_as(1);
select is(pg_temp.visible(name), array[1, 2, 3, 4], 'creator parent 01 reads all of family A in ' || name)
from finance_tables order by name;

select pg_temp.act_as(2);
select is(pg_temp.visible(name), array[1, 2, 3, 4], 'second parent 02 reads all of family A in ' || name)
from finance_tables order by name;

select pg_temp.act_as(3);
select is(pg_temp.visible(name), array[1, 2, 3, 4], 'kid 03 with Family finance reads all of family A in ' || name)
from finance_tables order by name;

select pg_temp.act_as(4);
select is(pg_temp.visible(name), array[4], 'kid 04 with Family finance off reads only their own ' || name)
from finance_tables order by name;

select pg_temp.act_as(5);
select is(pg_temp.visible(name), array[5, 6, 7, 8], 'parent 05 reads only family B in ' || name)
from finance_tables order by name;

select pg_temp.act_as(6);
select is(pg_temp.visible(name), array[5, 6, 7, 8], 'second parent 06 reads only family B in ' || name)
from finance_tables order by name;

select pg_temp.act_as(7);
select is(pg_temp.visible(name), array[5, 6, 7, 8], 'kid 07 with Family finance reads only family B in ' || name)
from finance_tables order by name;

select pg_temp.act_as(8);
select is(pg_temp.visible(name), array[8], 'kid 08 without permission rows reads only their own ' || name)
from finance_tables order by name;

select pg_temp.act_as(9);
select is(pg_temp.visible(name), array[9], 'user 09 without a family reads only their own ' || name)
from finance_tables order by name;

select pg_temp.act_as(null);
select is(pg_temp.visible(name), '{}'::integer[], 'a session without a user reads nothing in ' || name)
from finance_tables order by name;

-- The helper itself.
select pg_temp.act_as(1);
select ok(family_private.can_view_finance_of(pg_temp.uid(1)), 'can_view_finance_of: a parent can view themselves');
select ok(family_private.can_view_finance_of(pg_temp.uid(4)), 'can_view_finance_of: a parent can view a kid');
select ok(not family_private.can_view_finance_of(pg_temp.uid(5)), 'can_view_finance_of: a parent cannot view another family');
select ok(not family_private.can_view_finance_of(pg_temp.uid(9)), 'can_view_finance_of: a parent cannot view a user without a family');
select is(family_private.can_view_finance_of(null), false, 'can_view_finance_of is false, not null, for a null owner');
select pg_temp.act_as(4);
select ok(not family_private.can_view_finance_of(pg_temp.uid(1)), 'can_view_finance_of: a kid without Family finance cannot view a parent');
select pg_temp.act_as(9);
select ok(not family_private.can_view_finance_of(pg_temp.uid(1)), 'can_view_finance_of: a user without a family cannot view a family');
select pg_temp.act_as(null);
select is(family_private.can_view_finance_of(pg_temp.uid(1)), false, 'can_view_finance_of is false without a user');

-- F42's security invoker dashboard now follows the widened policies.
select pg_temp.act_as(1);
select is(
  (public.get_expense_dashboard('2026-10-01', '2026-11-01', '2026-07-01', '2026-10-01') ->> 'currentTotal')::numeric,
  1::numeric,
  'the dashboard default still summarises only the caller'
);
select is(
  (public.get_expense_dashboard('2026-10-01', '2026-11-01', '2026-07-01', '2026-10-01', pg_temp.uid(3)) ->> 'currentTotal')::numeric,
  3::numeric,
  'a parent gets a kid''s dashboard totals'
);
select is(
  (public.get_expense_dashboard('2026-10-01', '2026-11-01', '2026-07-01', '2026-10-01', pg_temp.uid(5)) ->> 'currentTotal')::numeric,
  0::numeric,
  'a parent gets nothing from another family''s dashboard'
);
select pg_temp.act_as(4);
select is(
  (public.get_expense_dashboard('2026-10-01', '2026-11-01', '2026-07-01', '2026-10-01', pg_temp.uid(1)) ->> 'currentTotal')::numeric,
  0::numeric,
  'a kid without Family finance gets nothing from a parent''s dashboard'
);

-- ---------------------------------------------------------------------------
-- Writes: nobody can insert, update or delete someone else's rows
-- ---------------------------------------------------------------------------

reset role;
create temporary table fingerprint_before as select pg_temp.fingerprint() as value;
set local role authenticated;

select pg_temp.act_as(1);
select is(pg_temp.attempt(sql), expected, 'parent 01 cannot ' || label || ' kid 03') from pg_temp.write_attempts(1, 3);
select is(pg_temp.attempt(sql), expected, 'parent 01 cannot ' || label || ' kid 04') from pg_temp.write_attempts(1, 4);
select is(pg_temp.attempt(sql), expected, 'parent 01 cannot ' || label || ' parent 02') from pg_temp.write_attempts(1, 2);
select is(pg_temp.attempt(sql), expected, 'parent 01 cannot ' || label || ' user 09') from pg_temp.write_attempts(1, 9);

select pg_temp.act_as(2);
select is(pg_temp.attempt(sql), expected, 'parent 02 cannot ' || label || ' creator 01') from pg_temp.write_attempts(2, 1);

select pg_temp.act_as(3);
select is(pg_temp.attempt(sql), expected, 'kid 03 with Family finance cannot ' || label || ' parent 01') from pg_temp.write_attempts(3, 1);
select is(pg_temp.attempt(sql), expected, 'kid 03 with Family finance cannot ' || label || ' kid 04') from pg_temp.write_attempts(3, 4);

select pg_temp.act_as(4);
select is(pg_temp.attempt(sql), expected, 'kid 04 cannot ' || label || ' kid 03') from pg_temp.write_attempts(4, 3);

select pg_temp.act_as(5);
select is(pg_temp.attempt(sql), expected, 'parent 05 of family B cannot ' || label || ' kid 04') from pg_temp.write_attempts(5, 4);

select pg_temp.act_as(9);
select is(pg_temp.attempt(sql), expected, 'user 09 without a family cannot ' || label || ' parent 01') from pg_temp.write_attempts(9, 1);

reset role;
select is(pg_temp.fingerprint(), (select value from fingerprint_before), 'no refused write changed any fixture row');
set local role authenticated;

-- Owners can still write their own rows (kid 04, who can't read the family).
select pg_temp.act_as(4);
select is(pg_temp.attempt(format($q$insert into public.expenses (user_id, description, amount, category, expense_date)
  values (%L, 'Own', 1, 'transport', '2026-10-06')$q$, pg_temp.uid(4))), 'rows:1', 'an owner can insert their own expense');
select is(pg_temp.attempt(format($q$insert into public.expense_tabs (user_id, name, category_keys)
  values (%L, 'Own', array['car'])$q$, pg_temp.uid(4))), 'rows:1', 'an owner can insert their own expense tab');
select is(pg_temp.attempt(format($q$insert into public.investment_accounts (user_id, broker_id)
  values (%L, 'banca_transilvania')$q$, pg_temp.uid(4))), 'rows:1', 'an owner can insert their own investment account');
select is(pg_temp.attempt(format($q$insert into public.investment_transactions (investment_account_id, instrument, currency,
  side, amount, quantity, unit_price, executed_at) values (%L, 'VWCE.DE', 'EUR', 'buy', 1, 1, 1, now())$q$, pg_temp.rid(3, 4))),
  'rows:1', 'an owner can insert a transaction into their own account');
select is(pg_temp.attempt(format($q$insert into public.net_worth_items (user_id, name, kind, category, currency)
  values (%L, 'Own', 'asset', 'cash', 'RON')$q$, pg_temp.uid(4))), 'rows:1', 'an owner can insert their own net-worth item');
select is(pg_temp.attempt(format($q$insert into public.net_worth_valuations (item_id, value, valued_on)
  values (%L, 1, '2026-10-07')$q$, pg_temp.rid(5, 4))), 'rows:1', 'an owner can insert a valuation for their own item');
select is(pg_temp.attempt(format('update public.expenses set amount = 44 where id = %L', pg_temp.rid(1, 4))),
  'rows:1', 'an owner can update their own expense');
select is(pg_temp.attempt(format($q$update public.expense_tabs set name = 'Mine' where id = %L$q$, pg_temp.rid(2, 4))),
  'rows:1', 'an owner can update their own expense tab');
select is(pg_temp.attempt(format($q$update public.net_worth_items set name = 'Mine' where id = %L$q$, pg_temp.rid(5, 4))),
  'rows:1', 'an owner can update their own net-worth item');
select is(pg_temp.attempt(format('update public.net_worth_valuations set value = 44 where id = %L', pg_temp.rid(6, 4))),
  'rows:1', 'an owner can update their own valuation');
select is(pg_temp.attempt(format($q$delete from public.expenses where user_id = %L and id::text not like 'f4300000-%%'$q$, pg_temp.uid(4))),
  'rows:1', 'an owner can delete their own expense');
select is(pg_temp.attempt(format($q$delete from public.expense_tabs where user_id = %L and id::text not like 'f4300000-%%'$q$, pg_temp.uid(4))),
  'rows:1', 'an owner can delete their own expense tab');
select is(pg_temp.attempt(format($q$delete from public.investment_transactions where investment_account_id = %L
  and id::text not like 'f4300000-%%'$q$, pg_temp.rid(3, 4))),
  'rows:1', 'an owner can delete their own investment transaction');
select is(pg_temp.attempt(format($q$delete from public.investment_accounts where user_id = %L and id::text not like 'f4300000-%%'$q$, pg_temp.uid(4))),
  'rows:1', 'an owner can delete their own investment account');

-- ---------------------------------------------------------------------------
-- Access follows membership and permissions immediately
-- ---------------------------------------------------------------------------

-- Turning Family finance off for kid 07 hides the family at once.
reset role;
update public.member_permissions set level = 'off'
where member_id = 'f4300000-0000-4000-8000-0000000f0007' and module = 'family_finance';
set local role authenticated;
select pg_temp.act_as(7);
select is(pg_temp.visible(name), array[7], 'kid 07 reads only their own ' || name || ' once Family finance is off')
from finance_tables order by name;

-- Turning it on for kid 08 (who had no rows) shows the family at once.
reset role;
insert into public.member_permissions (member_id, module, level)
values ('f4300000-0000-4000-8000-0000000f0008', 'family_finance', 'view');
set local role authenticated;
select pg_temp.act_as(8);
select is(pg_temp.visible(name), array[5, 6, 7, 8], 'kid 08 reads all of family B in ' || name || ' once Family finance is on')
from finance_tables order by name;

-- Removing kid 03 and second parent 02 from family A ends their access, and
-- the remaining parent's access to them, at once.
reset role;
delete from public.family_members
where id in ('f4300000-0000-4000-8000-0000000f0002', 'f4300000-0000-4000-8000-0000000f0003');
set local role authenticated;

select pg_temp.act_as(3);
select is(pg_temp.visible(name), array[3], 'removed kid 03 reads only their own ' || name)
from finance_tables order by name;

select pg_temp.act_as(2);
select is(pg_temp.visible(name), array[2], 'removed parent 02 reads only their own ' || name)
from finance_tables order by name;

select pg_temp.act_as(1);
select is(pg_temp.visible(name), array[1, 4], 'parent 01 no longer reads the removed members'' ' || name)
from finance_tables order by name;

reset role;
select * from finish();
rollback;
