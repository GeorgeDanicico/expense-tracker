begin;

-- S10 (docs/security-plan.md, "Races"): audit P6 and B6. Three writes that read, checked in the
-- app and then wrote, so two requests at the same moment could both pass the same check. Each now
-- runs as one SQL function that takes a lock and checks inside the transaction, as imports, invites
-- and to-do moves already do.
--
-- 1. Investment orders (B6). record_investment_order() and delete_investment_order() lock the
--    investment account row (for update), write, then re-read the asset's orders and refuse (23514)
--    when a sale would be larger than the position at that point. Two sells of a whole position at
--    once: the second waits for the first, then sees it and is refused. The app no longer reads the
--    history first.
--
-- 2. The AI budget. ai_reserve_budget() checks the kill switch, the opt-in and both monthly budgets
--    in one call (audit P9 had four), and when the call fits, writes its worst-case cost to the
--    ledger as a 'reserved' row before the model is called. It checks the budgets under a lock on
--    the family's month and one on everyone's month, so a parallel reservation waits and then counts
--    this one. ai_settle_usage() turns the reservation into the call's real tokens, cost and
--    outcome afterwards (a call that never happened is settled at zero). ai_family_spend() and
--    ai_global_spend() count reserved rows at their worst case without any change.
--
-- 3. Expense edits. update_expense() writes only the fields in the patch, in one update ... returning,
--    so two edits to different fields of one expense both stick: the second waits for the first's
--    row lock and then updates the row as the first left it. It applies the subtype rule the app
--    applied after its read (a new category drops a subtype that doesn't belong to it).
--
-- Same conventions as before: the caller is app_private.current_user_id(), set search_path = '',
-- fully qualified names, and every raise marked for users (hint = 'user', see S9). No table data is
-- changed; ai_usage gets a new outcome value ('reserved') that only new rows use.

-- ---------------------------------------------------------------------------
-- 1. Investment orders
-- ---------------------------------------------------------------------------

-- Saves an order in one of the caller's investment accounts. Locks the account row first, so orders
-- for the same account are saved one at a time; then inserts the order and walks the asset's orders
-- (this account, instrument and currency) by executed_at, then id, the order the app calculates in,
-- and refuses (23514) when a sale is larger than the quantity held just before it. The insert is
-- rolled back with the refusal.
--
-- Security definer because taking the row lock (select ... for update) needs the update privilege
-- and an update policy on investment_accounts, which the API roles don't have and shouldn't get: an
-- account never changes. So the ownership check is explicit here, not left to RLS. The order's
-- values are checked by the table's constraints.
create function public.record_investment_order(
  p_id uuid,
  p_account_id uuid,
  p_instrument text,
  p_currency text,
  p_side text,
  p_amount numeric,
  p_quantity numeric,
  p_unit_price numeric,
  p_executed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
begin
  if caller_id is null then
    raise exception 'Sign in to record an investment order.'
      using errcode = '42501', hint = 'user';
  end if;

  perform 1
  from public.investment_accounts a
  where a.id = p_account_id
    and a.user_id = caller_id
  for update;

  if not found then
    raise exception 'That investment account wasn''t found.'
      using errcode = 'P0002', hint = 'user';
  end if;

  insert into public.investment_transactions (
    id, investment_account_id, instrument, currency, side, amount, quantity, unit_price, executed_at
  ) values (
    p_id, p_account_id, p_instrument, p_currency, p_side, p_amount, p_quantity, p_unit_price, p_executed_at
  );

  if exists (
    select 1
    from (
      select sum(case when t.side = 'buy' then t.quantity else -t.quantity end) over (
        order by t.executed_at, t.id
        rows between unbounded preceding and current row
      ) as held
      from public.investment_transactions t
      where t.investment_account_id = p_account_id
        and t.instrument = p_instrument
        and t.currency = p_currency
    ) running
    where running.held < 0
  ) then
    raise exception 'Sell quantity exceeds the available % position.', p_instrument
      using errcode = '23514', hint = 'user';
  end if;
end;
$$;

revoke all on function public.record_investment_order(uuid, uuid, text, text, text, numeric, numeric, numeric, timestamptz) from public, anon;
grant execute on function public.record_investment_order(uuid, uuid, text, text, text, numeric, numeric, numeric, timestamptz) to authenticated;

comment on function public.record_investment_order(uuid, uuid, text, text, text, numeric, numeric, numeric, timestamptz) is
  'Saves an order in one of the caller''s investment accounts under a lock on the account row, refusing (23514) a sale larger than the position. 42501 without a user, P0002 for an account that isn''t the caller''s, 23505 for an id in use, 23514 for a bad value.';

-- Deletes one of the caller's orders. Locks its account row, deletes the order, then walks what is
-- left of the asset's orders as record_investment_order does, refusing (23514) when a later sale
-- would then be larger than the position. False when the caller has no such order, including one a
-- parallel request deleted while this one waited for the lock. Security definer for the lock, as
-- above.
create function public.delete_investment_order(p_transaction_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  target_account uuid;
  removed public.investment_transactions;
begin
  if caller_id is null then
    raise exception 'Sign in to remove an investment order.'
      using errcode = '42501', hint = 'user';
  end if;

  select a.id into target_account
  from public.investment_transactions t
  join public.investment_accounts a on a.id = t.investment_account_id
  where t.id = p_transaction_id
    and a.user_id = caller_id;

  if not found then
    return false;
  end if;

  perform 1
  from public.investment_accounts a
  where a.id = target_account
  for update;

  delete from public.investment_transactions t
  where t.id = p_transaction_id
    and t.investment_account_id = target_account
  returning * into removed;

  if not found then
    return false;
  end if;

  if exists (
    select 1
    from (
      select sum(case when t.side = 'buy' then t.quantity else -t.quantity end) over (
        order by t.executed_at, t.id
        rows between unbounded preceding and current row
      ) as held
      from public.investment_transactions t
      where t.investment_account_id = removed.investment_account_id
        and t.instrument = removed.instrument
        and t.currency = removed.currency
    ) running
    where running.held < 0
  ) then
    raise exception 'This order cannot be removed because it would invalidate the later history: Sell quantity exceeds the available % position.', removed.instrument
      using errcode = '23514', hint = 'user';
  end if;

  return true;
end;
$$;

revoke all on function public.delete_investment_order(uuid) from public, anon;
grant execute on function public.delete_investment_order(uuid) to authenticated;

comment on function public.delete_investment_order(uuid) is
  'Deletes one of the caller''s orders under a lock on its account row, refusing (23514) a removal that leaves a later sale larger than the position. False when the caller has no such order. 42501 without a user.';

-- ---------------------------------------------------------------------------
-- 2. The AI budget
-- ---------------------------------------------------------------------------

comment on table public.ai_usage is
  'The AI ledger: one row per model call, failed and refused ones included. The server reserves a call''s worst case (outcome reserved) before the call with ai_reserve_budget() and settles it to the real cost after with ai_settle_usage(), the only update a row ever gets. Owners read their own rows; nobody deletes them.';
comment on column public.ai_usage.cost_micros is
  'The call''s cost in millionths of a dollar, priced from the pricing table when it was made; its worst case while the row is reserved.';
comment on column public.ai_usage.outcome is
  'reserved while the call is under way; then ok, or why the call failed: max_tokens, refusal, invalid_output, timeout, rate_limited, provider_error.';

-- The gate's check and reservation, in one call (audit P9). For the server's secret key only: the
-- gate checks that p_user_id is the signed-in caller before calling it, and the limits come from the
-- server's environment. Returns one row:
--   status: ok, flag_off (the kill switch is off), not_permitted (a kid whose ai permission is
--     off), ai_off (the user's switch is off), family_budget or global_budget (no room for
--     p_estimated_micros: the spend has reached the limit, or the estimate would cross it);
--   reservation_id: the new 'reserved' ledger row, only for ok;
--   family_spent_micros and global_spent_micros: the month's spend before this call, null when the
--     check stopped before reading it.
--
-- The family's month is that of the user's family now (the user's own rows made without one when
-- they have none), the same rows ai_family_spend() counts. Both budget checks read sums that a
-- parallel reservation changes, so each is made under a transaction-level advisory lock: the
-- family's (or the user's, without one), then everyone's, always in that order. The locks are held
-- only until this function's transaction ends, not during the model call.
--
-- Security definer: service_role has no update on the ledger, reads the opt-in and the kid
-- permission through ai_private, and shouldn't need more.
create function public.ai_reserve_budget(
  p_user_id uuid,
  p_feature text,
  p_provider text,
  p_model text,
  p_estimated_micros bigint,
  p_month_start timestamptz,
  p_family_limit_micros bigint,
  p_global_limit_micros bigint
)
returns table (
  status text,
  reservation_id uuid,
  family_spent_micros bigint,
  global_spent_micros bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_family uuid;
  family_spent bigint;
  global_spent bigint;
  new_id uuid;
begin
  if p_user_id is null then
    raise exception 'An AI call needs a user.'
      using errcode = '22023', hint = 'user';
  end if;

  if p_month_start is null then
    raise exception 'A month start is needed.'
      using errcode = '22023', hint = 'user';
  end if;

  if p_estimated_micros is null or p_estimated_micros < 0
    or p_family_limit_micros is null or p_family_limit_micros < 0
    or p_global_limit_micros is null or p_global_limit_micros < 0
  then
    raise exception 'The estimate and the limits must be zero or more.'
      using errcode = '22023', hint = 'user';
  end if;

  -- A missing or odd flag counts as off.
  if not coalesce((
    select f.value = 'true'::jsonb from public.app_flags f where f.key = 'ai_enabled'
  ), false) then
    return query select 'flag_off'::text, null::uuid, null::bigint, null::bigint;
    return;
  end if;

  if not ai_private.kid_ai_permitted(p_user_id) then
    return query select 'not_permitted'::text, null::uuid, null::bigint, null::bigint;
    return;
  end if;

  if not coalesce((select p.ai_enabled from public.profiles p where p.id = p_user_id), false) then
    return query select 'ai_off'::text, null::uuid, null::bigint, null::bigint;
    return;
  end if;

  select m.family_id into user_family
  from public.family_members m
  where m.user_id = p_user_id;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai_budget:' || coalesce('family:' || user_family::text, 'user:' || p_user_id::text), 0));

  -- Read after the lock: a reservation that held it is committed and counted.
  select coalesce(sum(u.cost_micros), 0)::bigint into family_spent
  from public.ai_usage u
  where u.created_at >= p_month_start
    and case
      when user_family is not null then u.family_id = user_family
      else u.user_id = p_user_id and u.family_id is null
    end;

  if family_spent >= p_family_limit_micros or family_spent + p_estimated_micros > p_family_limit_micros then
    return query select 'family_budget'::text, null::uuid, family_spent, null::bigint;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai_budget:global', 0));

  select coalesce(sum(u.cost_micros), 0)::bigint into global_spent
  from public.ai_usage u
  where u.created_at >= p_month_start;

  if global_spent >= p_global_limit_micros or global_spent + p_estimated_micros > p_global_limit_micros then
    return query select 'global_budget'::text, null::uuid, family_spent, global_spent;
    return;
  end if;

  insert into public.ai_usage (user_id, family_id, feature, provider, model, cost_micros, outcome)
  values (p_user_id, user_family, p_feature, p_provider, p_model, p_estimated_micros, 'reserved')
  returning id into new_id;

  return query select 'ok'::text, new_id, family_spent, global_spent;
end;
$$;

revoke all on function public.ai_reserve_budget(uuid, text, text, text, bigint, timestamptz, bigint, bigint) from public, anon, authenticated;
grant execute on function public.ai_reserve_budget(uuid, text, text, text, bigint, timestamptz, bigint, bigint) to service_role;

comment on function public.ai_reserve_budget(uuid, text, text, text, bigint, timestamptz, bigint, bigint) is
  'The AI gate in one call: the kill switch, the opt-in and both monthly budgets, checked under locks on the family''s month and everyone''s; when the call fits, reserves its worst case in the ledger. Returns the status, the reservation id (ok only) and the spends read. service_role only. 22023 for a missing user or month start, or a negative estimate or limit.';

-- Settles a reservation: the call's real tokens, cost and outcome replace the worst case. A call
-- that was never made (the provider threw) is settled at zero with outcome provider_error by the
-- gate. Returns the month's spend afterwards, the family's (the family the row was reserved in, or
-- the user's own rows without one) and everyone's, for the budget warnings. P0002 when the user has
-- no such reservation or it was already settled. service_role only, security definer for the
-- update, as above.
create function public.ai_settle_usage(
  p_reservation_id uuid,
  p_user_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cached_input_tokens integer,
  p_cost_micros bigint,
  p_outcome text,
  p_month_start timestamptz
)
returns table (
  family_spent_micros bigint,
  global_spent_micros bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  settled_family uuid;
begin
  if p_month_start is null then
    raise exception 'A month start is needed.'
      using errcode = '22023', hint = 'user';
  end if;

  if p_outcome is null or p_outcome = 'reserved' then
    raise exception 'A settled AI call needs its outcome.'
      using errcode = '22023', hint = 'user';
  end if;

  update public.ai_usage u
  set input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      cached_input_tokens = p_cached_input_tokens,
      cost_micros = p_cost_micros,
      outcome = p_outcome
  where u.id = p_reservation_id
    and u.user_id = p_user_id
    and u.outcome = 'reserved'
  returning u.family_id into settled_family;

  if not found then
    raise exception 'That AI reservation wasn''t found or was already settled.'
      using errcode = 'P0002', hint = 'user';
  end if;

  return query
  select
    (
      select coalesce(sum(u.cost_micros), 0)::bigint
      from public.ai_usage u
      where u.created_at >= p_month_start
        and case
          when settled_family is not null then u.family_id = settled_family
          else u.user_id = p_user_id and u.family_id is null
        end
    ),
    (
      select coalesce(sum(u.cost_micros), 0)::bigint
      from public.ai_usage u
      where u.created_at >= p_month_start
    );
end;
$$;

revoke all on function public.ai_settle_usage(uuid, uuid, integer, integer, integer, bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_settle_usage(uuid, uuid, integer, integer, integer, bigint, text, timestamptz) to service_role;

comment on function public.ai_settle_usage(uuid, uuid, integer, integer, integer, bigint, text, timestamptz) is
  'Replaces a reserved ledger row''s worst case with the call''s real tokens, cost and outcome, and returns the family''s and everyone''s spend since p_month_start. service_role only. P0002 for a reservation the user doesn''t have or that was settled, 22023 for a missing outcome or month start.';

-- ---------------------------------------------------------------------------
-- 3. Expense edits
-- ---------------------------------------------------------------------------

-- Changes the fields of one of the caller's expenses that p_patch names, and returns the expense as
-- stored (after the merchant trigger), or no row when the caller has no such expense. p_patch is an
-- object with any of description, amount, category, subtype, expense_date and notes; a field it
-- doesn't name keeps the value the row has when the update runs. One update ... returning: a
-- parallel edit holding the row's lock is waited for, and then this one applies to the row as that
-- edit left it.
--
-- A new category without a subtype in the patch drops the stored subtype when it doesn't belong to
-- the category. Every subtype belongs to one category, and the expenses_subtype_valid check keeps a
-- stored subtype in its category, so the subtype belongs exactly when the category is unchanged. A
-- subtype that doesn't belong to the expense's category is refused (23514) with a message for the
-- user. The app checks each field before calling; the table's constraints stay the backstop.
--
-- Security invoker: RLS applies, as for the update it replaces.
create function public.update_expense(p_id uuid, p_patch jsonb)
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
  failed_constraint text;
begin
  if caller_id is null then
    raise exception 'Sign in to change an expense.'
      using errcode = '42501', hint = 'user';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'An expense change must be an object.'
      using errcode = '22023', hint = 'user';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_patch) k(key)
    where k.key not in ('description', 'amount', 'category', 'subtype', 'expense_date', 'notes')
  ) then
    raise exception 'An expense change can only set the description, amount, category, subtype, date and notes.'
      using errcode = '22023', hint = 'user';
  end if;

  begin
    return query
    update public.expenses e
    set description = case when p_patch ? 'description' then p_patch ->> 'description' else e.description end,
        amount = case when p_patch ? 'amount' then (p_patch ->> 'amount')::numeric else e.amount end,
        category = case when p_patch ? 'category' then p_patch ->> 'category' else e.category end,
        subtype = case
          when p_patch ? 'subtype' then p_patch ->> 'subtype'
          when p_patch ? 'category' and (p_patch ->> 'category') is distinct from e.category then null
          else e.subtype
        end,
        expense_date = case when p_patch ? 'expense_date' then (p_patch ->> 'expense_date')::date else e.expense_date end,
        notes = case when p_patch ? 'notes' then nullif(p_patch ->> 'notes', '') else e.notes end
    where e.id = p_id
      and e.user_id = caller_id
    returning e.id, e.description, e.amount, e.category, e.subtype, e.expense_date, e.notes;
  exception when check_violation then
    get stacked diagnostics failed_constraint = constraint_name;
    if failed_constraint = 'expenses_subtype_valid' then
      raise exception 'Choose a subtype belonging to the selected category.'
        using errcode = '23514', hint = 'user';
    end if;
    raise;
  end;
end;
$$;

revoke all on function public.update_expense(uuid, jsonb) from public, anon;
grant execute on function public.update_expense(uuid, jsonb) to authenticated;

comment on function public.update_expense(uuid, jsonb) is
  'Changes only the fields p_patch names on one of the caller''s expenses, in one update ... returning, as the caller (RLS applies); a new category drops a subtype that doesn''t belong. Returns the stored expense, or no row. 42501 without a user, 22023 for a bad patch, 23514 for a subtype outside the category (marked for users) or another bad value.';

commit;
