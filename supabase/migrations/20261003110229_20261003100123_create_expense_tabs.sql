begin;

create table public.expense_tabs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  category_keys text[] not null default '{}',
  subtype_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_tabs_name_valid check (
    name = btrim(name) and char_length(name) between 1 and 80
  ),
  constraint expense_tabs_categories_valid check (
    category_keys <@ array[
      'housing', 'groceries', 'transport', 'car', 'utilities', 'health',
      'entertainment', 'shopping', 'education', 'travel', 'other'
    ]::text[]
    and coalesce(array_ndims(category_keys), 1) = 1
    and array_position(category_keys, null) is null
  ),
  constraint expense_tabs_subtypes_valid check (
    subtype_keys <@ array['car_maintenance', 'car_fuel', 'car_repairs']::text[]
    and coalesce(array_ndims(subtype_keys), 1) = 1
    and array_position(subtype_keys, null) is null
  ),
  constraint expense_tabs_selection_required check (
    cardinality(category_keys) + cardinality(subtype_keys) > 0
  )
);

comment on table public.expense_tabs is
  'Owner-scoped saved expense selections. Parent category or individual subtype membership; no expense records are duplicated.';

create index expense_tabs_user_id_idx on public.expense_tabs (user_id);

create trigger expense_tabs_set_updated_at
before update on public.expense_tabs
for each row execute function public.set_expense_updated_at();

alter table public.expense_tabs enable row level security;

create policy expense_tabs_select_own on public.expense_tabs for select to authenticated
using ((select auth.uid()) = user_id);

create policy expense_tabs_insert_own on public.expense_tabs for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy expense_tabs_update_own on public.expense_tabs for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy expense_tabs_delete_own on public.expense_tabs for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.expense_tabs from public, anon, authenticated;
grant select, insert, update, delete on table public.expense_tabs to authenticated;

commit;
