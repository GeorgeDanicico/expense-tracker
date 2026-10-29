begin;

-- Statement import (docs/statement-import-plan.md, I1).
--
-- 1. public.import_batches and public.import_rows: the draft of an uploaded
--    statement. A batch is one upload, its rows are the debits found in it.
--    A draft lives for 24 hours, or until it is confirmed.
-- 2. public.import_expenses: which expenses an import created. A link table,
--    so public.expenses stays untouched: restore_historical_merchants()
--    (20261003113407) compares whole-row to_jsonb(expenses) against snapshots,
--    and a new column on expenses would make it report every backed-up row as
--    edited.
-- 3. RLS: the owner only. There is no family widening: a parent doesn't read
--    their kids' imports, whatever Family finance says.
-- 4. import_batches_guard: the fixed columns never change, and the status
--    moves only draft -> confirmed -> undone.
-- 5. create_import_batch(), confirm_import_batch(), undo_import_batch() (security
--    invoker, so RLS applies; each runs in one transaction) and
--    purge_expired_import_batches() (service_role only). Discarding a draft
--    needs no function: delete from import_batches where id = ... and
--    status = 'draft' cascades to its rows.
--
-- SQL error codes, the contract with the repository (I5):
--   create_import_batch
--     42501  no signed-in user
--     22023  p_batch isn't a JSON object, or p_rows isn't an array of 1-500 objects
--     23505  the caller already has a live batch (draft or confirmed) with this
--            content_hash (import_batches_live_hash_idx)
--     23514  a check failed (a blank or over-long description, an amount of zero
--            or less, a bad currency, a bad source_kind, ...)
--     23502  a required field is missing from p_batch or a row
--   confirm_import_batch
--     P0002  the batch is missing, someone else's, or an expired draft
--     55000  the batch isn't a draft (already confirmed, or undone)
--     22023  p_rows is empty, over 500, not an array of objects, repeats a row id,
--            or names a row id that isn't in the batch
--     23514, 23502  a row failed an expenses check; nothing is saved and the
--            batch stays a draft
--   undo_import_batch
--     P0002  the batch is missing or someone else's
--     55000  the batch isn't confirmed
--   purge_expired_import_batches
--     42501  called by anyone but service_role
--   import_batches_guard (a direct update)
--     42501  a fixed column changed
--     55000  the status moved anywhere but draft -> confirmed -> undone
--
-- Same conventions as the to-do and calendar tables: the caller is
-- app_private.current_user_id(), policies wrap helpers in a sub-select so they
-- run once per query, set search_path = '' and fully qualified names.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'undone')),
  source_kind text not null check (source_kind in ('csv', 'pdf')),
  parser_id text not null check (char_length(parser_id) between 1 and 60),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  currency text check (currency ~ '^[A-Z]{3}$'),             -- the statement's currency, if it has one
  period_start date,
  period_end date,
  row_count integer not null check (row_count between 1 and 500),
  skipped_credits integer not null default 0 check (skipped_credits >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz,                                    -- drafts only: created_at + 24 hours
  confirmed_at timestamptz,
  confirmed_count integer check (confirmed_count >= 0),
  undone_at timestamptz,
  check ((status = 'draft') = (expires_at is not null)),
  check (status = 'draft' or confirmed_at is not null),
  check ((status = 'undone') = (undone_at is not null))
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  position smallint not null check (position between 1 and 500),   -- order in the statement
  expense_date date not null,
  description text not null check (char_length(btrim(description)) between 1 and 120),
  amount numeric(12, 2) not null check (amount > 0 and amount <= 9999999999.99),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  category text not null default 'other',                    -- the suggestion
  subtype text,
  rule_matched boolean not null default false,               -- the merchant classification recognised it
  notes text check (notes is null or char_length(notes) <= 500),
  unique (batch_id, position),
  -- The same checks as public.expenses (20261003110022).
  constraint import_rows_category_valid check (
    category in ('housing', 'groceries', 'transport', 'car', 'utilities', 'health',
      'entertainment', 'shopping', 'education', 'travel', 'other')
  ),
  constraint import_rows_subtype_valid check (
    subtype is null or (
      category = 'car' and subtype in ('car_maintenance', 'car_fuel', 'car_repairs')
    )
  )
);

-- Which expenses an import created. A separate table, so `expenses` itself is untouched.
create table public.import_expenses (
  expense_id uuid primary key references public.expenses(id) on delete cascade,
  batch_id uuid not null references public.import_batches(id) on delete cascade
);

-- One live batch per statement for a user: an undone one frees the hash. An
-- expired draft still counts until it is deleted, which create_import_batch()
-- and the purge do.
create unique index import_batches_live_hash_idx
  on public.import_batches (user_id, content_hash)
  where status in ('draft', 'confirmed');
-- Serves the list of recent imports, and the user cascade.
create index import_batches_user_id_created_at_idx
  on public.import_batches (user_id, created_at desc);
-- Serves the purge.
create index import_batches_expires_at_idx
  on public.import_batches (expires_at)
  where status = 'draft';
-- Serves undo and the counts. (import_rows is covered by unique (batch_id, position).)
create index import_expenses_batch_id_idx
  on public.import_expenses (batch_id);

comment on table public.import_batches is
  'One uploaded statement: a draft for 24 hours, then confirmed or undone. Owner only; parents don''t read their kids'' imports.';
comment on column public.import_batches.content_hash is
  'SHA-256 of the normalised rows, not of the file, so a re-download of the same statement matches. Unique per user among draft and confirmed batches.';
comment on column public.import_batches.currency is
  'The statement''s currency, when it has a single one.';
comment on column public.import_batches.skipped_credits is
  'How many incoming payments and refunds were left out of the draft.';
comment on column public.import_batches.expires_at is
  'Drafts only: created_at + 24 hours. Null once confirmed or undone. An expired draft counts as missing everywhere.';
comment on column public.import_batches.confirmed_count is
  'How many expenses the confirmation created.';
comment on table public.import_rows is
  'The draft rows of an import batch, one per debit. Never updated; deleted when the batch is confirmed.';
comment on column public.import_rows.position is
  'The row''s order in the statement, from 1.';
comment on column public.import_rows.rule_matched is
  'True when the merchant classification recognised the description and set category and subtype.';
comment on table public.import_expenses is
  'Which expenses an import batch created. Kept apart from public.expenses so restore_historical_merchants() still sees expenses whole. Rows go away with their expense or batch.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.import_expenses enable row level security;

revoke all on table public.import_batches, public.import_rows, public.import_expenses
  from public, anon, authenticated;
grant select, insert, update, delete on table public.import_batches to authenticated;
-- No update: draft rows never change.
grant select, insert, delete on table public.import_rows to authenticated;
-- Rows go away with their expense or batch through the foreign keys.
grant select, insert on table public.import_expenses to authenticated;

create policy import_batches_select_own on public.import_batches
for select to authenticated
using (user_id = (select app_private.current_user_id()));

create policy import_batches_insert_own on public.import_batches
for insert to authenticated
with check (
  user_id = (select app_private.current_user_id())
  and status = 'draft'
);

create policy import_batches_update_own on public.import_batches
for update to authenticated
using (user_id = (select app_private.current_user_id()))
with check (user_id = (select app_private.current_user_id()));

-- Only own drafts: a confirmed batch is kept, because expenses are linked to
-- it. Expired drafts are deliberately not hidden by the select policy: a row
-- the select policy hides can't be deleted by its owner either, and the upload
-- needs to clear them. The functions below and the repository treat an expired
-- draft as missing instead.
create policy import_batches_delete_own_draft on public.import_batches
for delete to authenticated
using (
  user_id = (select app_private.current_user_id())
  and status = 'draft'
);

create policy import_rows_select_own on public.import_rows
for select to authenticated
using (batch_id in (
  select b.id from public.import_batches b
  where b.user_id = (select app_private.current_user_id())
));

create policy import_rows_insert_own on public.import_rows
for insert to authenticated
with check (batch_id in (
  select b.id from public.import_batches b
  where b.user_id = (select app_private.current_user_id())
));

create policy import_rows_delete_own on public.import_rows
for delete to authenticated
using (batch_id in (
  select b.id from public.import_batches b
  where b.user_id = (select app_private.current_user_id())
));

create policy import_expenses_select_own on public.import_expenses
for select to authenticated
using (batch_id in (
  select b.id from public.import_batches b
  where b.user_id = (select app_private.current_user_id())
));

-- The expense check is explicit: the expenses select policy is wider than
-- "own" for parents, so merely being able to see an expense proves nothing.
create policy import_expenses_insert_own on public.import_expenses
for insert to authenticated
with check (
  batch_id in (
    select b.id from public.import_batches b
    where b.user_id = (select app_private.current_user_id())
  )
  and exists (
    select 1
    from public.expenses e
    where e.id = import_expenses.expense_id
      and e.user_id = (select app_private.current_user_id())
  )
);

-- ---------------------------------------------------------------------------
-- Guard
-- ---------------------------------------------------------------------------

-- Security invoker, like todos_guard. user_id, source_kind, parser_id,
-- content_hash, row_count and created_at never change (42501), and the status
-- moves only draft -> confirmed -> undone (55000 otherwise).
create function public.import_batches_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.source_kind is distinct from old.source_kind
    or new.parser_id is distinct from old.parser_id
    or new.content_hash is distinct from old.content_hash
    or new.row_count is distinct from old.row_count
    or new.created_at is distinct from old.created_at
  then
    raise exception 'An import''s owner, source, content and creation time can''t be changed.'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status
    and not (
      (old.status = 'draft' and new.status = 'confirmed')
      or (old.status = 'confirmed' and new.status = 'undone')
    )
  then
    raise exception 'An import can only go from draft to confirmed to undone.'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function public.import_batches_guard() from public, anon, authenticated;

comment on function public.import_batches_guard() is
  'Trigger: user_id, source_kind, parser_id, content_hash, row_count and created_at never change (42501); status moves only draft -> confirmed -> undone (55000).';

create trigger import_batches_guard
before update on public.import_batches
for each row execute function public.import_batches_guard();

-- ---------------------------------------------------------------------------
-- Creating a draft
-- ---------------------------------------------------------------------------

-- Deletes the caller's expired drafts, then inserts the batch and its rows, in
-- one transaction, and returns the batch id. Security invoker, so RLS applies.
--
-- p_batch is an object with source_kind, parser_id and content_hash, and
-- optionally currency, period_start, period_end and skipped_credits (default
-- 0). user_id is the caller's, status is 'draft', expires_at is now() + 24
-- hours and row_count is the number of rows in p_rows.
--
-- p_rows is an array of 1-500 objects with expense_date, description, amount
-- and currency, and optionally notes; their position is their place in the
-- array, from 1. Each row's category and subtype come from the existing merchant
-- classification: a recognised merchant gets 'car', its subtype and
-- rule_matched = true, every other row is 'other'.
create function public.create_import_batch(p_batch jsonb, p_rows jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  new_batch_id uuid;
begin
  if caller_id is null then
    raise exception 'Sign in to import a statement.'
      using errcode = '42501';
  end if;

  if p_batch is null or jsonb_typeof(p_batch) <> 'object' then
    raise exception 'The import batch must be an object.'
      using errcode = '22023';
  end if;

  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 500
  then
    raise exception 'An import has between 1 and 500 rows.'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) e(value)
    where jsonb_typeof(e.value) <> 'object'
  ) then
    raise exception 'Every import row must be an object.'
      using errcode = '22023';
  end if;

  delete from public.import_batches b
  where b.user_id = caller_id
    and b.status = 'draft'
    and b.expires_at <= now();

  insert into public.import_batches (
    user_id, status, source_kind, parser_id, content_hash, currency,
    period_start, period_end, row_count, skipped_credits, expires_at
  )
  select
    caller_id, 'draft', b.source_kind, b.parser_id, b.content_hash, b.currency,
    b.period_start, b.period_end, jsonb_array_length(p_rows),
    coalesce(b.skipped_credits, 0), now() + interval '24 hours'
  from jsonb_to_record(p_batch) as b(
    source_kind text, parser_id text, content_hash text, currency text,
    period_start date, period_end date, skipped_credits integer
  )
  returning id into new_batch_id;

  insert into public.import_rows (
    batch_id, position, expense_date, description, amount, currency,
    category, subtype, rule_matched, notes
  )
  select
    new_batch_id, e.idx::smallint, r.expense_date, r.description, r.amount, r.currency,
    case when c.subtype is null then 'other' else 'car' end,
    c.subtype,
    c.subtype is not null,
    r.notes
  from jsonb_array_elements(p_rows) with ordinality as e(value, idx)
  cross join lateral jsonb_to_record(e.value) as r(
    expense_date date, description text, amount numeric, currency text, notes text
  )
  cross join lateral (
    select expense_classification_private.classify_expense_merchant(r.description, null) as subtype
  ) c
  order by e.idx;

  return new_batch_id;
end;
$$;

revoke all on function public.create_import_batch(jsonb, jsonb) from public, anon;
grant execute on function public.create_import_batch(jsonb, jsonb) to authenticated;

comment on function public.create_import_batch(jsonb, jsonb) is
  'Deletes the caller''s expired drafts, then inserts a draft batch (24 hours) and its 1-500 rows atomically, as the caller (RLS applies); rows the merchant classification recognises get car and their subtype. Returns the batch id. 42501 without a user, 22023 for a bad shape or row count, 23505 for a hash the caller already has live, 23514 and 23502 for a bad row.';

-- ---------------------------------------------------------------------------
-- Confirming a draft
-- ---------------------------------------------------------------------------

-- Inserts the rows in p_rows into expenses for the caller, links each new
-- expense to the batch, marks the batch confirmed, deletes its draft rows and
-- returns the expenses as stored (after the merchant trigger), in the order of
-- p_rows. One transaction: a row that fails a check rolls everything back and
-- the batch stays a draft. Security invoker, so RLS applies.
--
-- Each element of p_rows is the row's final values: id (an import_rows id of
-- this batch), description, amount, expense_date and category, and optionally
-- subtype and notes. Draft rows that aren't listed are left out. The batch's
-- currency rule is the caller's to enforce: the draft rows' currencies aren't
-- looked at here.
create function public.confirm_import_batch(p_batch_id uuid, p_rows jsonb)
returns table (
  id uuid,
  description text,
  amount numeric,
  category text,
  subtype text,
  expense_date date,
  notes text
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  caller_id uuid := app_private.current_user_id();
  batch public.import_batches;
  picked record;
  new_id uuid;
  new_ids uuid[] := '{}';
begin
  select * into batch
  from public.import_batches b
  where b.id = p_batch_id
  for update;

  if not found then
    raise exception 'That import wasn''t found or has expired.'
      using errcode = 'P0002';
  end if;

  if batch.status <> 'draft' then
    raise exception 'That import has already been confirmed or undone.'
      using errcode = '55000';
  end if;

  if batch.expires_at <= now() then
    raise exception 'That import wasn''t found or has expired.'
      using errcode = 'P0002';
  end if;

  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 500
  then
    raise exception 'Confirm between 1 and 500 rows.'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) e(value)
    where jsonb_typeof(e.value) <> 'object'
  ) then
    raise exception 'Every confirmed row must be an object.'
      using errcode = '22023';
  end if;

  if (
    select count(distinct x.id) from jsonb_to_recordset(p_rows) as x(id uuid)
  ) <> jsonb_array_length(p_rows)
  or exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(id uuid)
    where not exists (
      select 1 from public.import_rows ir
      where ir.id = x.id and ir.batch_id = p_batch_id
    )
  ) then
    raise exception 'Every confirmed row must be a different row of this import.'
      using errcode = '22023';
  end if;

  for picked in
    select r.description, r.amount, r.expense_date, r.category, r.subtype, r.notes
    from jsonb_array_elements(p_rows) with ordinality as e(value, idx)
    cross join lateral jsonb_to_record(e.value) as r(
      description text, amount numeric, expense_date date, category text,
      subtype text, notes text
    )
    order by e.idx
  loop
    insert into public.expenses (
      user_id, description, amount, category, subtype, expense_date, notes
    )
    values (
      caller_id, picked.description, picked.amount, picked.category,
      picked.subtype, picked.expense_date, picked.notes
    )
    returning expenses.id into new_id;

    insert into public.import_expenses (expense_id, batch_id)
    values (new_id, p_batch_id);

    new_ids := array_append(new_ids, new_id);
  end loop;

  update public.import_batches b
  set status = 'confirmed',
      confirmed_at = now(),
      confirmed_count = cardinality(new_ids),
      expires_at = null
  where b.id = p_batch_id;

  delete from public.import_rows ir
  where ir.batch_id = p_batch_id;

  return query
  select e.id, e.description, e.amount, e.category, e.subtype, e.expense_date, e.notes
  from public.expenses e
  where e.id = any(new_ids)
  order by array_position(new_ids, e.id);
end;
$$;

revoke all on function public.confirm_import_batch(uuid, jsonb) from public, anon;
grant execute on function public.confirm_import_batch(uuid, jsonb) to authenticated;

comment on function public.confirm_import_batch(uuid, jsonb) is
  'Inserts the given rows (final values) into expenses for the caller, links each to the batch, marks it confirmed, deletes its draft rows and returns the expenses as stored, atomically. P0002 when the batch is missing, someone else''s or an expired draft, 55000 when it isn''t a draft, 22023 for a bad, repeated or foreign row id or a bad row count, 23514 and 23502 for a bad row (nothing is saved).';

-- ---------------------------------------------------------------------------
-- Undoing an import
-- ---------------------------------------------------------------------------

-- Deletes the caller's expenses linked to the batch (the links go with them),
-- marks the batch undone and returns how many expenses were deleted. Expenses
-- the caller already deleted by hand aren't counted. Security invoker.
create function public.undo_import_batch(p_batch_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  batch public.import_batches;
  removed integer;
begin
  select * into batch
  from public.import_batches b
  where b.id = p_batch_id
  for update;

  if not found then
    raise exception 'That import wasn''t found.'
      using errcode = 'P0002';
  end if;

  if batch.status <> 'confirmed' then
    raise exception 'Only a confirmed import can be undone.'
      using errcode = '55000';
  end if;

  with gone as (
    delete from public.expenses e
    using public.import_expenses l
    where l.expense_id = e.id
      and l.batch_id = p_batch_id
      and e.user_id = caller_id
    returning e.id
  )
  select count(*)::integer into removed from gone;

  update public.import_batches b
  set status = 'undone',
      undone_at = now()
  where b.id = p_batch_id;

  return removed;
end;
$$;

revoke all on function public.undo_import_batch(uuid) from public, anon;
grant execute on function public.undo_import_batch(uuid) to authenticated;

comment on function public.undo_import_batch(uuid) is
  'Deletes the caller''s expenses linked to a confirmed batch, marks it undone and returns how many were deleted, atomically. P0002 when the batch is missing or someone else''s, 55000 when it isn''t confirmed.';

-- ---------------------------------------------------------------------------
-- The worker's purge
-- ---------------------------------------------------------------------------

-- Deletes every user's drafts whose expires_at has passed (their rows go with
-- them) and returns how many. service_role bypasses RLS, so it sees all users.
create function public.purge_expired_import_batches()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  removed integer;
begin
  with gone as (
    delete from public.import_batches b
    where b.status = 'draft'
      and b.expires_at <= now()
    returning b.id
  )
  select count(*)::integer into removed from gone;

  return removed;
end;
$$;

revoke all on function public.purge_expired_import_batches() from public, anon, authenticated;
grant execute on function public.purge_expired_import_batches() to service_role;

comment on function public.purge_expired_import_batches() is
  'Worker: deletes drafts whose expires_at has passed, with their rows, and returns the count. service_role only.';

commit;
