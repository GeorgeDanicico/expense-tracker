begin;

create table public.investment_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  broker_id text not null,
  constraint investment_accounts_broker_id_valid
    check (broker_id in ('xtb', 'banca_transilvania')),
  constraint investment_accounts_user_broker_key
    unique (user_id, broker_id)
);

comment on table public.investment_accounts is
  'One user-owned logical investment account per supported broker.';
comment on column public.investment_accounts.broker_id is
  'Stable broker identifier: xtb or banca_transilvania.';

create table public.investment_transactions (
  id uuid primary key default gen_random_uuid(),
  investment_account_id uuid not null
    references public.investment_accounts (id) on delete cascade,
  instrument text not null,
  currency text not null,
  side text not null,
  amount numeric(28, 10) not null,
  quantity numeric(28, 10) not null,
  unit_price numeric(28, 10) not null,
  executed_at timestamptz not null,
  constraint investment_transactions_instrument_valid
    check (char_length(btrim(instrument)) between 1 and 80
      and instrument = btrim(instrument)
      and instrument = upper(instrument)),
  constraint investment_transactions_currency_valid
    check (currency ~ '^[A-Z]{3}$'),
  constraint investment_transactions_side_valid
    check (side in ('buy', 'sell')),
  constraint investment_transactions_amount_positive
    check (amount > 0),
  constraint investment_transactions_quantity_positive
    check (quantity > 0),
  constraint investment_transactions_unit_price_positive
    check (unit_price > 0)
);

comment on table public.investment_transactions is
  'Executed investment buys and sells. Values are in the instrument currency.';
comment on column public.investment_transactions.instrument is
  'Stable uppercase instrument and listing code, for example VWCE.DE.';
comment on column public.investment_transactions.currency is
  'Uppercase three-letter quoted currency for amount, quantity price and quotes.';
comment on column public.investment_transactions.amount is
  'Positive total order value in currency; it is not a settlement-currency amount.';

create index investment_transactions_grouping_idx
  on public.investment_transactions
    (investment_account_id, instrument, currency, executed_at, id);

alter table public.investment_accounts enable row level security;
alter table public.investment_transactions enable row level security;

revoke all on table public.investment_accounts from public, anon, authenticated;
revoke all on table public.investment_transactions from public, anon, authenticated;
grant select, insert, delete on table public.investment_accounts to authenticated;
grant select, insert, delete on table public.investment_transactions to authenticated;

drop policy if exists investment_accounts_select_own on public.investment_accounts;
drop policy if exists investment_accounts_insert_own on public.investment_accounts;
drop policy if exists investment_accounts_delete_own on public.investment_accounts;

create policy investment_accounts_select_own
on public.investment_accounts for select to authenticated
using ((select auth.uid()) = user_id);

create policy investment_accounts_insert_own
on public.investment_accounts for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy investment_accounts_delete_own
on public.investment_accounts for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists investment_transactions_select_own on public.investment_transactions;
drop policy if exists investment_transactions_insert_own on public.investment_transactions;
drop policy if exists investment_transactions_delete_own on public.investment_transactions;

create policy investment_transactions_select_own
on public.investment_transactions for select to authenticated
using (
  exists (
    select 1
    from public.investment_accounts as account
    where account.id = investment_transactions.investment_account_id
      and account.user_id = (select auth.uid())
  )
);

create policy investment_transactions_insert_own
on public.investment_transactions for insert to authenticated
with check (
  exists (
    select 1
    from public.investment_accounts as account
    where account.id = investment_transactions.investment_account_id
      and account.user_id = (select auth.uid())
  )
);

create policy investment_transactions_delete_own
on public.investment_transactions for delete to authenticated
using (
  exists (
    select 1
    from public.investment_accounts as account
    where account.id = investment_transactions.investment_account_id
      and account.user_id = (select auth.uid())
  )
);

commit;
