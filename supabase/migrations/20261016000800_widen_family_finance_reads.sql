begin;

-- Phase 1 (F43): family members may read each other's finance rows.
--
-- Who can read whose rows (family_private.can_view_finance_of):
-- * everyone reads their own rows, as before;
-- * a parent reads the rows of every member of their family;
-- * a kid reads the rows of every member of their family only when their
--   family_finance level is 'view'; otherwise only their own.
-- Users without a family, and members of another family, read nothing new.
--
-- Only the SELECT policies change. They keep their names, stay permissive and
-- stay "to authenticated". The insert, update and delete policies are left
-- exactly as they were, so every write stays owner-only: Postgres applies an
-- UPDATE or DELETE only to rows that also pass that command's own USING clause,
-- and an INSERT (including an upsert) only when its WITH CHECK passes, so a
-- wider read never becomes a wider write.
--
-- The app already filters every finance query by owner (R06-R09), so a wider
-- read never leaks into a user's own pages or MCP tools. get_expense_dashboard
-- (F42) is security invoker and filters on p_user_id, so it now returns a
-- family member's totals to a caller allowed to see them, which is intended.
--
-- Apply this to the live project only at release (F48), after R06-R09 are
-- deployed. See "Applying migrations" in docs/family-phase-1-tasks.md.

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------

-- Whether the caller may read the finance rows owned by `owner`. Security
-- definer (it reads family_members and member_permissions, which the caller
-- may not see in full) and stable. Built on F06's helpers:
-- * my_family_id(): the caller's family, null without one;
-- * member_level('family_finance'): 'edit' for parents (they pass every
--   check), the stored level or 'off' for kids, null without a family.
-- Levels are ordered off < view < edit, so "at least view" is view or edit.
-- Never null: a missing caller, a null owner or no family all give false.
create function family_private.can_view_finance_of(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    can_view_finance_of.owner = app_private.current_user_id()
    or (
      exists (
        select 1
        from public.family_members m
        where m.user_id = can_view_finance_of.owner
          and m.family_id = family_private.my_family_id()
      )
      and family_private.member_level('family_finance') in ('view', 'edit')
    ),
    false
  )
$$;

revoke all on function family_private.can_view_finance_of(uuid)
  from public, anon, authenticated, service_role;
-- Policies run their expressions as the querying role, so authenticated needs
-- execute. The family_private schema is not exposed through the API.
grant execute on function family_private.can_view_finance_of(uuid)
  to authenticated;

comment on function family_private.can_view_finance_of(uuid) is
  'Whether the caller may read finance rows owned by owner: their own, any family member''s for a parent, and any family member''s for a kid with family_finance at view.';

-- ---------------------------------------------------------------------------
-- Select policies
--
-- Each one checks the owner first with a cheap comparison against the caller,
-- run once per query as an InitPlan, so users without a family, and everyone
-- reading their own rows, never reach the helper. Only rows owned by someone
-- else call family_private.can_view_finance_of, once per row: a few indexed
-- lookups on family_members and member_permissions. That is acceptable at
-- family scale (a handful of members, and the app always filters by one owner),
-- but don't copy this pattern onto tables read in bulk across many owners.
--
-- Tables without user_id (investment_transactions, net_worth_valuations) check
-- through their owning account or item, as before.
-- ---------------------------------------------------------------------------

-- expenses (was: using ((select auth.uid()) = user_id))
drop policy "Users can read their own expenses" on public.expenses;
create policy "Users can read their own expenses"
on public.expenses for select to authenticated
using (
  user_id = (select app_private.current_user_id())
  or family_private.can_view_finance_of(user_id)
);

-- expense_tabs (was: using ((select auth.uid()) = user_id))
drop policy expense_tabs_select_own on public.expense_tabs;
create policy expense_tabs_select_own
on public.expense_tabs for select to authenticated
using (
  user_id = (select app_private.current_user_id())
  or family_private.can_view_finance_of(user_id)
);

-- investment_accounts (was: using ((select auth.uid()) = user_id))
drop policy investment_accounts_select_own on public.investment_accounts;
create policy investment_accounts_select_own
on public.investment_accounts for select to authenticated
using (
  user_id = (select app_private.current_user_id())
  or family_private.can_view_finance_of(user_id)
);

-- investment_transactions (was: the owning account's user_id = auth.uid()).
-- The sub-select on investment_accounts also runs under that table's select
-- policy; the explicit check keeps this policy correct on its own.
drop policy investment_transactions_select_own on public.investment_transactions;
create policy investment_transactions_select_own
on public.investment_transactions for select to authenticated
using (
  exists (
    select 1
    from public.investment_accounts as account
    where account.id = investment_transactions.investment_account_id
      and (
        account.user_id = (select app_private.current_user_id())
        or family_private.can_view_finance_of(account.user_id)
      )
  )
);

-- net_worth_items (was: using ((select auth.uid()) = user_id))
drop policy net_worth_items_select_own on public.net_worth_items;
create policy net_worth_items_select_own
on public.net_worth_items for select to authenticated
using (
  user_id = (select app_private.current_user_id())
  or family_private.can_view_finance_of(user_id)
);

-- net_worth_valuations (was: the owning item's user_id = auth.uid()).
-- As above, the sub-select on net_worth_items also runs under its own policy.
drop policy net_worth_valuations_select_own on public.net_worth_valuations;
create policy net_worth_valuations_select_own
on public.net_worth_valuations for select to authenticated
using (
  exists (
    select 1
    from public.net_worth_items as item
    where item.id = net_worth_valuations.item_id
      and (
        item.user_id = (select app_private.current_user_id())
        or family_private.can_view_finance_of(item.user_id)
      )
  )
);

commit;
