begin;

create table public.net_worth_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null,
  category text not null,
  currency text not null,
  purchase_amount numeric(28, 10),
  archived_at timestamptz,
  constraint net_worth_items_name_valid
    check (char_length(btrim(name)) between 1 and 120 and name = btrim(name)),
  constraint net_worth_items_kind_valid
    check (kind in ('asset', 'liability')),
  constraint net_worth_items_category_valid
    check (
      char_length(btrim(category)) between 1 and 40
      and category = btrim(category)
      and category = lower(category)
      and category ~ '^[a-z0-9]+([-_][a-z0-9]+)*$'
    ),
  constraint net_worth_items_currency_valid
    check (currency ~ '^[A-Z]{3}$'),
  constraint net_worth_items_purchase_amount_valid
    check (purchase_amount is null or purchase_amount >= 0),
  constraint net_worth_items_purchase_amount_kind_valid
    check ((kind = 'asset' and category <> 'cash') or purchase_amount is null)
);

comment on table public.net_worth_items is
  'User-owned manual assets and liabilities used in native-currency net-worth totals.';
comment on column public.net_worth_items.purchase_amount is
  'Optional comparison baseline for non-cash assets; it is not a tax-grade cost basis.';

create table public.net_worth_valuations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.net_worth_items (id) on delete cascade,
  value numeric(28, 10) not null,
  valued_on date not null,
  constraint net_worth_valuations_value_valid
    check (value >= 0),
  constraint net_worth_valuations_item_date_key
    unique (item_id, valued_on)
);

comment on table public.net_worth_valuations is
  'Dated manual observations for a net-worth item. One correction is allowed per item and date.';

create index net_worth_items_user_active_currency_idx
  on public.net_worth_items (user_id, archived_at, currency, category);

create index net_worth_valuations_item_valued_on_idx
  on public.net_worth_valuations (item_id, valued_on desc, id desc);

alter table public.net_worth_items enable row level security;
alter table public.net_worth_valuations enable row level security;

revoke all on table public.net_worth_items from public, anon, authenticated;
revoke all on table public.net_worth_valuations from public, anon, authenticated;
grant select, insert, update on table public.net_worth_items to authenticated;
grant select, insert, update on table public.net_worth_valuations to authenticated;

drop policy if exists net_worth_items_select_own on public.net_worth_items;
drop policy if exists net_worth_items_insert_own on public.net_worth_items;
drop policy if exists net_worth_items_update_own on public.net_worth_items;

create policy net_worth_items_select_own
on public.net_worth_items for select to authenticated
using ((select auth.uid()) = user_id);

create policy net_worth_items_insert_own
on public.net_worth_items for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy net_worth_items_update_own
on public.net_worth_items for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists net_worth_valuations_select_own on public.net_worth_valuations;
drop policy if exists net_worth_valuations_insert_own on public.net_worth_valuations;
drop policy if exists net_worth_valuations_update_own on public.net_worth_valuations;

create policy net_worth_valuations_select_own
on public.net_worth_valuations for select to authenticated
using (
  exists (
    select 1
    from public.net_worth_items as item
    where item.id = net_worth_valuations.item_id
      and item.user_id = (select auth.uid())
  )
);

create policy net_worth_valuations_insert_own
on public.net_worth_valuations for insert to authenticated
with check (
  exists (
    select 1
    from public.net_worth_items as item
    where item.id = net_worth_valuations.item_id
      and item.user_id = (select auth.uid())
  )
);

create policy net_worth_valuations_update_own
on public.net_worth_valuations for update to authenticated
using (
  exists (
    select 1
    from public.net_worth_items as item
    where item.id = net_worth_valuations.item_id
      and item.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.net_worth_items as item
    where item.id = net_worth_valuations.item_id
      and item.user_id = (select auth.uid())
  )
);

create or replace function public.create_net_worth_item_with_valuation(
  p_name text,
  p_kind text,
  p_category text,
  p_currency text,
  p_purchase_amount numeric,
  p_value numeric,
  p_valued_on date
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  item_id uuid;
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  insert into public.net_worth_items (
    user_id,
    name,
    kind,
    category,
    currency,
    purchase_amount
  )
  values (
    current_user_id,
    p_name,
    p_kind,
    p_category,
    p_currency,
    p_purchase_amount
  )
  returning id into item_id;

  insert into public.net_worth_valuations (item_id, value, valued_on)
  values (item_id, p_value, p_valued_on);

  return item_id;
end;
$$;

revoke all on function public.create_net_worth_item_with_valuation(
  text, text, text, text, numeric, numeric, date
) from public, anon, authenticated;
grant execute on function public.create_net_worth_item_with_valuation(
  text, text, text, text, numeric, numeric, date
) to authenticated;

commit;
