begin;
create extension if not exists pgtap;
create extension if not exists dblink with schema extensions;
select plan(53);

-- S10 (docs/security-plan.md, "Races"): record_investment_order(), delete_investment_order(),
-- ai_reserve_budget(), ai_settle_usage() and update_expense().
--
-- Part 1 runs real races. pgTAP runs in one session, so the two competing requests are two more
-- sessions opened with dblink over the container's loopback (trusted, see
-- scripts/test-database.sh). They only see committed rows, so part 1 commits its own seed through a
-- third session and deletes it again at the end of the part. Each race goes the same way: the first
-- session runs its call inside an open transaction and holds its locks; the second sends the same
-- kind of call without waiting for it; the test checks that the second is waiting for a lock, then
-- commits the first and reads what the second did.
--
-- Part 2 checks each function's rules in this session, on rows this transaction inserts and rolls
-- back. It runs after part 1, because the locks it takes are held until the final rollback.
--
-- Users (prefix e5100000, see pg_temp.uid):
--   part 1: 01 investor with an expense   03 and 04 parents in family f1   05 and 06 alone
--   part 2: 11 investor   12 someone else   13 parent in family f2   14 kid in f2 without ai
--           15 alone, switch off   16 alone

create function pg_temp.uid(n integer)
returns uuid
language sql
immutable
as $$
  select ('e5100000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

-- An id of part 1 or 2 that isn't a user: pg_temp.rid('a1') for the account and so on.
create function pg_temp.rid(p_label text)
returns uuid
language sql
immutable
as $$
  select ('e5100000-0000-4000-8000-0000000001' || p_label)::uuid
$$;

create function pg_temp.claims(n integer)
returns text
language sql
immutable
as $$
  select json_build_object('sub', pg_temp.uid(n), 'role', 'authenticated')::text
$$;

create function pg_temp.act_as(n integer)
returns void
language sql
as $$
  select set_config('request.jwt.claims', pg_temp.claims(n), true);
  select null::void;
$$;

-- Runs a statement and reports "ok" or "<sqlstate> hint:<hint> <message>".
create function pg_temp.raised(p_sql text)
returns text
language plpgsql
as $$
declare
  v_state text;
  v_hint text;
  v_message text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint, v_message = message_text;
  return v_state || ' hint:' || coalesce(nullif(v_hint, ''), 'none') || ' ' || v_message;
end;
$$;

-- Whether the dblink session named by its application_name is waiting for a lock, within 5 seconds.
create function pg_temp.waits_for_lock(p_application text)
returns boolean
language plpgsql
as $$
begin
  for attempt in 1..100 loop
    -- pg_stat_activity is a snapshot per transaction until it is cleared.
    perform pg_catalog.pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_catalog.pg_stat_activity a
      where a.application_name = p_application and a.wait_event_type = 'Lock'
    ) then
      return true;
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
  return false;
end;
$$;

-- ===========================================================================
-- Part 1: races
-- ===========================================================================

select extensions.dblink_connect('setup', 'host=127.0.0.1 dbname=postgres user=supabase_admin application_name=s10_setup');
select extensions.dblink_connect('first', 'host=127.0.0.1 dbname=postgres user=supabase_admin application_name=s10_first');
select extensions.dblink_connect('second', 'host=127.0.0.1 dbname=postgres user=supabase_admin application_name=s10_second');

select extensions.dblink_exec('setup', format($sql$
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (%1$L, 's10-01@example.test', 'not-used', now(), '{}', '{}', now(), now()),
    (%2$L, 's10-03@example.test', 'not-used', now(), '{}', '{}', now(), now()),
    (%3$L, 's10-04@example.test', 'not-used', now(), '{}', '{}', now(), now()),
    (%4$L, 's10-05@example.test', 'not-used', now(), '{}', '{}', now(), now()),
    (%5$L, 's10-06@example.test', 'not-used', now(), '{}', '{}', now(), now());
  insert into public.profiles (id, ai_enabled) values
    (%1$L, false), (%2$L, true), (%3$L, true), (%4$L, true), (%5$L, true)
  on conflict (id) do update set ai_enabled = excluded.ai_enabled;
  insert into public.families (id, name, creator_id) values (%6$L, 'S10 family', %2$L);
  insert into public.family_members (family_id, user_id, role) values
    (%6$L, %2$L, 'parent'), (%6$L, %3$L, 'parent');
  insert into public.investment_accounts (id, user_id, broker_id) values (%7$L, %1$L, 'xtb');
  insert into public.investment_transactions (id, investment_account_id, instrument, currency,
    side, amount, quantity, unit_price, executed_at)
  values (%8$L, %7$L, 'VWCE.DE', 'EUR', 'buy', 1000, 10, 100, '2026-01-01T10:00:00Z');
  insert into public.expenses (id, user_id, description, amount, category, expense_date)
  values (%9$L, %1$L, 'Lunch', 10, 'groceries', '2026-10-01');
$sql$, pg_temp.uid(1), pg_temp.uid(3), pg_temp.uid(4), pg_temp.uid(5), pg_temp.uid(6),
  pg_temp.rid('f1'), pg_temp.rid('a1'), pg_temp.rid('b1'), pg_temp.rid('e1')));

-- ---------------------------------------------------------------------------
-- Two sells of the whole position at once
-- ---------------------------------------------------------------------------

select extensions.dblink_exec('first', 'begin');
select extensions.dblink_exec('first', 'set local role authenticated');
select extensions.dblink_exec('first', format('set local request.jwt.claims = %L', pg_temp.claims(1)));
select count(*) from extensions.dblink('first', format($sql$
  select public.record_investment_order(%L, %L, 'VWCE.DE', 'EUR', 'sell', 1100, 10, 110, '2026-02-01T10:00:00Z')
$sql$, pg_temp.rid('c1'), pg_temp.rid('a1'))) as t(result text);

select extensions.dblink_exec('second', 'set role authenticated');
select extensions.dblink_exec('second', format('set request.jwt.claims = %L', pg_temp.claims(1)));
select extensions.dblink_send_query('second', format($sql$
  select public.record_investment_order(%L, %L, 'VWCE.DE', 'EUR', 'sell', 1100, 10, 110, '2026-02-02T10:00:00Z')
$sql$, pg_temp.rid('c2'), pg_temp.rid('a1')));

select ok(pg_temp.waits_for_lock('s10_second'), 'a second sell of the same account waits for the first');

select extensions.dblink_exec('first', 'commit');
select * from extensions.dblink_get_result('second', false) as t(result text);
select * from extensions.dblink_get_result('second', false) as t(result text);

select ok(
  extensions.dblink_error_message('second') like '%Sell quantity exceeds the available VWCE.DE position.%',
  'then it sees the first sell and is refused'
);
select is(
  (select count(*)::integer from public.investment_transactions
   where investment_account_id = pg_temp.rid('a1') and side = 'sell'),
  1,
  'only one of the two sells is saved'
);

-- ---------------------------------------------------------------------------
-- Two reservations from one family at once
-- ---------------------------------------------------------------------------

-- $3 for the family, $2 for each call: one fits, two don't.
select extensions.dblink_exec('second', 'reset role');
select extensions.dblink_exec('first', 'begin');
select extensions.dblink_exec('first', 'set local role service_role');
select count(*) from extensions.dblink('first', format($sql$
  select public.ai_reserve_budget(%L, 'statements', 'fake', 'fake-model', 2000000, now() - interval '1 day', 3000000, 100000000)
$sql$, pg_temp.uid(3))) as t(result text);

select extensions.dblink_exec('second', 'set role service_role');
select extensions.dblink_send_query('second', format($sql$
  select status, family_spent_micros
  from public.ai_reserve_budget(%L, 'statements', 'fake', 'fake-model', 2000000, now() - interval '1 day', 3000000, 100000000)
$sql$, pg_temp.uid(4)));

select ok(pg_temp.waits_for_lock('s10_second'), 'a second reservation in the same family waits for the first');

select extensions.dblink_exec('first', 'commit');

select results_eq(
  $$ select * from extensions.dblink_get_result('second') as t(status text, family_spent_micros bigint) $$,
  $$ values ('family_budget'::text, 2000000::bigint) $$,
  'then it counts the first reservation and is refused for the family''s month'
);
select * from extensions.dblink_get_result('second') as t(status text, family_spent_micros bigint);

select is(
  (select count(*)::integer from public.ai_usage where family_id = pg_temp.rid('f1') and outcome = 'reserved'),
  1,
  'only one reservation is written'
);

-- ---------------------------------------------------------------------------
-- Two reservations from different families at once, against everyone's month
-- ---------------------------------------------------------------------------

-- Everyone has spent $2 (the reservation above). $10 for everyone, $6 for each call: either fits
-- alone, both don't.
select extensions.dblink_exec('first', 'begin');
select extensions.dblink_exec('first', 'set local role service_role');
select count(*) from extensions.dblink('first', format($sql$
  select public.ai_reserve_budget(%L, 'statements', 'fake', 'fake-model', 6000000, now() - interval '1 day', 10000000, 10000000)
$sql$, pg_temp.uid(5))) as t(result text);

select extensions.dblink_send_query('second', format($sql$
  select status, global_spent_micros
  from public.ai_reserve_budget(%L, 'statements', 'fake', 'fake-model', 6000000, now() - interval '1 day', 10000000, 10000000)
$sql$, pg_temp.uid(6)));

select ok(pg_temp.waits_for_lock('s10_second'), 'a reservation from another family waits for everyone''s month');

select extensions.dblink_exec('first', 'commit');

select results_eq(
  $$ select * from extensions.dblink_get_result('second') as t(status text, global_spent_micros bigint) $$,
  $$ values ('global_budget'::text, 8000000::bigint) $$,
  'then it counts the first reservation and is refused for everyone''s month'
);
select * from extensions.dblink_get_result('second') as t(status text, global_spent_micros bigint);

-- ---------------------------------------------------------------------------
-- Two edits to different fields of one expense at once
-- ---------------------------------------------------------------------------

select extensions.dblink_exec('second', 'reset role');
select extensions.dblink_exec('first', 'begin');
select extensions.dblink_exec('first', 'set local role authenticated');
select extensions.dblink_exec('first', format('set local request.jwt.claims = %L', pg_temp.claims(1)));
select count(*) from extensions.dblink('first', format($sql$
  select id from public.update_expense(%L, '{"description": "Team lunch"}')
$sql$, pg_temp.rid('e1'))) as t(result text);

select extensions.dblink_exec('second', 'set role authenticated');
select extensions.dblink_exec('second', format('set request.jwt.claims = %L', pg_temp.claims(1)));
select extensions.dblink_send_query('second', format($sql$
  select description, amount from public.update_expense(%L, '{"amount": 12.5}')
$sql$, pg_temp.rid('e1')));

select ok(pg_temp.waits_for_lock('s10_second'), 'a second edit of the same expense waits for the first');

select extensions.dblink_exec('first', 'commit');

select results_eq(
  $$ select * from extensions.dblink_get_result('second') as t(description text, amount numeric) $$,
  $$ values ('Team lunch'::text, 12.50::numeric) $$,
  'then it returns the expense with both changes'
);
select * from extensions.dblink_get_result('second') as t(description text, amount numeric);

select results_eq(
  format($$ select description, amount, category from public.expenses where id = %L $$, pg_temp.rid('e1')),
  $$ values ('Team lunch'::text, 12.50::numeric, 'groceries'::text) $$,
  'both edits stick'
);

-- Part 1's rows go again. Triggers are off for the cleanup (replica), so the family's creator can
-- be removed and nothing cascades: each table is cleared by hand.
select extensions.dblink_exec('setup', format($sql$
  begin;
  set local session_replication_role = replica;
  delete from public.ai_usage where user_id = any (%1$L::uuid[]);
  delete from public.expenses where user_id = any (%1$L::uuid[]);
  delete from public.investment_transactions where investment_account_id = %2$L;
  delete from public.investment_accounts where id = %2$L;
  delete from public.family_members where family_id = %3$L;
  delete from public.families where id = %3$L;
  delete from public.profiles where id = any (%1$L::uuid[]);
  delete from auth.users where id = any (%1$L::uuid[]);
  commit;
$sql$, array[pg_temp.uid(1), pg_temp.uid(3), pg_temp.uid(4), pg_temp.uid(5), pg_temp.uid(6)],
  pg_temp.rid('a1'), pg_temp.rid('f1')));

select extensions.dblink_disconnect('setup');
select extensions.dblink_disconnect('first');
select extensions.dblink_disconnect('second');

select is(
  (select count(*)::integer from auth.users where id::text like 'e5100000-%'),
  0,
  'part 1 leaves nothing behind'
);

-- ===========================================================================
-- Part 2: the rules, in this session
-- ===========================================================================

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 's10-' || n || '@example.test', 'not-used', now(), '{}', '{}', now(), now()
from generate_series(11, 16) as n;

insert into public.profiles (id, ai_enabled)
select pg_temp.uid(n), n in (13, 14, 16)
from generate_series(11, 16) as n
on conflict (id) do update set ai_enabled = excluded.ai_enabled;

insert into public.families (id, name, creator_id) values (pg_temp.rid('f2'), 'S10 rules', pg_temp.uid(13));
insert into public.family_members (id, family_id, user_id, role) values
  (pg_temp.rid('d3'), pg_temp.rid('f2'), pg_temp.uid(13), 'parent'),
  (pg_temp.rid('d4'), pg_temp.rid('f2'), pg_temp.uid(14), 'kid');

insert into public.investment_accounts (id, user_id, broker_id) values
  (pg_temp.rid('a2'), pg_temp.uid(11), 'xtb'),
  (pg_temp.rid('a3'), pg_temp.uid(12), 'xtb');
insert into public.investment_transactions (id, investment_account_id, instrument, currency,
  side, amount, quantity, unit_price, executed_at)
values
  (pg_temp.rid('b2'), pg_temp.rid('a2'), 'VWCE.DE', 'EUR', 'buy', 1000, 10, 100, '2026-01-01T10:00:00Z'),
  (pg_temp.rid('b3'), pg_temp.rid('a3'), 'VWCE.DE', 'EUR', 'buy', 1000, 10, 100, '2026-01-01T10:00:00Z');

insert into public.expenses (id, user_id, description, amount, category, subtype, expense_date, notes) values
  (pg_temp.rid('e2'), pg_temp.uid(11), 'Fuel', 50, 'car', 'car_fuel', '2026-10-01', 'Full tank'),
  (pg_temp.rid('e3'), pg_temp.uid(12), 'Rent', 900, 'housing', null, '2026-10-01', null);

-- ---------------------------------------------------------------------------
-- Investment orders
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(11);

select is(
  pg_temp.raised(format($$ select public.record_investment_order(%L, %L, 'VWCE.DE', 'EUR', 'sell', 440, 4, 110, '2026-02-01T10:00:00Z') $$,
    pg_temp.rid('c3'), pg_temp.rid('a2'))),
  'ok',
  'a sale within the position is saved'
);
select is(
  pg_temp.raised(format($$ select public.record_investment_order(%L, %L, 'VWCE.DE', 'EUR', 'sell', 770, 7, 110, '2026-03-01T10:00:00Z') $$,
    pg_temp.rid('c4'), pg_temp.rid('a2'))),
  '23514 hint:user Sell quantity exceeds the available VWCE.DE position.',
  'a sale larger than what is left is refused, for the user'
);
select is(
  pg_temp.raised(format($$ select public.record_investment_order(%L, %L, 'VWCE.DE', 'EUR', 'sell', 660, 6, 110, '2026-03-01T10:00:00Z') $$,
    pg_temp.rid('c4'), pg_temp.rid('a2'))),
  'ok',
  'a sale of exactly what is left is saved'
);
select is(
  pg_temp.raised(format($$ select public.record_investment_order(%L, %L, 'VWCE.DE', 'EUR', 'sell', 110, 1, 110, '2025-12-01T10:00:00Z') $$,
    pg_temp.rid('c5'), pg_temp.rid('a2'))),
  '23514 hint:user Sell quantity exceeds the available VWCE.DE position.',
  'a sale dated before the first purchase is refused'
);
select is(
  pg_temp.raised(format($$ select public.record_investment_order(%L, %L, 'VWCE.DE', 'USD', 'buy', 100, 1, 100, '2026-03-02T10:00:00Z') $$,
    pg_temp.rid('c5'), pg_temp.rid('a2'))),
  'ok',
  'the same instrument in another currency is another asset'
);
select is(
  (select count(*)::integer from public.investment_transactions where investment_account_id = pg_temp.rid('a2')),
  4,
  'refused orders are not saved'
);
select is(
  pg_temp.raised(format($$ select public.record_investment_order(%L, %L, 'VWCE.DE', 'EUR', 'buy', 100, 1, 100, '2026-03-02T10:00:00Z') $$,
    pg_temp.rid('c6'), pg_temp.rid('a3'))),
  'P0002 hint:user That investment account wasn''t found.',
  'someone else''s account is not found'
);
select is(
  pg_temp.raised(format($$ select public.record_investment_order(%L, %L, 'VWCE.DE', 'EUR', 'buy', 0, 1, 100, '2026-03-02T10:00:00Z') $$,
    pg_temp.rid('c6'), pg_temp.rid('a2'))),
  '23514 hint:none new row for relation "investment_transactions" violates check constraint "investment_transactions_amount_positive"',
  'a bad value is left to the table''s checks'
);

select is(
  pg_temp.raised(format($$ select public.delete_investment_order(%L) $$, pg_temp.rid('b2'))),
  '23514 hint:user This order cannot be removed because it would invalidate the later history: Sell quantity exceeds the available VWCE.DE position.',
  'removing the purchase the sales depend on is refused'
);
select is(public.delete_investment_order(pg_temp.rid('c4')), true, 'removing the last sale works');
select is(public.delete_investment_order(pg_temp.rid('c4')), false, 'removing it again finds nothing');
select is(public.delete_investment_order(pg_temp.rid('b3')), false, 'someone else''s order is not found');
reset role;
select is(
  (select count(*)::integer from public.investment_transactions where id in (pg_temp.rid('b2'), pg_temp.rid('b3'))),
  2,
  'refused and foreign removals delete nothing'
);
set local role authenticated;

select pg_temp.act_as(null);
select is(
  pg_temp.raised(format($$ select public.record_investment_order(%L, %L, 'VWCE.DE', 'EUR', 'buy', 100, 1, 100, '2026-03-02T10:00:00Z') $$,
    pg_temp.rid('c7'), pg_temp.rid('a2'))),
  '42501 hint:user Sign in to record an investment order.',
  'recording needs a user'
);
select is(
  pg_temp.raised(format($$ select public.delete_investment_order(%L) $$, pg_temp.rid('c3'))),
  '42501 hint:user Sign in to remove an investment order.',
  'removing needs a user'
);

-- ---------------------------------------------------------------------------
-- Expense edits
-- ---------------------------------------------------------------------------

select pg_temp.act_as(11);

select results_eq(
  format($$ select description, amount, category, subtype, expense_date, notes from public.update_expense(%L, '{"amount": 55.5}') $$, pg_temp.rid('e2')),
  $$ values ('Fuel'::text, 55.50::numeric, 'car'::text, 'car_fuel'::text, '2026-10-01'::date, 'Full tank'::text) $$,
  'an edit changes only the fields it names'
);
select results_eq(
  format($$ select category, subtype from public.update_expense(%L, '{"category": "car"}') $$, pg_temp.rid('e2')),
  $$ values ('car'::text, 'car_fuel'::text) $$,
  'the same category keeps the subtype'
);
select results_eq(
  format($$ select category, subtype, notes from public.update_expense(%L, '{"category": "groceries", "notes": ""}') $$, pg_temp.rid('e2')),
  $$ values ('groceries'::text, null::text, null::text) $$,
  'a new category drops a subtype that doesn''t belong, and empty notes are cleared'
);
select is(
  pg_temp.raised(format($$ select * from public.update_expense(%L, '{"subtype": "car_repairs"}') $$, pg_temp.rid('e2'))),
  '23514 hint:user Choose a subtype belonging to the selected category.',
  'a subtype outside the expense''s category is refused, for the user'
);
select results_eq(
  format($$ select category, subtype from public.update_expense(%L, '{"category": "car", "subtype": "car_repairs"}') $$, pg_temp.rid('e2')),
  $$ values ('car'::text, 'car_repairs'::text) $$,
  'a category and a subtype that belongs to it are set together'
);
select results_eq(
  format($$ select description, category, subtype from public.update_expense(%L, '{"description": "OMV"}') $$, pg_temp.rid('e2')),
  $$ values ('OMV'::text, 'car'::text, 'car_fuel'::text) $$,
  'the merchant classification still runs on the edited row'
);
select is(
  pg_temp.raised(format($$ select * from public.update_expense(%L, '{"amount": -1}') $$, pg_temp.rid('e2'))),
  '23514 hint:none new row for relation "expenses" violates check constraint "expenses_amount_valid"',
  'another bad value is left to the table''s checks'
);
select is(
  (select count(*)::integer from public.update_expense(pg_temp.rid('e3'), '{"amount": 1}')),
  0,
  'someone else''s expense returns nothing'
);
reset role;
select is(
  (select amount from public.expenses where id = pg_temp.rid('e3')),
  900::numeric,
  'and is left alone'
);
set local role authenticated;
select pg_temp.act_as(11);
select is(
  pg_temp.raised(format($$ select * from public.update_expense(%L, '{"user_id": "x"}') $$, pg_temp.rid('e2'))),
  '22023 hint:user An expense change can only set the description, amount, category, subtype, date and notes.',
  'a patch can''t name another column'
);
select is(
  pg_temp.raised(format($$ select * from public.update_expense(%L, '[]') $$, pg_temp.rid('e2'))),
  '22023 hint:user An expense change must be an object.',
  'a patch is an object'
);

-- ---------------------------------------------------------------------------
-- The AI budget
-- ---------------------------------------------------------------------------

reset role;

select ok(
  not has_function_privilege('authenticated', 'public.ai_reserve_budget(uuid, text, text, text, bigint, timestamptz, bigint, bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.ai_settle_usage(uuid, uuid, integer, integer, integer, bigint, text, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.ai_reserve_budget(uuid, text, text, text, bigint, timestamptz, bigint, bigint)', 'execute')
  and has_function_privilege('service_role', 'public.ai_settle_usage(uuid, uuid, integer, integer, integer, bigint, text, timestamptz)', 'execute'),
  'only the server reserves and settles'
);

-- Everything this transaction can see from this month is part 2's: limits are generous for
-- everyone's month except where a test says otherwise.
create function pg_temp.reserve(n integer, p_estimate bigint, p_family_limit bigint default 3000000, p_global_limit bigint default 100000000)
returns text
language sql
as $$
  select r.status || ':' || coalesce(r.family_spent_micros::text, '-') || ':' || coalesce(r.global_spent_micros::text, '-')
  from public.ai_reserve_budget(pg_temp.uid(n), 'statements', 'fake', 'fake-model', p_estimate,
    '2026-01-01T00:00:00Z', p_family_limit, p_global_limit) r
$$;

update public.app_flags set value = 'false'::jsonb where key = 'ai_enabled';
set local role service_role;
select is(pg_temp.reserve(16, 1), 'flag_off:-:-', 'the kill switch refuses first');
reset role;
update public.app_flags set value = 'true'::jsonb where key = 'ai_enabled';
set local role service_role;
select is(pg_temp.reserve(14, 1), 'not_permitted:-:-', 'a kid without the ai permission is refused');
select is(pg_temp.reserve(15, 1), 'ai_off:-:-', 'a user with the switch off is refused');

select is(pg_temp.reserve(13, 2000000), 'ok:0:0', 'a call that fits is reserved');
select results_eq(
  format($$ select user_id, family_id, feature, provider, model, cost_micros, outcome, input_tokens from public.ai_usage where user_id = %L $$, pg_temp.uid(13)),
  format($$ values (%L::uuid, %L::uuid, 'statements'::text, 'fake'::text, 'fake-model'::text, 2000000::bigint, 'reserved'::text, 0) $$, pg_temp.uid(13), pg_temp.rid('f2')),
  'the reservation is a ledger row with the worst case, in the family'
);
select alike(pg_temp.reserve(13, 1000001), 'family_budget:2000000:-', 'a call that would cross the family''s month is refused');
select alike(pg_temp.reserve(13, 1000000), 'ok:2000000:%', 'one that fits exactly is reserved');
select alike(pg_temp.reserve(13, 0), 'family_budget:3000000:-', 'a used-up month refuses even a free call');
select alike(pg_temp.reserve(16, 1, 3000000, 0), 'global_budget:0:%', 'everyone''s month is checked too, after the family''s');

select is(
  (select row(s.family_spent_micros, s.global_spent_micros >= 1500)::text
   from public.ai_settle_usage(
     (select id from public.ai_usage where user_id = pg_temp.uid(13) and cost_micros = 2000000),
     pg_temp.uid(13), 1000, 100, 0, 1500, 'ok', '2026-01-01T00:00:00Z') s),
  '(1001500,t)',
  'settling replaces the worst case with the real cost and returns the month''s spend'
);
select results_eq(
  format($$ select outcome, input_tokens, output_tokens, cost_micros from public.ai_usage where user_id = %L order by cost_micros $$, pg_temp.uid(13)),
  $$ values ('ok'::text, 1000, 100, 1500::bigint), ('reserved'::text, 0, 0, 1000000::bigint) $$,
  'only that reservation is settled'
);
select is(
  pg_temp.raised(format($$ select * from public.ai_settle_usage(%L, %L, 0, 0, 0, 0, 'ok', '2026-01-01T00:00:00Z') $$,
    (select id from public.ai_usage where user_id = pg_temp.uid(13) and outcome = 'ok'), pg_temp.uid(13))),
  'P0002 hint:user That AI reservation wasn''t found or was already settled.',
  'a reservation is settled once'
);
select is(
  pg_temp.raised(format($$ select * from public.ai_settle_usage(%L, %L, 0, 0, 0, 0, 'provider_error', '2026-01-01T00:00:00Z') $$,
    (select id from public.ai_usage where user_id = pg_temp.uid(13) and outcome = 'reserved'), pg_temp.uid(16))),
  'P0002 hint:user That AI reservation wasn''t found or was already settled.',
  'only by its own user'
);
select is(
  pg_temp.raised(format($$ select * from public.ai_settle_usage(%L, %L, 0, 0, 0, 0, 'reserved', '2026-01-01T00:00:00Z') $$,
    (select id from public.ai_usage where user_id = pg_temp.uid(13) and outcome = 'reserved'), pg_temp.uid(13))),
  '22023 hint:user A settled AI call needs its outcome.',
  'and to a real outcome'
);

select * from finish();
rollback;
