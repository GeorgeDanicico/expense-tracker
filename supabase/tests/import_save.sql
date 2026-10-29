begin;
create extension if not exists pgtap;
select plan(79);

-- I1 (docs/statement-import-plan.md): create_import_batch(),
-- confirm_import_batch(), undo_import_batch() and purge_expired_import_batches().
--
-- Users (prefix e1200000): 01 and 02, neither in a family.
-- Batches are found by their content hash: pg_temp.hash(n) is the hash of
-- batch n. Fixtures (inserted as the table owner):
--   101 user 01, draft that has expired, one row    102 user 01, live draft, one row
--   103 user 01, confirmed                          104 user 02, draft that has expired, one row
-- Fixture expenses: 01 and 02 each own one that no import made.

create function pg_temp.uid(n integer)
returns uuid
language sql
immutable
as $$
  select ('e1200000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.hash(n integer)
returns text
language sql
immutable
as $$
  select lpad(to_hex(n), 64, '0')
$$;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'i1-save-' || n || '@example.test', 'not-used', now(), '{}', '{}', now(), now()
from generate_series(1, 2) as n
on conflict (id) do nothing;

insert into public.import_batches (id, user_id, status, source_kind, parser_id, content_hash,
  row_count, created_at, expires_at, confirmed_at, confirmed_count) values
  ('e1200000-0000-4000-8000-0000000b0101', pg_temp.uid(1), 'draft', 'csv', 'generic-csv', pg_temp.hash(101), 1, now() - interval '25 hours', now() - interval '1 hour', null, null),
  ('e1200000-0000-4000-8000-0000000b0102', pg_temp.uid(1), 'draft', 'csv', 'generic-csv', pg_temp.hash(102), 1, now(), now() + interval '24 hours', null, null),
  ('e1200000-0000-4000-8000-0000000b0103', pg_temp.uid(1), 'confirmed', 'csv', 'generic-csv', pg_temp.hash(103), 1, now(), null, now(), 1),
  ('e1200000-0000-4000-8000-0000000b0104', pg_temp.uid(2), 'draft', 'csv', 'generic-csv', pg_temp.hash(104), 1, now() - interval '25 hours', now() - interval '1 hour', null, null);

insert into public.import_rows (id, batch_id, position, expense_date, description, amount, currency) values
  ('e1200000-0000-4000-8000-0000000a0101', 'e1200000-0000-4000-8000-0000000b0101', 1, '2026-10-01', 'Expired row', 10, 'RON'),
  ('e1200000-0000-4000-8000-0000000a0102', 'e1200000-0000-4000-8000-0000000b0102', 1, '2026-10-01', 'Live row', 20, 'RON'),
  ('e1200000-0000-4000-8000-0000000a0104', 'e1200000-0000-4000-8000-0000000b0104', 1, '2026-10-01', 'Other expired row', 40, 'RON');

insert into public.expenses (id, user_id, description, amount, category, expense_date) values
  ('e1200000-0000-4000-8000-0000000e0001', pg_temp.uid(1), 'Hand added', 5, 'other', '2026-10-01'),
  ('e1200000-0000-4000-8000-0000000e0002', pg_temp.uid(2), 'Hand added by the other user', 6, 'other', '2026-10-01');

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

-- The batch object the upload sends.
create function pg_temp.batch(p_hash_n integer)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'source_kind', 'csv',
    'parser_id', 'generic-csv',
    'content_hash', pg_temp.hash(p_hash_n),
    'currency', 'RON',
    'period_start', '2026-10-01',
    'period_end', '2026-10-31',
    'skipped_credits', 3
  )
$$;

-- One draft row, as the upload sends it.
create function pg_temp.draft_row(p_description text, p_amount numeric, p_notes text default null)
returns jsonb
language sql
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'expense_date', '2026-10-05',
    'description', p_description,
    'amount', p_amount,
    'currency', 'RON',
    'notes', p_notes
  ))
$$;

-- One confirmed row, as the confirm route sends it.
create function pg_temp.pick(p_id uuid, p_description text, p_amount numeric, p_category text,
  p_subtype text default null, p_notes text default null)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', p_id,
    'description', p_description,
    'amount', p_amount,
    'expense_date', '2026-10-06',
    'category', p_category,
    'subtype', p_subtype,
    'notes', p_notes
  )
$$;

-- The live batch with hash n, and the id of its row at a position.
create function pg_temp.bid(n integer)
returns uuid
language sql
as $$
  select b.id from public.import_batches b
  where b.content_hash = pg_temp.hash(n) and b.status in ('draft', 'confirmed')
$$;

create function pg_temp.rid(n integer, pos integer)
returns uuid
language sql
as $$
  select r.id from public.import_rows r where r.batch_id = pg_temp.bid(n) and r.position = pos
$$;

-- Keep a batch id across statements: set_config's third argument makes it local.
create function pg_temp.remember(p_name text, p_id uuid)
returns void
language sql
as $$
  select set_config('i1.' || p_name, p_id::text, true);
  select null::void;
$$;

create function pg_temp.recall(p_name text)
returns uuid
language sql
as $$
  select current_setting('i1.' || p_name)::uuid
$$;

-- "<batches>/<rows>" under the caller's RLS for the hashes in p_hashes.
create function pg_temp.stored(p_hashes integer[])
returns text
language sql
as $$
  select (select count(*) from public.import_batches b
      where b.content_hash = any (select pg_temp.hash(h) from unnest(p_hashes) h))
    || '/' || (select count(*) from public.import_rows r
      join public.import_batches b on b.id = r.batch_id
      where b.content_hash = any (select pg_temp.hash(h) from unnest(p_hashes) h))
$$;

-- How many expenses the caller can read with a description starting with p_prefix.
create function pg_temp.expense_count(p_prefix text)
returns integer
language sql
as $$
  select count(*)::integer from public.expenses e
  where e.user_id = app_private.current_user_id() and e.description like p_prefix || '%'
$$;

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.create_import_batch(jsonb, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.confirm_import_batch(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.undo_import_batch(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.create_import_batch(jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.confirm_import_batch(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.undo_import_batch(uuid)', 'execute'),
  'create, confirm and undo are granted to authenticated and not anon'
);
select ok(
  has_function_privilege('service_role', 'public.purge_expired_import_batches()', 'execute')
  and not has_function_privilege('authenticated', 'public.purge_expired_import_batches()', 'execute')
  and not has_function_privilege('anon', 'public.purge_expired_import_batches()', 'execute'),
  'the purge is granted to service_role only'
);
select ok(
  (select bool_and(not p.prosecdef and p.proconfig @> array['search_path=""'])
   from pg_catalog.pg_proc p
   where p.oid in (
     'public.create_import_batch(jsonb, jsonb)'::regprocedure,
     'public.confirm_import_batch(uuid, jsonb)'::regprocedure,
     'public.undo_import_batch(uuid)'::regprocedure,
     'public.purge_expired_import_batches()'::regprocedure,
     'public.import_batches_guard()'::regprocedure
   )),
  'the import functions and the guard are security invoker with an empty search_path'
);

-- ---------------------------------------------------------------------------
-- create_import_batch: refusals insert nothing
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(1);

select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(1),
    jsonb_build_array(pg_temp.draft_row('Lidl', 12.5), pg_temp.draft_row('Free coffee', 0)))),
  'error:23514',
  'a row with a zero amount fails the call'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(2),
    jsonb_build_array(pg_temp.draft_row('Lidl', 12.5), pg_temp.draft_row('   ', 5)))),
  'error:23514',
  'a row with a blank description fails the call'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(3),
    jsonb_build_array(pg_temp.draft_row(repeat('x', 121), 5)))),
  'error:23514',
  'a description over 120 characters fails the call'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(4),
    jsonb_build_array(jsonb_set(pg_temp.draft_row('Lidl', 5), '{currency}', '"ron"')))),
  'error:23514',
  'a currency that isn''t three capitals fails the call'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(5) || '{"content_hash": "abc"}',
    jsonb_build_array(pg_temp.draft_row('Lidl', 5)))),
  'error:23514',
  'a content hash that isn''t 64 hex digits fails the call'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(6) || '{"source_kind": "xls"}',
    jsonb_build_array(pg_temp.draft_row('Lidl', 5)))),
  'error:23514',
  'a source kind other than csv or pdf fails the call'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(7) - 'content_hash',
    jsonb_build_array(pg_temp.draft_row('Lidl', 5)))),
  'error:23502',
  'a batch without a content hash fails the call'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(8),
    jsonb_build_array(pg_temp.draft_row('Lidl', 5) - 'amount'))),
  'error:23502',
  'a row without an amount fails the call'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(9), '[]')),
  'error:22023',
  'no rows is refused'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(9),
    (select jsonb_agg(pg_temp.draft_row('Row ' || n, 1)) from generate_series(1, 501) n))),
  'error:22023',
  '501 rows are refused'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(9), '{"description": "Not an array"}')),
  'error:22023',
  'rows that aren''t an array are refused'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(9), '[1, 2]')),
  'error:22023',
  'rows that aren''t objects are refused'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', '[]', jsonb_build_array(pg_temp.draft_row('Lidl', 5)))),
  'error:22023',
  'a batch that isn''t an object is refused'
);

select pg_temp.act_as(null);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(9),
    jsonb_build_array(pg_temp.draft_row('Lidl', 5)))),
  'error:42501',
  'a session without a user can''t create a batch'
);
reset role;

-- Every failed call rolled back as a whole: no batch, no rows, and the caller's
-- expired draft, which the failing calls had started to delete, is still there.
select is(
  (select count(*)::integer from public.import_batches b where b.content_hash = any (select pg_temp.hash(h) from generate_series(1, 9) h)),
  0,
  'the failed calls inserted no batch'
);
select is(
  (select count(*)::integer from public.import_batches b where b.id = 'e1200000-0000-4000-8000-0000000b0101'),
  1,
  'and did not delete the expired draft'
);

-- ---------------------------------------------------------------------------
-- create_import_batch: a draft
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(1);

select pg_temp.remember('d', public.create_import_batch(pg_temp.batch(10),
  jsonb_build_array(
    pg_temp.draft_row('OMV 1642 Satu Mare', 45.2),
    pg_temp.draft_row('Lidl', 12.5),
    pg_temp.draft_row('Autonet', 300, 'the long description continues here'))));

select isnt(pg_temp.recall('d'), null, 'create_import_batch returns the batch id');
select is(
  (select row(b.id = pg_temp.recall('d'), b.user_id, b.status, b.source_kind, b.parser_id, b.currency,
     b.period_start, b.period_end, b.row_count, b.skipped_credits, b.expires_at = now() + interval '24 hours',
     b.confirmed_at, b.confirmed_count, b.undone_at)::text
   from public.import_batches b where b.id = pg_temp.recall('d')),
  row(true, pg_temp.uid(1), 'draft'::text, 'csv'::text, 'generic-csv'::text, 'RON'::text,
    '2026-10-01'::date, '2026-10-31'::date, 3, 3, true, null::timestamptz, null::integer, null::timestamptz)::text,
  'the batch is the caller''s draft, with its counts, and expires in 24 hours'
);
select is(
  (select array_agg(row(r.position, r.description, r.amount, r.currency, r.expense_date, r.category, r.subtype,
     r.rule_matched, r.notes)::text order by r.position)
   from public.import_rows r where r.batch_id = pg_temp.recall('d')),
  array[
    row(1, 'OMV 1642 Satu Mare', 45.20, 'RON', '2026-10-05'::date, 'car', 'car_fuel', true, null::text)::text,
    row(2, 'Lidl', 12.50, 'RON', '2026-10-05'::date, 'other', null::text, false, null::text)::text,
    row(3, 'Autonet', 300.00, 'RON', '2026-10-05'::date, 'car', 'car_maintenance', true, 'the long description continues here')::text
  ],
  'the rows are inserted in order; a merchant the classification knows is car with its subtype, an unknown one is other'
);

-- A bare batch gets the defaults.
select isnt(
  public.create_import_batch(
    jsonb_build_object('source_kind', 'pdf', 'parser_id', 'a-parser', 'content_hash', pg_temp.hash(11)),
    jsonb_build_array(pg_temp.draft_row('Kaufland', 8))),
  null,
  'a batch with only the required fields is accepted'
);
select is(
  (select row(b.source_kind, b.currency, b.period_start, b.period_end, b.skipped_credits, b.row_count)::text
   from public.import_batches b where b.content_hash = pg_temp.hash(11)),
  row('pdf'::text, null::text, null::date, null::date, 0, 1)::text,
  'the optional fields default to none, and skipped_credits to 0'
);

-- It cleared the caller's expired draft and nobody else's.
select is(pg_temp.stored(array[101]), '0/0', 'creating a batch deleted the caller''s expired draft and its rows');
select is(pg_temp.stored(array[102, 103]), '2/1', 'it left the caller''s live draft and confirmed batch alone');
select pg_temp.act_as(2);
select is(pg_temp.stored(array[104]), '1/1', 'it left the other user''s expired draft alone');

-- One live batch per statement and user.
select pg_temp.act_as(1);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(10),
    jsonb_build_array(pg_temp.draft_row('Lidl', 12.5)))),
  'error:23505',
  'the same hash as a live draft is a unique violation'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(103),
    jsonb_build_array(pg_temp.draft_row('Lidl', 12.5)))),
  'error:23505',
  'so is the hash of a confirmed batch'
);
select is(pg_temp.stored(array[10, 11]), '2/4', 'and the failed calls added nothing');
select pg_temp.act_as(2);
select isnt(
  public.create_import_batch(pg_temp.batch(10), jsonb_build_array(pg_temp.draft_row('Lidl', 12.5))),
  null,
  'another user may import the same statement'
);

-- ---------------------------------------------------------------------------
-- confirm_import_batch: refusals
-- ---------------------------------------------------------------------------

select pg_temp.act_as(1);
select pg_temp.remember('e', public.create_import_batch(pg_temp.batch(12),
  jsonb_build_array(pg_temp.draft_row('Spar', 20), pg_temp.draft_row('Mega Image', 30))));
select pg_temp.remember('f', public.create_import_batch(pg_temp.batch(13),
  jsonb_build_array(pg_temp.draft_row('Profi', 7), pg_temp.draft_row('Penny', 9))));


-- The row ids, as the caller sees them (user 02 has a batch with hash 10 too).
select pg_temp.remember('d1', pg_temp.rid(10, 1));
select pg_temp.remember('d2', pg_temp.rid(10, 2));
select pg_temp.remember('d3', pg_temp.rid(10, 3));
select pg_temp.remember('e1', pg_temp.rid(12, 1));
select pg_temp.remember('f1', pg_temp.rid(13, 1));
select pg_temp.remember('f2', pg_temp.rid(13, 2));

select pg_temp.act_as(2);
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', pg_temp.recall('d'),
    jsonb_build_array(pg_temp.pick(pg_temp.recall('d1'), 'OMV 1642 Satu Mare', 45.2, 'other')))),
  'error:P0002',
  'another user''s draft is refused as missing'
);
select pg_temp.act_as(1);
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', 'e1200000-0000-4000-8000-00000000ffff',
    jsonb_build_array(pg_temp.pick(pg_temp.recall('d1'), 'OMV 1642 Satu Mare', 45.2, 'other')))),
  'error:P0002',
  'a batch that doesn''t exist is refused as missing'
);

-- An expired draft that is still stored (as if the clean-up hadn't run yet).
reset role;
insert into public.import_batches (id, user_id, status, source_kind, parser_id, content_hash,
  row_count, created_at, expires_at) values
  ('e1200000-0000-4000-8000-0000000b0105', pg_temp.uid(1), 'draft', 'csv', 'generic-csv', pg_temp.hash(105), 1,
    now() - interval '25 hours', now() - interval '1 hour');
insert into public.import_rows (id, batch_id, position, expense_date, description, amount, currency) values
  ('e1200000-0000-4000-8000-0000000a0105', 'e1200000-0000-4000-8000-0000000b0105', 1, '2026-10-01', 'Late row', 10, 'RON');
set local role authenticated;
select pg_temp.act_as(1);
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', 'e1200000-0000-4000-8000-0000000b0105',
    jsonb_build_array(pg_temp.pick('e1200000-0000-4000-8000-0000000a0105', 'Late row', 10, 'other')))),
  'error:P0002',
  'an expired draft that is still stored is refused as missing'
);
select is(pg_temp.stored(array[105]), '1/1', 'and stays as it was');
select is(pg_temp.expense_count('Late row'), 0, 'and saved nothing');

-- Bad row lists.
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', pg_temp.recall('d'), '[]')),
  'error:22023',
  'no rows is refused'
);
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', pg_temp.recall('d'), '{"id": "x"}')),
  'error:22023',
  'rows that aren''t an array are refused'
);
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', pg_temp.recall('d'), '[1]')),
  'error:22023',
  'rows that aren''t objects are refused'
);
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', pg_temp.recall('d'),
    (select jsonb_agg(pg_temp.pick(pg_temp.recall('d1'), 'Lidl', 1, 'other')) from generate_series(1, 501)))),
  'error:22023',
  '501 rows are refused'
);
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', pg_temp.recall('d'),
    jsonb_build_array(pg_temp.pick(pg_temp.recall('d1'), 'Lidl', 1, 'other'), pg_temp.pick(pg_temp.recall('d1'), 'Lidl', 1, 'other')))),
  'error:22023',
  'a row id named twice is refused'
);
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', pg_temp.recall('d'),
    jsonb_build_array(pg_temp.pick(gen_random_uuid(), 'Lidl', 1, 'other')))),
  'error:22023',
  'a row id that doesn''t exist is refused'
);
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', pg_temp.recall('d'),
    jsonb_build_array(pg_temp.pick(pg_temp.recall('d1'), 'Lidl', 1, 'other'), pg_temp.pick(pg_temp.recall('e1'), 'Spar', 2, 'other')))),
  'error:22023',
  'a row id from another batch is refused, even next to a good one'
);
select is(pg_temp.expense_count('Lidl') + pg_temp.expense_count('Spar'), 0, 'and nothing was saved');

-- Atomic: a failing row saves nothing and the batch stays a draft.
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', pg_temp.bid(13),
    jsonb_build_array(pg_temp.pick(pg_temp.recall('f1'), 'Profi', 7, 'groceries'), pg_temp.pick(pg_temp.recall('f2'), 'Penny', 0, 'groceries')))),
  'error:23514',
  'a row with a zero amount fails the confirmation'
);
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', pg_temp.bid(13),
    jsonb_build_array(pg_temp.pick(pg_temp.recall('f1'), 'Profi', 7, 'groceries'), pg_temp.pick(pg_temp.recall('f2'), 'Penny', 9, 'groceries', 'car_fuel')))),
  'error:23514',
  'so does a subtype that doesn''t belong to the category'
);
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', pg_temp.bid(13),
    jsonb_build_array(pg_temp.pick(pg_temp.recall('f1'), 'Profi', 7, 'groceries'), pg_temp.pick(pg_temp.recall('f2'), 'Penny', 9, 'bogus')))),
  'error:23514',
  'and a category that doesn''t exist'
);
select is(pg_temp.expense_count('Profi') + pg_temp.expense_count('Penny'), 0, 'none of them saved the good row either');
select is(
  (select count(*)::integer from public.import_expenses l where l.batch_id = pg_temp.bid(13)),
  0,
  'or linked anything'
);
select is(
  (select row(b.status, b.confirmed_at, b.confirmed_count, b.expires_at is not null)::text
   from public.import_batches b where b.id = pg_temp.bid(13)),
  row('draft'::text, null::timestamptz, null::integer, true)::text,
  'the batch is still a draft'
);
select is(pg_temp.stored(array[13]), '1/2', 'with both its rows');

-- ---------------------------------------------------------------------------
-- confirm_import_batch: a confirmation
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(row(c.description, c.amount, c.category, c.subtype, c.expense_date, c.notes)::text order by c.n)
   from public.confirm_import_batch(pg_temp.recall('d'), jsonb_build_array(
     pg_temp.pick(pg_temp.recall('d1'), 'OMV 1642 Satu Mare', 45.2, 'other'),
     pg_temp.pick(pg_temp.recall('d2'), 'Lidl groceries', 13, 'groceries', null, 'edited')
   )) with ordinality as c(id, description, amount, category, subtype, expense_date, notes, n)),
  array[
    row('OMV 1642 Satu Mare'::text, 45.20, 'car'::text, 'car_fuel'::text, '2026-10-06'::date, null::text)::text,
    row('Lidl groceries'::text, 13.00, 'groceries'::text, null::text, '2026-10-06'::date, 'edited'::text)::text
  ],
  'confirm returns the expenses as stored, in order: the merchant trigger made the OMV row car, sent as other'
);
select is(
  (select array_agg(e.description order by e.description) from public.expenses e
   where e.user_id = pg_temp.uid(1) and e.description in ('OMV 1642 Satu Mare', 'Lidl groceries', 'Autonet')),
  array['Lidl groceries', 'OMV 1642 Satu Mare'],
  'exactly the given rows became expenses of the caller; the row left out did not'
);
select is(
  (select count(*)::integer from public.import_expenses l
   join public.expenses e on e.id = l.expense_id
   where l.batch_id = pg_temp.recall('d') and e.user_id = pg_temp.uid(1)
     and e.description in ('OMV 1642 Satu Mare', 'Lidl groceries')),
  2,
  'each new expense is linked to the batch'
);
select is(
  (select row(b.status, b.confirmed_at = now(), b.confirmed_count, b.expires_at)::text
   from public.import_batches b where b.id = pg_temp.recall('d')),
  row('confirmed'::text, true, 2, null::timestamptz)::text,
  'the batch is confirmed with its count, and no longer expires'
);
select is(pg_temp.stored(array[10]), '1/0', 'the draft rows are gone');
select is(
  pg_temp.attempt(format('select * from public.confirm_import_batch(%L, %L::jsonb)', pg_temp.recall('d'),
    jsonb_build_array(pg_temp.pick(pg_temp.recall('d3'), 'Autonet', 300, 'other')))),
  'error:55000',
  'confirming twice is refused'
);
select is(pg_temp.expense_count('Autonet'), 0, 'and saved nothing');

-- ---------------------------------------------------------------------------
-- undo_import_batch
-- ---------------------------------------------------------------------------

-- A link to someone else's expense, which only the table owner could have written.
reset role;
insert into public.import_expenses (expense_id, batch_id)
values ('e1200000-0000-4000-8000-0000000e0002', (select b.id from public.import_batches b
  where b.content_hash = pg_temp.hash(10) and b.user_id = pg_temp.uid(1)));
set local role authenticated;

select pg_temp.act_as(2);
select is(
  pg_temp.attempt(format('select public.undo_import_batch(%L)', pg_temp.recall('d'))),
  'error:P0002',
  'another user can''t undo the import: it counts as missing'
);
select pg_temp.act_as(1);
select is(
  pg_temp.attempt(format('select public.undo_import_batch(%L)', 'e1200000-0000-4000-8000-00000000ffff')),
  'error:P0002',
  'an import that doesn''t exist is refused as missing'
);
select is(
  pg_temp.attempt(format('select public.undo_import_batch(%L)', pg_temp.bid(12))),
  'error:55000',
  'a draft can''t be undone'
);

select is(public.undo_import_batch(pg_temp.recall('d')), 2, 'undo returns how many expenses it deleted');
select is(pg_temp.expense_count('OMV 1642') + pg_temp.expense_count('Lidl groceries'), 0, 'the imported expenses are gone');
select is(pg_temp.expense_count('Hand added'), 1, 'an expense no import made is still there');
reset role;
select is(
  (select count(*)::integer from public.expenses e where e.id = 'e1200000-0000-4000-8000-0000000e0002'),
  1,
  'and so is another user''s expense, even one linked to the batch'
);
select is(
  (select array_agg(l.expense_id) from public.import_expenses l where l.batch_id = pg_temp.recall('d')),
  array['e1200000-0000-4000-8000-0000000e0002'::uuid],
  'the links of the deleted expenses went with them'
);
set local role authenticated;
select pg_temp.act_as(1);
select is(
  (select row(b.status, b.undone_at = now(), b.confirmed_count)::text from public.import_batches b where b.id = pg_temp.recall('d')),
  row('undone'::text, true, 2)::text,
  'the batch is undone'
);
select is(
  pg_temp.attempt(format('select public.undo_import_batch(%L)', pg_temp.recall('d'))),
  'error:55000',
  'a second undo is refused'
);

-- The statement can be imported again once the import is undone.
select isnt(
  public.create_import_batch(pg_temp.batch(10), jsonb_build_array(pg_temp.draft_row('Lidl', 12.5))),
  null,
  'after an undo the same hash can be imported again'
);

-- An expense deleted by hand isn't counted.
select pg_temp.remember('g', public.create_import_batch(pg_temp.batch(14),
  jsonb_build_array(pg_temp.draft_row('Gone one', 3), pg_temp.draft_row('Gone two', 4))));
select count(*) from public.confirm_import_batch(pg_temp.recall('g'), jsonb_build_array(
  pg_temp.pick(pg_temp.rid(14, 1), 'Gone one', 3, 'other'),
  pg_temp.pick(pg_temp.rid(14, 2), 'Gone two', 4, 'other')));
delete from public.expenses e where e.description = 'Gone one' and e.user_id = pg_temp.uid(1);
select is(public.undo_import_batch(pg_temp.recall('g')), 1, 'undo doesn''t count an expense that was already deleted by hand');

-- ---------------------------------------------------------------------------
-- purge_expired_import_batches
-- ---------------------------------------------------------------------------

-- Earlier creates cleared the expired drafts of both users, so add new ones.
reset role;
insert into public.import_batches (id, user_id, status, source_kind, parser_id, content_hash,
  row_count, created_at, expires_at) values
  ('e1200000-0000-4000-8000-0000000b0106', pg_temp.uid(1), 'draft', 'csv', 'generic-csv', pg_temp.hash(106), 1,
    now() - interval '25 hours', now() - interval '1 hour'),
  ('e1200000-0000-4000-8000-0000000b0107', pg_temp.uid(2), 'draft', 'csv', 'generic-csv', pg_temp.hash(107), 1,
    now() - interval '30 hours', now() - interval '6 hours');
insert into public.import_rows (id, batch_id, position, expense_date, description, amount, currency) values
  ('e1200000-0000-4000-8000-0000000a0106', 'e1200000-0000-4000-8000-0000000b0106', 1, '2026-10-01', 'Old row', 10, 'RON'),
  ('e1200000-0000-4000-8000-0000000a0107', 'e1200000-0000-4000-8000-0000000b0107', 1, '2026-10-01', 'Older row', 10, 'RON');
set local role authenticated;
select pg_temp.act_as(1);
select is(pg_temp.attempt('select public.purge_expired_import_batches()'), 'error:42501', 'a user can''t run the purge');
reset role;
set local role anon;
select is(pg_temp.attempt('select public.purge_expired_import_batches()'), 'error:42501', 'anon can''t run the purge');
reset role;

set local role service_role;
select is(public.purge_expired_import_batches(), 2, 'the purge deletes the expired drafts of every user and returns the count');
select is(public.purge_expired_import_batches(), 0, 'and a second run finds none');
reset role;

select is(
  (select count(*)::integer from public.import_batches b where b.status = 'draft' and b.expires_at <= now()),
  0,
  'no expired draft is left'
);
select is(
  (select count(*)::integer from public.import_rows r where r.batch_id in (
    'e1200000-0000-4000-8000-0000000b0106', 'e1200000-0000-4000-8000-0000000b0107')),
  0,
  'their rows went with them'
);
select is(
  (select count(*)::integer from public.import_batches b where b.status = 'draft'),
  6,
  'live drafts are kept'
);
select is(
  (select count(*)::integer from public.import_rows r where r.batch_id = 'e1200000-0000-4000-8000-0000000b0102'),
  1,
  'with their rows'
);
select is(
  (select count(*)::integer from public.import_batches b where b.status in ('confirmed', 'undone')),
  3,
  'and confirmed and undone batches are kept'
);

select * from finish();
rollback;
