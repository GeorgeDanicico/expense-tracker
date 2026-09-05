begin;

-- Match the monthly ledger's filter and complete sort order. This replaces the
-- earlier two-column index and prevents a secondary sort on created_at.
drop index if exists public.expenses_user_date_idx;
create index if not exists expenses_user_date_created_idx
  on public.expenses (user_id, expense_date desc, created_at desc);

-- Aggregate dashboard metrics beside the data instead of transferring every
-- historical expense to the application server. SECURITY INVOKER preserves RLS.
create or replace function public.get_expense_dashboard(
  p_current_start date,
  p_current_end_exclusive date,
  p_analytics_start date,
  p_analytics_end_exclusive date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with current_rows as materialized (
    select amount
    from public.expenses
    where user_id = (select auth.uid())
      and expense_date >= p_current_start
      and expense_date < p_current_end_exclusive
  ),
  analytics_rows as materialized (
    select amount, category, expense_date
    from public.expenses
    where user_id = (select auth.uid())
      and expense_date >= p_analytics_start
      and expense_date < p_analytics_end_exclusive
  ),
  current_summary as (
    select
      coalesce(sum(amount), 0) as total,
      count(*) as transaction_count,
      coalesce(max(amount), 0) as largest
    from current_rows
  ),
  analytics_summary as (
    select coalesce(sum(amount), 0) as total, count(*) as transaction_count
    from analytics_rows
  ),
  analytics_categories as (
    select category, sum(amount) as total
    from analytics_rows
    group by category
  ),
  analytics_months as (
    select to_char(expense_date, 'YYYY-MM') as month_key,
           sum(amount) as total
    from analytics_rows
    group by to_char(expense_date, 'YYYY-MM')
  )
  select jsonb_build_object(
    'currentTotal', current_summary.total,
    'currentCount', current_summary.transaction_count,
    'currentLargest', current_summary.largest,
    'analyticsTotal', analytics_summary.total,
    'analyticsCount', analytics_summary.transaction_count,
    'categoryTotals', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('category', category, 'total', total)
          order by total desc
        )
        from analytics_categories
      ),
      '[]'::jsonb
    ),
    'monthlyTotals', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('key', month_key, 'total', total)
          order by month_key
        )
        from analytics_months
      ),
      '[]'::jsonb
    )
  )
  from current_summary cross join analytics_summary;
$$;

comment on function public.get_expense_dashboard(date, date, date, date) is
  'Returns owner-scoped current and historical expense aggregates for the dashboard.';

revoke all on function public.get_expense_dashboard(date, date, date, date)
  from public, anon;
grant execute on function public.get_expense_dashboard(date, date, date, date)
  to authenticated;

commit;
