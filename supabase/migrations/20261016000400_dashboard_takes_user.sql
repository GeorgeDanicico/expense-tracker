begin;

-- F42: the dashboard function takes the user whose expenses it summarises, so
-- family views (F44, F46) can ask for another member. It stays SECURITY INVOKER:
-- RLS still decides which rows are visible, so under today's owner-only policies
-- another user's id returns empty aggregates. The default is the caller, so
-- calls without p_user_id behave exactly as before.
--
-- The argument list changes, so the old four-argument signature is dropped
-- explicitly; otherwise both overloads would exist and four-argument calls would
-- be ambiguous.
drop function if exists public.get_expense_dashboard(date, date, date, date);

create function public.get_expense_dashboard(
  p_current_start date,
  p_current_end_exclusive date,
  p_analytics_start date,
  p_analytics_end_exclusive date,
  p_user_id uuid default app_private.current_user_id()
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
    where user_id = (select p_user_id)
      and expense_date >= p_current_start
      and expense_date < p_current_end_exclusive
  ),
  analytics_rows as materialized (
    select amount, category, expense_date
    from public.expenses
    where user_id = (select p_user_id)
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

comment on function public.get_expense_dashboard(date, date, date, date, uuid) is
  'Returns current and historical expense aggregates for p_user_id (default: the caller), limited to the rows RLS lets the caller read.';

revoke all on function public.get_expense_dashboard(date, date, date, date, uuid)
  from public, anon;
grant execute on function public.get_expense_dashboard(date, date, date, date, uuid)
  to authenticated;

commit;
