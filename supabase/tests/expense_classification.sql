begin;
create extension if not exists pgtap;
select plan(40);

select results_eq($$
  select expense_classification_private.classify_expense_merchant(description, null)
  from (values
    (1, 'Autonet Satu Mare'), (2, 'OMV 1642 Satu Mare'), (3, 'OMV 1947 Satu Mare'),
    (4, E'  aUtOnEt\tSATU   MARE  '), (5, 'Autonet'), (6, 'OMV'), (7, 'Petrom'),
    (8, 'AUTONET STR. AUREL VLAICU NR. 78 SATU MARE'),
    (9, 'OMV 1642 Bdul Lucian Blaga 120 Satu Mare'),
    (10, 'OMV 1947 B-dul Henri Coanda nr. 7 SATU MARE'),
    (11, 'CNAIR road toll - TM28PNW'), (12, 'Allianz-Tiriac insurance'),
    (13, 'CNAIR road toll - SM23DIF'),
    (14, E' cNaIr   ROAD toll - tm28pnw  '),
    (15, E'  ALLIANZ-TIRIAC\tINSURANCE '),
    (16, E'cnair road toll   -   sm23dif')) fixture(n, description)
  order by n
$$, $$ values ('car_maintenance'::text), ('car_fuel'), ('car_fuel'),
  ('car_maintenance'), ('car_maintenance'), ('car_fuel'), ('car_fuel'),
  ('car_maintenance'), ('car_fuel'), ('car_fuel'), ('car_maintenance'),
  ('car_maintenance'), ('car_maintenance'), ('car_maintenance'),
  ('car_maintenance'), ('car_maintenance') $$,
  'observed descriptions/address suffixes and exact approved descriptions tolerate case/whitespace only');

select results_eq($$
  select expense_classification_private.classify_expense_merchant(description, 'OMV Petrom Autonet CNAIR Allianz-Tiriac')
  from (values (1, 'My OMV expense'), (2, 'OMVillage'), (3, 'Autonetwork'),
    (4, 'Petromania'), (5, 'Taxi'), (6, 'OMV Bucharest'), (7, 'O.M.V'),
    (8, 'Petrom Satu Mare'), (9, 'CNAIR road toll - CJ12ABC'),
    (10, 'CNAIR road toll TM28PNW'), (11, 'CNAIR road toll - TM28PNW card'),
    (12, 'Allianz-Tiriac'), (13, 'Allianz-Tiriac asigurari Bucuresti'),
    (14, 'My Allianz-Tiriac insurance')) fixture(n, description) order by n
$$, $$ values (null::text), (null::text), (null::text), (null::text),
  (null::text), (null::text), (null::text), (null::text), (null::text),
  (null::text), (null::text), (null::text), (null::text), (null::text) $$,
  'embedded brands, arbitrary notes, unapproved suffixes and near matches do not classify');

select is(expense_classification_private.classify_expense_merchant('Card payment',
  'BT Star Forte statement 2026-08; processed: 2026-08-05; transaction: 2026-08-03 22:41; source: OMV 1642 Bdul Lucian Blaga 120 Satu Mare'),
  'car_fuel', 'neutral description may fall back to approved observed statement source');
select is(expense_classification_private.classify_expense_merchant('Expense',
  'BT Star Forte statement 2026-08; processed: 2026-08-28; transaction: 2026-08-26 15:47; source: AUTONET STR. AUREL VLAICU NR. 78 SATU MARE'),
  'car_maintenance', 'approved source fallback recognizes Autonet');
select is(expense_classification_private.classify_expense_merchant('Taxi', 'source: OMV'),
  null::text, 'arbitrary source note is ignored');
select is(expense_classification_private.classify_expense_merchant('Taxi',
  'BT Star Forte statement 2026-08; processed: 2026-08-05; transaction: 2026-08-03 22:41; source: OMV'),
  null::text, 'substantive conflicting description blocks source fallback');
select is(expense_classification_private.classify_expense_merchant('OMV',
  'BT Star Forte statement 2026-08; processed: 2026-08-05; transaction: 2026-08-03 22:41; source: Petrom'),
  null::text, 'different merchants conflict even when both map to fuel');
select is(expense_classification_private.classify_expense_merchant('OMV',
  'BT Star Forte statement 2026-08; processed: 2026-08-05; transaction: 2026-08-03 22:41; source: Taxi'),
  null::text, 'unrecognized substantive source conflicts with known description');
select is(expense_classification_private.classify_expense_merchant('Expense',
  'Other statement 2026-08; processed: 2026-08-05; transaction: 2026-08-03 22:41; source: OMV'),
  null::text, 'unapproved statement envelope cannot supply source');
select is(expense_classification_private.classify_expense_merchant('Expense',
  'BT Star Forte statement 2026-08; processed: 2026-08-05; transaction: 2026-08-03 22:41; source: OMV; source: Autonet'),
  null::text, 'multiple source segments are rejected');
select is(expense_classification_private.inspect_merchant('O.M.V', null) ->> 'status',
  'unrecognized_spelling_or_suffix', 'unrecognized spellings are reviewable but never classified');
select results_eq($$
  select expense_classification_private.inspect_merchant(description, null) ->> 'status'
  from (values (1, 'CNAIR road toll - CJ12ABC'), (2, 'Allianz-Tiriac asigurari')) fixture(n, description)
  order by n
$$, $$ values ('unrecognized_spelling_or_suffix'::text), ('unrecognized_spelling_or_suffix') $$,
  'unapproved variants are reportable for review without receiving a classification');

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('72000000-0000-0000-0000-000000000001', 'merchant-test@example.test', 'unused', now(), '{}', '{}', now(), now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$
  insert into public.expenses (id, user_id, description, amount, category, expense_date)
  values ('72000000-0000-0000-0000-000000000010', '72000000-0000-0000-0000-000000000001', 'Petrom', 50, 'transport', '2026-08-01')
$$, 'ordinary authenticated INSERT can run invoker merchant trigger');
select is((select category || '/' || subtype from public.expenses where id = '72000000-0000-0000-0000-000000000010'),
  'car/car_fuel', 'trigger has precedence over generic Transport');
update public.expenses set description = 'Autonet', category = 'shopping', subtype = null
where id = '72000000-0000-0000-0000-000000000010';
select is((select category || '/' || subtype from public.expenses where id = '72000000-0000-0000-0000-000000000010'),
  'car/car_maintenance', 'relevant UPDATE reclassifies to current recognized merchant');
update public.expenses set category = 'other', subtype = null
where id = '72000000-0000-0000-0000-000000000010';
select is((select category || '/' || subtype from public.expenses where id = '72000000-0000-0000-0000-000000000010'),
  'car/car_maintenance', 'specific merchant mapping overrides manual wrong category');
select lives_ok($$
  insert into public.expenses (id, user_id, description, amount, category, expense_date)
  values
    ('72000000-0000-0000-0000-000000000012', '72000000-0000-0000-0000-000000000001', 'CNAIR road toll - TM28PNW', 11, 'transport', '2026-09-01'),
    ('72000000-0000-0000-0000-000000000013', '72000000-0000-0000-0000-000000000001', 'Allianz-Tiriac insurance', 12, 'transport', '2026-09-01'),
    ('72000000-0000-0000-0000-000000000014', '72000000-0000-0000-0000-000000000001', 'CNAIR road toll - SM23DIF', 13, 'transport', '2026-09-01')
$$, 'authenticated INSERT accepts the exact newly approved descriptions');
select results_eq($$ select category || '/' || subtype from public.expenses
  where id between '72000000-0000-0000-0000-000000000012' and '72000000-0000-0000-0000-000000000014' order by id $$,
  $$ values ('car/car_maintenance'::text), ('car/car_maintenance'), ('car/car_maintenance') $$,
  'future writes classify each new exact description as Car maintenance');
insert into public.expenses (id, user_id, description, amount, category, expense_date, notes)
values ('72000000-0000-0000-0000-000000000011', '72000000-0000-0000-0000-000000000001',
  'Expense', 1, 'transport', '2026-08-01', 'Paid at OMV earlier');
select is((select category from public.expenses where id = '72000000-0000-0000-0000-000000000011'),
  'transport', 'INSERT leaves ordinary notes and unrelated Transport classification unchanged');
update public.expenses set notes = 'BT Star Forte statement 2026-08; processed: 2026-08-05; transaction: 2026-08-03 22:41; source: OMV'
where id = '72000000-0000-0000-0000-000000000011';
select is((select category || '/' || subtype from public.expenses where id = '72000000-0000-0000-0000-000000000011'),
  'car/car_fuel', 'notes-only UPDATE can classify a neutral description with approved source');
select throws_ok($$ select * from expense_classification_private.expense_backups $$,
  '42501', null, 'authenticated user cannot read protected backups');
select throws_ok($$ select expense_classification_private.correct_historical_merchants() $$,
  '42501', null, 'authenticated user cannot invoke privileged correction');
select throws_ok($$ select * from expense_classification_private.restore_historical_merchants() $$,
  '42501', null, 'authenticated user cannot invoke recovery');
reset role;

-- Simulate pre-rollout historical rows. Four recognized records include the
-- two distinct OMV 1642 amounts; other categories also need correction.
alter table public.expenses disable trigger expenses_classify_merchant;
insert into public.expenses (id, user_id, description, amount, category, expense_date, notes)
values
  ('72000000-0000-0000-0000-000000000021', '72000000-0000-0000-0000-000000000001', 'Autonet Satu Mare', 2274.06, 'shopping', '2026-08-26', 'BT Star Forte statement 2026-08; processed: 2026-08-28; transaction: 2026-08-26 15:47; source: AUTONET STR. AUREL VLAICU NR. 78 SATU MARE'),
  ('72000000-0000-0000-0000-000000000022', '72000000-0000-0000-0000-000000000001', 'OMV 1642 Satu Mare', 354.81, 'transport', '2026-08-03', 'BT Star Forte statement 2026-08; processed: 2026-08-05; transaction: 2026-08-03 22:41; source: OMV 1642 Bdul Lucian Blaga 120 Satu Mare'),
  ('72000000-0000-0000-0000-000000000023', '72000000-0000-0000-0000-000000000001', 'OMV 1642 Satu Mare', 20.00, 'entertainment', '2026-08-03', 'BT statement 2026-08; REF: 000NVPO262176v4a; transaction date: 2026-08-03'),
  ('72000000-0000-0000-0000-000000000024', '72000000-0000-0000-0000-000000000001', 'OMV 1947 Satu Mare', 300.03, 'health', '2026-08-23', 'BT Star Forte statement 2026-08; processed: 2026-08-25; transaction: 2026-08-23 11:50; source: OMV 1947 B-dul Henri Coanda nr. 7 SATU MARE'),
  ('72000000-0000-0000-0000-000000000025', '72000000-0000-0000-0000-000000000001', 'Taxi', 19.99, 'transport', '2025-02-03', 'Bought fuel earlier at OMV'),
  ('72000000-0000-0000-0000-000000000026', '72000000-0000-0000-0000-000000000001', 'OMV', 8.01, 'transport', '2026-08-03', 'BT Star Forte statement 2026-08; processed: 2026-08-05; transaction: 2026-08-03 22:41; source: Petrom'),
  ('72000000-0000-0000-0000-000000000027', '72000000-0000-0000-0000-000000000001', 'OMV Bucharest', 1.01, 'transport', '2026-08-03', null),
  ('72000000-0000-0000-0000-000000000028', '72000000-0000-0000-0000-000000000001', 'CNAIR road toll - TM28PNW', 11.00, 'transport', '2026-08-04', null),
  ('72000000-0000-0000-0000-000000000029', '72000000-0000-0000-0000-000000000001', 'Allianz-Tiriac insurance', 12.00, 'health', '2026-08-05', null),
  ('72000000-0000-0000-0000-000000000030', '72000000-0000-0000-0000-000000000001', 'CNAIR road toll - SM23DIF', 13.00, 'shopping', '2026-08-06', null);
alter table public.expenses enable trigger expenses_classify_merchant;
create temporary table merchant_before as select id, to_jsonb(e) as snapshot from public.expenses e;
select is(expense_classification_private.correct_historical_merchants(), 7, 'first correction updates exactly seven confirmed rows');
select is((select count(*) from expense_classification_private.expense_backups), 7::bigint, 'backup captures all seven distinct records');
select results_eq($$ select category || '/' || subtype from public.expenses
  where id between '72000000-0000-0000-0000-000000000028' and '72000000-0000-0000-0000-000000000030' order by id $$,
  $$ values ('car/car_maintenance'::text), ('car/car_maintenance'), ('car/car_maintenance') $$,
  'historical correction maps all three exact new descriptions to Car maintenance');
select is((select sum(amount) from public.expenses where id between '72000000-0000-0000-0000-000000000021' and '72000000-0000-0000-0000-000000000024'),
  2948.90::numeric, 'confirmed historical amount is preserved');
select is((select sum(amount) from public.expenses where id between '72000000-0000-0000-0000-000000000021' and '72000000-0000-0000-0000-000000000024' and subtype = 'car_fuel'),
  674.84::numeric, 'the three confirmed fuel records have the expected classification and sum');
select is((select sum(amount) from public.expenses where id between '72000000-0000-0000-0000-000000000021' and '72000000-0000-0000-0000-000000000024' and subtype = 'car_maintenance'),
  2274.06::numeric, 'the confirmed maintenance record has the expected classification and sum');
select ok(not exists (select 1 from merchant_before b full join public.expenses e using (id)
  where b.snapshot - array['category','subtype','updated_at'] is distinct from to_jsonb(e) - array['category','subtype','updated_at']),
  'every ID, owner, amount, date, description, note and other immutable field survives correction');
select ok(not exists (select 1 from merchant_before b join public.expenses e using (id)
  where e.id not between '72000000-0000-0000-0000-000000000021' and '72000000-0000-0000-0000-000000000024'
    and e.id not between '72000000-0000-0000-0000-000000000028' and '72000000-0000-0000-0000-000000000030'
  and b.snapshot is distinct from to_jsonb(e)), 'all unrelated/conflicting/already-correct rows are deeply unchanged');
create temporary table merchant_first_backup as select to_jsonb(b) as snapshot from expense_classification_private.expense_backups b;
select is(expense_classification_private.correct_historical_merchants(), 0, 'second correction changes zero records');
select results_eq($$ select to_jsonb(b) from expense_classification_private.expense_backups b order by expense_id $$,
  $$ select snapshot from merchant_first_backup order by snapshot ->> 'expense_id' $$, 'rerun preserves original and post-change backups');

-- Recovery must preserve a later edit and report deleted records as conflicts.
update public.expenses set amount = amount + 1 where id = '72000000-0000-0000-0000-000000000022';
delete from public.expenses where id = '72000000-0000-0000-0000-000000000024';
create temporary table merchant_pre_recovery as select id, to_jsonb(e) as snapshot from public.expenses e;
create temporary table merchant_recovery as select * from expense_classification_private.restore_historical_merchants();
select results_eq($$ select recovery_status from merchant_recovery order by expense_id $$,
  $$ values ('restored'::text), ('later_edit_conflict'), ('restored'), ('deleted_conflict'),
    ('restored'), ('restored'), ('restored') $$,
  'recovery restores safe rows and reports later edits and deletions');
select ok(not exists (select 1 from merchant_recovery r join public.expenses e on e.id = r.expense_id
  join merchant_before b on b.id = e.id where r.recovery_status = 'restored' and to_jsonb(e) is distinct from b.snapshot),
  'restoration bypasses merchant/timestamp triggers and exactly restores original rows');
select ok(not exists (select 1 from merchant_pre_recovery b join public.expenses e using (id)
  where e.id not in (select expense_id from merchant_recovery where recovery_status = 'restored')
  and b.snapshot is distinct from to_jsonb(e)), 'recovery deeply preserves every other current row and later edit');
select is((select count(*) from expense_classification_private.restore_historical_merchants() where recovery_status = 'already_restored'),
  5::bigint, 'recovery rerun recognizes restored rows without changes');
select is((select count(*) from pg_trigger where tgrelid = 'public.expenses'::regclass
  and tgname in ('expenses_classify_merchant', 'expenses_set_updated_at') and tgenabled = 'O'),
  2::bigint, 'recovery re-enables both triggers');
select is(expense_classification_private.correct_historical_merchants(), 5, 'reapplying after recovery corrects only restored rows');
select results_eq($$ select to_jsonb(b) from expense_classification_private.expense_backups b order by expense_id $$,
  $$ select snapshot from merchant_first_backup order by snapshot ->> 'expense_id' $$,
  'first backups remain immutable even after recovery and another correction');

select * from finish();
rollback;
