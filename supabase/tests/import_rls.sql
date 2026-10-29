begin;
create extension if not exists pgtap;
select plan(78);

-- I1 (docs/statement-import-plan.md): import_batches, import_rows and
-- import_expenses are owner only, with no family widening.
--
-- Users (prefix e1100000), with user number NN:
--   family A ('Family A', ...00fa): 01 creator parent, 02 kid with Expenses,
--     03 kid with Expenses and family_finance 'view'
--   family B ('Family B', ...00fb): 04 creator parent
--   05 has no family.
-- Member id of user NN: ...0000000f00NN.
--
-- Fixture batches (ids ...0000000b00NN, inserted as the table owner):
--   01 user 02, draft, rows 01 and 02     02 user 02, confirmed, linked to expenses 01 and 05
--   03 user 05, draft, row 03             04 user 04, draft, row 04
--   05 user 01, draft, row 05             06 user 02, draft, for the status moves
--   07 user 02, draft that has expired    08 user 02, draft, row 06, for the owner to delete
-- Fixture rows have ids ...0000000a00NN and fixture expenses ...0000000e00NN:
--   01 user 02 (linked)   02 user 01   03 user 02 (free)   04 user 03
--   05 user 02 (linked)   06 user 02 (free)   07 user 01 (free)

create function pg_temp.uid(n integer)
returns uuid
language sql
immutable
as $$
  select ('e1100000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.mid(n integer)
returns uuid
language sql
immutable
as $$
  select ('e1100000-0000-4000-8000-0000000f00' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.bid(n integer)
returns uuid
language sql
immutable
as $$
  select ('e1100000-0000-4000-8000-0000000b00' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.rid(n integer)
returns uuid
language sql
immutable
as $$
  select ('e1100000-0000-4000-8000-0000000a00' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.xid(n integer)
returns uuid
language sql
immutable
as $$
  select ('e1100000-0000-4000-8000-0000000e00' || lpad(n::text, 2, '0'))::uuid
$$;

-- A well-formed content hash for batch n.
create function pg_temp.hash(n integer)
returns text
language sql
immutable
as $$
  select lpad(to_hex(n), 64, '0')
$$;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'i1-rls-' || n || '@example.test', 'not-used', now(), '{}', '{}', now(), now()
from generate_series(1, 5) as n
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('e1100000-0000-4000-8000-0000000000fa', 'Family A', pg_temp.uid(1)),
  ('e1100000-0000-4000-8000-0000000000fb', 'Family B', pg_temp.uid(4));

insert into public.family_members (id, family_id, user_id, role) values
  (pg_temp.mid(1), 'e1100000-0000-4000-8000-0000000000fa', pg_temp.uid(1), 'parent'),
  (pg_temp.mid(2), 'e1100000-0000-4000-8000-0000000000fa', pg_temp.uid(2), 'kid'),
  (pg_temp.mid(3), 'e1100000-0000-4000-8000-0000000000fa', pg_temp.uid(3), 'kid'),
  (pg_temp.mid(4), 'e1100000-0000-4000-8000-0000000000fb', pg_temp.uid(4), 'parent');

insert into public.member_permissions (member_id, module, level) values
  (pg_temp.mid(2), 'expenses', 'edit'),
  (pg_temp.mid(3), 'expenses', 'edit'),
  (pg_temp.mid(3), 'family_finance', 'view');

insert into public.expenses (id, user_id, description, amount, category, expense_date) values
  (pg_temp.xid(1), pg_temp.uid(2), 'Imported one', 10, 'other', '2026-10-01'),
  (pg_temp.xid(2), pg_temp.uid(1), 'Parent expense', 11, 'other', '2026-10-01'),
  (pg_temp.xid(3), pg_temp.uid(2), 'Free one', 12, 'other', '2026-10-01'),
  (pg_temp.xid(4), pg_temp.uid(3), 'Second kid expense', 13, 'other', '2026-10-01'),
  (pg_temp.xid(5), pg_temp.uid(2), 'Imported two', 14, 'other', '2026-10-01'),
  (pg_temp.xid(6), pg_temp.uid(2), 'Free two', 15, 'other', '2026-10-01'),
  (pg_temp.xid(7), pg_temp.uid(1), 'Parent free', 16, 'other', '2026-10-01');

insert into public.import_batches (id, user_id, status, source_kind, parser_id, content_hash,
  row_count, created_at, expires_at, confirmed_at, confirmed_count) values
  (pg_temp.bid(1), pg_temp.uid(2), 'draft', 'csv', 'generic-csv', pg_temp.hash(1), 2, now(), now() + interval '24 hours', null, null),
  (pg_temp.bid(2), pg_temp.uid(2), 'confirmed', 'csv', 'generic-csv', pg_temp.hash(2), 2, now(), null, now(), 2),
  (pg_temp.bid(3), pg_temp.uid(5), 'draft', 'csv', 'generic-csv', pg_temp.hash(3), 1, now(), now() + interval '24 hours', null, null),
  (pg_temp.bid(4), pg_temp.uid(4), 'draft', 'csv', 'generic-csv', pg_temp.hash(4), 1, now(), now() + interval '24 hours', null, null),
  (pg_temp.bid(5), pg_temp.uid(1), 'draft', 'csv', 'generic-csv', pg_temp.hash(5), 1, now(), now() + interval '24 hours', null, null),
  (pg_temp.bid(6), pg_temp.uid(2), 'draft', 'csv', 'generic-csv', pg_temp.hash(6), 1, now(), now() + interval '24 hours', null, null),
  (pg_temp.bid(7), pg_temp.uid(2), 'draft', 'csv', 'generic-csv', pg_temp.hash(7), 1, now() - interval '25 hours', now() - interval '1 hour', null, null),
  (pg_temp.bid(8), pg_temp.uid(2), 'draft', 'csv', 'generic-csv', pg_temp.hash(8), 1, now(), now() + interval '24 hours', null, null);

insert into public.import_rows (id, batch_id, position, expense_date, description, amount, currency) values
  (pg_temp.rid(1), pg_temp.bid(1), 1, '2026-10-01', 'Row one', 10, 'RON'),
  (pg_temp.rid(2), pg_temp.bid(1), 2, '2026-10-02', 'Row two', 20, 'RON'),
  (pg_temp.rid(3), pg_temp.bid(3), 1, '2026-10-01', 'Row three', 30, 'RON'),
  (pg_temp.rid(4), pg_temp.bid(4), 1, '2026-10-01', 'Row four', 40, 'RON'),
  (pg_temp.rid(5), pg_temp.bid(5), 1, '2026-10-01', 'Row five', 50, 'RON'),
  (pg_temp.rid(6), pg_temp.bid(8), 1, '2026-10-01', 'Row six', 60, 'RON');

insert into public.import_expenses (expense_id, batch_id) values
  (pg_temp.xid(1), pg_temp.bid(2)),
  (pg_temp.xid(5), pg_temp.bid(2));

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

-- The fixture batch numbers the caller can read.
create function pg_temp.batches()
returns integer[]
language sql
as $$
  select coalesce(array_agg(right(b.id::text, 2)::integer order by b.id), '{}')
  from public.import_batches b
  where b.id::text like 'e1100000-%'
$$;

-- The fixture row numbers the caller can read.
create function pg_temp.rows()
returns integer[]
language sql
as $$
  select coalesce(array_agg(right(r.id::text, 2)::integer order by r.id), '{}')
  from public.import_rows r
  where r.id::text like 'e1100000-%'
$$;

-- The numbers of the fixture expenses whose links the caller can read.
create function pg_temp.links()
returns integer[]
language sql
as $$
  select coalesce(array_agg(right(l.expense_id::text, 2)::integer order by l.expense_id), '{}')
  from public.import_expenses l
  where l.expense_id::text like 'e1100000-%'
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

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------

select has_table('public', 'import_batches', 'public.import_batches exists');
select has_table('public', 'import_rows', 'public.import_rows exists');
select has_table('public', 'import_expenses', 'public.import_expenses exists');
select ok(
  (select bool_and(c.relrowsecurity)
   from pg_catalog.pg_class c
   where c.oid in ('public.import_batches'::regclass, 'public.import_rows'::regclass,
     'public.import_expenses'::regclass)),
  'RLS is enabled on all three import tables'
);
select table_privs_are('public', 'import_batches', 'authenticated', array['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  'authenticated can select, insert, update and delete import_batches');
select table_privs_are('public', 'import_rows', 'authenticated', array['DELETE', 'INSERT', 'SELECT'],
  'authenticated can select, insert and delete import_rows, not update them');
select table_privs_are('public', 'import_expenses', 'authenticated', array['INSERT', 'SELECT'],
  'authenticated can select and insert import_expenses, not change or delete them');
select table_privs_are('public', 'import_batches', 'anon', array[]::text[], 'anon has no privileges on import_batches');
select table_privs_are('public', 'import_rows', 'anon', array[]::text[], 'anon has no privileges on import_rows');
select table_privs_are('public', 'import_expenses', 'anon', array[]::text[], 'anon has no privileges on import_expenses');
select policies_are('public', 'import_batches',
  array['import_batches_select_own', 'import_batches_insert_own', 'import_batches_update_own', 'import_batches_delete_own_draft'],
  'import_batches has exactly the four owner policies');
select policies_are('public', 'import_rows',
  array['import_rows_select_own', 'import_rows_insert_own', 'import_rows_delete_own'],
  'import_rows has exactly the three owner policies (no update)');
select policies_are('public', 'import_expenses',
  array['import_expenses_select_own', 'import_expenses_insert_own'],
  'import_expenses has exactly the two owner policies');
select has_index('public', 'import_batches', 'import_batches_user_id_created_at_idx', array['user_id', 'created_at'],
  'import_batches is indexed by user and creation time');
select has_index('public', 'import_batches', 'import_batches_expires_at_idx', array['expires_at'],
  'import_batches is indexed by expiry for the purge');
select has_index('public', 'import_expenses', 'import_expenses_batch_id_idx', array['batch_id'],
  'import_expenses is indexed by batch');
select ok(
  (select i.indisunique and pg_catalog.pg_get_expr(i.indpred, i.indrelid) like '%draft%confirmed%'
   from pg_catalog.pg_index i
   where i.indexrelid = 'public.import_batches_live_hash_idx'::regclass),
  'one live batch per user and content hash: a partial unique index over drafts and confirmed batches'
);
select has_trigger('public', 'import_batches', 'import_batches_guard', 'import_batches has the import_batches_guard trigger');

-- ---------------------------------------------------------------------------
-- The owner (02, a kid) reads and changes their own imports
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(2);

select is(pg_temp.batches(), array[1, 2, 6, 7, 8], 'the owner sees their own batches, an expired draft included');
select is(pg_temp.rows(), array[1, 2, 6], 'the owner sees the rows of their batches');
select is(pg_temp.links(), array[1, 5], 'the owner sees the links of their batches');

select is(
  pg_temp.attempt(format($q$update public.import_batches set currency = 'EUR', period_start = '2026-10-01' where id = %L$q$, pg_temp.bid(1))),
  'rows:1',
  'the owner changes the unfixed columns of their batch'
);
select is(
  pg_temp.attempt(format($q$insert into public.import_batches (id, user_id, source_kind, parser_id, content_hash, row_count, expires_at)
    values (%L, %L, 'csv', 'generic-csv', %L, 1, now() + interval '24 hours')$q$,
    pg_temp.bid(9), pg_temp.uid(2), pg_temp.hash(9))),
  'rows:1',
  'the owner adds a draft batch for themselves'
);
select is(
  pg_temp.attempt(format($q$insert into public.import_batches (id, user_id, source_kind, parser_id, content_hash, row_count, expires_at)
    values (%L, %L, 'csv', 'generic-csv', %L, 1, now() + interval '24 hours')$q$,
    pg_temp.bid(10), pg_temp.uid(1), pg_temp.hash(10))),
  'error:42501',
  'the owner can''t add a batch for someone else'
);
select is(
  pg_temp.attempt(format($q$insert into public.import_batches (id, user_id, status, source_kind, parser_id, content_hash, row_count, confirmed_at, confirmed_count)
    values (%L, %L, 'confirmed', 'csv', 'generic-csv', %L, 1, now(), 1)$q$,
    pg_temp.bid(11), pg_temp.uid(2), pg_temp.hash(11))),
  'error:42501',
  'a batch can only be inserted as a draft'
);
select is(
  pg_temp.attempt(format($q$insert into public.import_rows (batch_id, position, expense_date, description, amount, currency)
    values (%L, 3, '2026-10-03', 'Row three', 30, 'RON')$q$, pg_temp.bid(1))),
  'rows:1',
  'the owner adds a row to their batch'
);
select is(
  pg_temp.attempt(format($q$insert into public.import_rows (batch_id, position, expense_date, description, amount, currency)
    values (%L, 2, '2026-10-03', 'Row three', 30, 'RON')$q$, pg_temp.bid(3))),
  'error:42501',
  'the owner can''t add a row to someone else''s batch'
);
select is(
  pg_temp.attempt(format($q$update public.import_rows set description = 'Changed' where id = %L$q$, pg_temp.rid(1))),
  'error:42501',
  'draft rows can''t be updated'
);
select is(
  pg_temp.attempt(format('delete from public.import_rows where id = %L', pg_temp.rid(2))),
  'rows:1',
  'the owner deletes a row of their batch'
);

-- A confirmed batch is kept; a draft, even an expired one, can be deleted.
select is(
  pg_temp.attempt(format('delete from public.import_batches where id = %L', pg_temp.bid(2))),
  'rows:0',
  'a confirmed batch can''t be deleted directly'
);
select is(
  pg_temp.attempt(format('delete from public.import_batches where id = %L', pg_temp.bid(7))),
  'rows:1',
  'the owner deletes an expired draft (the policy doesn''t hide it)'
);
select is(
  pg_temp.attempt(format('delete from public.import_batches where id = %L', pg_temp.bid(8))),
  'rows:1',
  'the owner discards a draft'
);
select is(pg_temp.rows(), array[1], 'discarding a draft deleted its row, and the owner''s other deletes took effect');

-- The fixed columns.
select is(
  pg_temp.attempt(format('update public.import_batches set user_id = %L where id = %L', pg_temp.uid(1), pg_temp.bid(1))),
  'error:42501',
  'user_id can''t change'
);
select is(
  pg_temp.attempt(format($q$update public.import_batches set source_kind = 'pdf' where id = %L$q$, pg_temp.bid(1))),
  'error:42501',
  'source_kind can''t change'
);
select is(
  pg_temp.attempt(format($q$update public.import_batches set parser_id = 'other' where id = %L$q$, pg_temp.bid(1))),
  'error:42501',
  'parser_id can''t change'
);
select is(
  pg_temp.attempt(format('update public.import_batches set content_hash = %L where id = %L', pg_temp.hash(99), pg_temp.bid(1))),
  'error:42501',
  'content_hash can''t change'
);
select is(
  pg_temp.attempt(format('update public.import_batches set row_count = 5 where id = %L', pg_temp.bid(1))),
  'error:42501',
  'row_count can''t change'
);
select is(
  pg_temp.attempt(format($q$update public.import_batches set created_at = '2020-01-01 00:00:00+00' where id = %L$q$, pg_temp.bid(1))),
  'error:42501',
  'created_at can''t change'
);

-- The status moves draft -> confirmed -> undone and no other way.
select is(
  pg_temp.attempt(format($q$update public.import_batches set status = 'undone', expires_at = null, undone_at = now(), confirmed_at = now()
    where id = %L$q$, pg_temp.bid(6))),
  'error:55000',
  'a draft can''t skip to undone'
);
select is(
  pg_temp.attempt(format($q$update public.import_batches set status = 'confirmed', expires_at = null, confirmed_at = now(), confirmed_count = 1
    where id = %L$q$, pg_temp.bid(6))),
  'rows:1',
  'a draft can be confirmed'
);
select is(
  pg_temp.attempt(format($q$update public.import_batches set status = 'draft', expires_at = now() + interval '1 hour'
    where id = %L$q$, pg_temp.bid(6))),
  'error:55000',
  'a confirmed batch can''t go back to a draft'
);
select is(
  pg_temp.attempt(format($q$update public.import_batches set status = 'undone', undone_at = now() where id = %L$q$, pg_temp.bid(6))),
  'rows:1',
  'a confirmed batch can be undone'
);
select is(
  pg_temp.attempt(format($q$update public.import_batches set status = 'confirmed', undone_at = null where id = %L$q$, pg_temp.bid(6))),
  'error:55000',
  'an undone batch can''t be confirmed again'
);

-- Links.
select is(
  pg_temp.attempt(format('insert into public.import_expenses (expense_id, batch_id) values (%L, %L)', pg_temp.xid(3), pg_temp.bid(1))),
  'rows:1',
  'the owner links their own expense to their own batch'
);
select is(
  pg_temp.attempt(format('insert into public.import_expenses (expense_id, batch_id) values (%L, %L)', pg_temp.xid(6), pg_temp.bid(3))),
  'error:42501',
  'a link can''t be added to someone else''s batch'
);
select is(
  pg_temp.attempt(format('insert into public.import_expenses (expense_id, batch_id) values (%L, %L)', pg_temp.xid(4), pg_temp.bid(1))),
  'error:42501',
  'a link can''t name an expense that isn''t the caller''s'
);
select is(
  pg_temp.attempt(format('update public.import_expenses set batch_id = %L where expense_id = %L', pg_temp.bid(1), pg_temp.xid(1))),
  'error:42501',
  'a link can''t be changed'
);
select is(
  pg_temp.attempt(format('delete from public.import_expenses where expense_id = %L', pg_temp.xid(1))),
  'error:42501',
  'a link can''t be deleted directly'
);

-- ---------------------------------------------------------------------------
-- Nobody else sees or changes them
-- ---------------------------------------------------------------------------

-- A parent reads the kid's expenses (Family finance), but not their imports.
select pg_temp.act_as(1);
select is(pg_temp.batches(), array[5], 'a parent sees only their own batches, not the kid''s');
select is(pg_temp.rows(), array[5], 'a parent sees only the rows of their own batches');
select is(pg_temp.links(), '{}'::integer[], 'a parent sees none of the kid''s links');
select is(
  (select count(*)::integer from public.expenses x where x.id = pg_temp.xid(1)),
  1,
  'the parent can read the kid''s expense, which is what the explicit link check is for'
);
select is(
  pg_temp.attempt(format($q$update public.import_batches set currency = 'EUR' where id = %L$q$, pg_temp.bid(1))),
  'rows:0',
  'a parent can''t change the kid''s batch'
);
select is(
  pg_temp.attempt(format('delete from public.import_batches where id = %L', pg_temp.bid(1))),
  'rows:0',
  'a parent can''t delete the kid''s draft'
);
select is(
  pg_temp.attempt(format('delete from public.import_rows where id = %L', pg_temp.rid(1))),
  'rows:0',
  'a parent can''t delete the kid''s rows'
);
select is(
  pg_temp.attempt(format($q$insert into public.import_rows (batch_id, position, expense_date, description, amount, currency)
    values (%L, 9, '2026-10-03', 'Planted', 30, 'RON')$q$, pg_temp.bid(1))),
  'error:42501',
  'a parent can''t add a row to the kid''s batch'
);
select is(
  pg_temp.attempt(format('insert into public.import_expenses (expense_id, batch_id) values (%L, %L)', pg_temp.xid(7), pg_temp.bid(1))),
  'error:42501',
  'a parent can''t link their own expense to the kid''s batch'
);
select is(
  pg_temp.attempt(format('insert into public.import_expenses (expense_id, batch_id) values (%L, %L)', pg_temp.xid(6), pg_temp.bid(5))),
  'error:42501',
  'a parent can''t link an expense they can read but don''t own to their own batch'
);

-- A kid with Family finance at view reads the family's expenses, not its imports.
select pg_temp.act_as(3);
select is(pg_temp.batches(), '{}'::integer[], 'a kid with Family finance sees no batches');
select is(pg_temp.rows(), '{}'::integer[], 'and no rows');
select is(pg_temp.links(), '{}'::integer[], 'and no links');

-- A member of another family, and a user without a family.
select pg_temp.act_as(4);
select is(pg_temp.batches(), array[4], 'a user in another family sees only their own batch');
select is(
  pg_temp.attempt(format($q$update public.import_batches set currency = 'EUR' where id = %L$q$, pg_temp.bid(1))),
  'rows:0',
  'another family''s user can''t change the batch'
);
select pg_temp.act_as(5);
select is(pg_temp.batches(), array[3], 'a user without a family sees only their own batch');
select is(pg_temp.rows(), array[3], 'and its rows');
select is(
  pg_temp.attempt(format('delete from public.import_batches where id = %L', pg_temp.bid(1))),
  'rows:0',
  'a user without a family can''t delete the batch'
);
select pg_temp.act_as(null);
select is(pg_temp.batches(), '{}'::integer[], 'a session without a user sees nothing');
reset role;

set local role anon;
select is(pg_temp.attempt('select * from public.import_batches'), 'error:42501', 'anon can''t read batches');
select is(pg_temp.attempt('select * from public.import_rows'), 'error:42501', 'anon can''t read rows');
select is(pg_temp.attempt('select * from public.import_expenses'), 'error:42501', 'anon can''t read links');
reset role;

-- ---------------------------------------------------------------------------
-- Cascades
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from public.import_rows r where r.batch_id = pg_temp.bid(8)),
  0,
  'discarding a draft deleted its rows'
);

-- Deleting an imported expense removes its link only.
delete from public.expenses where id = pg_temp.xid(5);
select is(
  (select array_agg(right(l.expense_id::text, 2)::integer order by l.expense_id)
   from public.import_expenses l where l.batch_id = pg_temp.bid(2)),
  array[1],
  'deleting an imported expense removes its link'
);
select is(
  (select count(*)::integer from public.import_batches b where b.id = pg_temp.bid(2)),
  1,
  'and keeps the batch'
);

-- Deleting the user removes their batches, rows and links.
delete from auth.users where id = pg_temp.uid(2);
select is(
  (select count(*)::integer from public.import_batches b where b.user_id = pg_temp.uid(2)),
  0,
  'deleting the user deletes their batches'
);
select is(
  (select count(*)::integer from public.import_rows r where r.batch_id in (pg_temp.bid(1), pg_temp.bid(2), pg_temp.bid(6))),
  0,
  'and their rows'
);
select is(
  (select count(*)::integer from public.import_expenses l where l.batch_id in (pg_temp.bid(1), pg_temp.bid(2), pg_temp.bid(6))),
  0,
  'and their links'
);
select is(
  (select array_agg(right(b.id::text, 2)::integer order by b.id) from public.import_batches b where b.id::text like 'e1100000-%'),
  array[3, 4, 5],
  'other users'' batches are untouched'
);

select * from finish();
rollback;
