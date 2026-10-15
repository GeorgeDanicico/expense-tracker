begin;
create extension if not exists pgtap;
select plan(14);

-- Users: 01 and 02 each own expenses inside and outside the dashboard ranges.
insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f4200000-0000-4000-8000-000000000001', 'dashboard-one@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f4200000-0000-4000-8000-000000000002', 'dashboard-two@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

-- Ranges used below: current is October 2026, analytics is July to September 2026.
insert into public.expenses (id, user_id, description, amount, category, expense_date)
values
  ('f4200000-0000-4000-8000-000000000101', 'f4200000-0000-4000-8000-000000000001', 'Dashboard fixture', 12.50, 'car', '2026-10-04'),
  ('f4200000-0000-4000-8000-000000000102', 'f4200000-0000-4000-8000-000000000001', 'Dashboard fixture', 30, 'transport', '2026-10-20'),
  ('f4200000-0000-4000-8000-000000000103', 'f4200000-0000-4000-8000-000000000001', 'Dashboard fixture', 20, 'car', '2026-07-15'),
  ('f4200000-0000-4000-8000-000000000104', 'f4200000-0000-4000-8000-000000000001', 'Dashboard fixture', 10, 'car', '2026-08-10'),
  ('f4200000-0000-4000-8000-000000000105', 'f4200000-0000-4000-8000-000000000001', 'Dashboard fixture', 7.25, 'transport', '2026-09-05'),
  ('f4200000-0000-4000-8000-000000000106', 'f4200000-0000-4000-8000-000000000001', 'Dashboard fixture', 4, 'car', '2026-09-20'),
  ('f4200000-0000-4000-8000-000000000107', 'f4200000-0000-4000-8000-000000000001', 'Dashboard fixture', 99, 'car', '2026-06-30'),
  ('f4200000-0000-4000-8000-000000000108', 'f4200000-0000-4000-8000-000000000001', 'Dashboard fixture', 99, 'car', '2026-11-01'),
  ('f4200000-0000-4000-8000-000000000201', 'f4200000-0000-4000-8000-000000000002', 'Dashboard fixture', 100, 'transport', '2026-10-02'),
  ('f4200000-0000-4000-8000-000000000202', 'f4200000-0000-4000-8000-000000000002', 'Dashboard fixture', 50, 'car', '2026-08-01');

-- Structure
select has_function('public', 'get_expense_dashboard', array['date', 'date', 'date', 'date', 'uuid'],
  'get_expense_dashboard takes a final user argument');
select hasnt_function('public', 'get_expense_dashboard', array['date', 'date', 'date', 'date'],
  'the old four-argument overload is gone, so four-argument calls are not ambiguous');
select ok(
  not (select prosecdef from pg_catalog.pg_proc
       where oid = 'public.get_expense_dashboard(date, date, date, date, uuid)'::regprocedure),
  'get_expense_dashboard stays security invoker'
);
select is(
  (select proconfig from pg_catalog.pg_proc
   where oid = 'public.get_expense_dashboard(date, date, date, date, uuid)'::regprocedure),
  array['search_path=""'],
  'get_expense_dashboard pins an empty search_path'
);
select ok(
  pg_catalog.pg_get_function_arguments('public.get_expense_dashboard(date, date, date, date, uuid)'::regprocedure)
    like '%p_user_id uuid DEFAULT app_private.current_user_id()',
  'p_user_id defaults to the caller'
);
select ok(
  not has_function_privilege('anon', 'public.get_expense_dashboard(date, date, date, date, uuid)', 'execute'),
  'anon cannot execute get_expense_dashboard'
);
select ok(
  has_function_privilege('authenticated', 'public.get_expense_dashboard(date, date, date, date, uuid)', 'execute'),
  'authenticated can execute get_expense_dashboard'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f4200000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.get_expense_dashboard('2026-10-01', '2026-11-01', '2026-07-01', '2026-10-01'),
  '{"currentTotal": 42.50, "currentCount": 2, "currentLargest": 30,
    "analyticsTotal": 41.25, "analyticsCount": 4,
    "categoryTotals": [{"category": "car", "total": 34}, {"category": "transport", "total": 7.25}],
    "monthlyTotals": [{"key": "2026-07", "total": 20}, {"key": "2026-08", "total": 10}, {"key": "2026-09", "total": 11.25}]}'::jsonb,
  'without p_user_id the caller gets their own aggregates, as before'
);
select is(
  public.get_expense_dashboard('2026-10-01', '2026-11-01', '2026-07-01', '2026-10-01',
    'f4200000-0000-4000-8000-000000000001'),
  public.get_expense_dashboard('2026-10-01', '2026-11-01', '2026-07-01', '2026-10-01'),
  'passing the caller''s own id gives the same result as the default'
);
select is(
  public.get_expense_dashboard(
    p_current_start => '2026-10-01', p_current_end_exclusive => '2026-11-01',
    p_analytics_start => '2026-07-01', p_analytics_end_exclusive => '2026-10-01',
    p_user_id => 'f4200000-0000-4000-8000-000000000001'),
  public.get_expense_dashboard('2026-10-01', '2026-11-01', '2026-07-01', '2026-10-01'),
  'named arguments, as PostgREST sends them, give the same result'
);
select is(
  public.get_expense_dashboard('2026-10-01', '2026-11-01', '2026-07-01', '2026-10-01',
    'f4200000-0000-4000-8000-000000000002'),
  '{"currentTotal": 0, "currentCount": 0, "currentLargest": 0, "analyticsTotal": 0, "analyticsCount": 0,
    "categoryTotals": [], "monthlyTotals": []}'::jsonb,
  'another user''s id returns nothing under owner-only RLS'
);
select is(
  public.get_expense_dashboard('2026-10-01', '2026-11-01', '2026-07-01', '2026-10-01', null),
  '{"currentTotal": 0, "currentCount": 0, "currentLargest": 0, "analyticsTotal": 0, "analyticsCount": 0,
    "categoryTotals": [], "monthlyTotals": []}'::jsonb,
  'an explicit null user returns nothing'
);

select set_config('request.jwt.claims', '{"sub":"f4200000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(
  public.get_expense_dashboard('2026-10-01', '2026-11-01', '2026-07-01', '2026-10-01'),
  '{"currentTotal": 100, "currentCount": 1, "currentLargest": 100,
    "analyticsTotal": 50, "analyticsCount": 1,
    "categoryTotals": [{"category": "car", "total": 50}],
    "monthlyTotals": [{"key": "2026-08", "total": 50}]}'::jsonb,
  'the default follows a change of caller'
);
select is(
  public.get_expense_dashboard('2026-10-01', '2026-11-01', '2026-07-01', '2026-10-01',
    'f4200000-0000-4000-8000-000000000001'),
  '{"currentTotal": 0, "currentCount": 0, "currentLargest": 0, "analyticsTotal": 0, "analyticsCount": 0,
    "categoryTotals": [], "monthlyTotals": []}'::jsonb,
  'the other user cannot read the first user''s aggregates either'
);

select * from finish();
rollback;
