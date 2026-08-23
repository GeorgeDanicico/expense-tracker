begin;

do $$
begin
  if to_regclass('public.expenses') is null then
    create table public.expenses (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users (id) on delete cascade,
      description text not null,
      amount numeric(12, 2) not null,
      category text not null,
      expense_date date not null,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  else
    -- Upgrade the empty starter ledger schema without dropping its tables.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'expenses' and column_name = 'spent_on'
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'expenses' and column_name = 'expense_date'
    ) then
      alter table public.expenses rename column spent_on to expense_date;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'expenses' and column_name = 'note'
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'expenses' and column_name = 'notes'
    ) then
      alter table public.expenses rename column note to notes;
    end if;

    alter table public.expenses
      add column if not exists description text,
      add column if not exists category text,
      add column if not exists expense_date date,
      add column if not exists notes text;

    update public.expenses
    set description = coalesce(nullif(btrim(notes), ''), 'Expense')
    where description is null;

    update public.expenses
    set category = 'other'
    where category is null;

    alter table public.expenses
      alter column description set not null,
      alter column category set not null,
      alter column expense_date set not null;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'expenses' and column_name = 'category_id'
    ) then
      alter table public.expenses alter column category_id drop not null;
    end if;
  end if;
end;
$$;

comment on table public.expenses is
  'User-owned expense ledger. Access is restricted by row-level security.';
comment on column public.expenses.amount is
  'Positive amount in the application-wide configured currency.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.expenses'::regclass and conname = 'expenses_description_length'
  ) then
    alter table public.expenses add constraint expenses_description_length
      check (char_length(btrim(description)) between 1 and 120);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.expenses'::regclass and conname = 'expenses_amount_valid'
  ) then
    alter table public.expenses add constraint expenses_amount_valid
      check (amount > 0 and amount <= 9999999999.99);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.expenses'::regclass and conname = 'expenses_category_valid'
  ) then
    alter table public.expenses add constraint expenses_category_valid
      check (
        category in (
          'housing', 'groceries', 'transport', 'utilities', 'health',
          'entertainment', 'shopping', 'education', 'travel', 'other'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.expenses'::regclass and conname = 'expenses_notes_length'
  ) then
    alter table public.expenses add constraint expenses_notes_length
      check (notes is null or char_length(notes) <= 500);
  end if;
end;
$$;

drop index if exists public.expenses_user_id_spent_on_idx;

create index if not exists expenses_user_date_idx
  on public.expenses (user_id, expense_date desc);

create index if not exists expenses_user_category_date_idx
  on public.expenses (user_id, category, expense_date desc);

create or replace function public.set_expense_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function public.set_expense_updated_at();

revoke all on function public.set_expense_updated_at() from public, anon, authenticated;

alter table public.expenses enable row level security;

drop policy if exists expenses_select_own on public.expenses;
drop policy if exists expenses_insert_own on public.expenses;
drop policy if exists expenses_update_own on public.expenses;
drop policy if exists expenses_delete_own on public.expenses;
drop policy if exists "Users can read their own expenses" on public.expenses;
drop policy if exists "Users can create their own expenses" on public.expenses;
drop policy if exists "Users can update their own expenses" on public.expenses;
drop policy if exists "Users can delete their own expenses" on public.expenses;

create policy "Users can read their own expenses"
on public.expenses for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own expenses"
on public.expenses for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own expenses"
on public.expenses for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own expenses"
on public.expenses for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.expenses from anon;
grant select, insert, update, delete on table public.expenses to authenticated;

commit;
