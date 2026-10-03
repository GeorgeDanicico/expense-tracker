-- Deploy Car/subtype-compatible readers BEFORE applying this migration.
begin;

create table if not exists expense_classification_private.expense_backups (
  migration_id text not null,
  expense_id uuid not null,
  original_row jsonb not null,
  corrected_row jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (migration_id, expense_id)
);
-- Deliberately no expense FK: deleted expenses must not delete recovery history.
alter table expense_classification_private.expense_backups enable row level security;
revoke all on table expense_classification_private.expense_backups from public, anon, authenticated, service_role;

create or replace function expense_classification_private.correct_historical_merchants()
returns integer language plpgsql set search_path = '' as $$
declare
  migration_key constant text := '20261003100635_correct_historical_expense_merchants';
  before_rows jsonb;
  before_immutable jsonb;
  before_unrelated jsonb;
  after_immutable jsonb;
  after_unrelated jsonb;
  before_count bigint;
  before_amount numeric;
  changed integer;
begin
  -- Serialize against writes while capturing snapshots and validating invariants.
  lock table public.expenses in share row exclusive mode;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb),
    coalesce(jsonb_agg(to_jsonb(e) - array['category', 'subtype', 'updated_at'] order by e.id), '[]'::jsonb),
    count(*), coalesce(sum(e.amount), 0)
  into before_rows, before_immutable, before_count, before_amount
  from public.expenses e;

  select coalesce(jsonb_agg(snapshot order by snapshot ->> 'id'), '[]'::jsonb)
  into before_unrelated
  from jsonb_array_elements(before_rows) snapshot
  where expense_classification_private.classify_expense_merchant(snapshot ->> 'description', snapshot ->> 'notes') is null
     or (snapshot ->> 'category' = 'car' and snapshot ->> 'subtype' =
       expense_classification_private.classify_expense_merchant(snapshot ->> 'description', snapshot ->> 'notes'));

  with originals as (
    select snapshot, expense_classification_private.classify_expense_merchant(
      snapshot ->> 'description', snapshot ->> 'notes') as target_subtype
    from jsonb_array_elements(before_rows) snapshot
  ), corrected as (
    update public.expenses e set category = 'car', subtype = o.target_subtype
    from originals o
    where e.id = (o.snapshot ->> 'id')::uuid and o.target_subtype is not null
      and (e.category is distinct from 'car' or e.subtype is distinct from o.target_subtype)
    returning e.id, to_jsonb(e) as corrected_row, o.snapshot as original_row
  ), saved as (
    insert into expense_classification_private.expense_backups
      (migration_id, expense_id, original_row, corrected_row)
    select migration_key, id, original_row, corrected_row from corrected
    on conflict (migration_id, expense_id) do nothing
    returning expense_id
  )
  select count(*)::integer into changed from corrected;

  select coalesce(jsonb_agg(to_jsonb(e) - array['category', 'subtype', 'updated_at'] order by e.id), '[]'::jsonb)
  into after_immutable from public.expenses e;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb)
  into after_unrelated from public.expenses e
  where e.id in (select (snapshot ->> 'id')::uuid from jsonb_array_elements(before_unrelated) snapshot);

  if before_immutable is distinct from after_immutable
     or before_unrelated is distinct from after_unrelated
     or before_count <> (select count(*) from public.expenses)
     or before_amount <> (select coalesce(sum(amount), 0) from public.expenses)
     or exists (select 1 from public.expenses e
       where expense_classification_private.classify_expense_merchant(e.description, e.notes) is not null
       and (e.category is distinct from 'car' or e.subtype is distinct from
         expense_classification_private.classify_expense_merchant(e.description, e.notes))) then
    raise exception 'Merchant correction invariant failed; transaction must roll back';
  end if;
  raise notice 'Merchant correction changed % rows; count %, amount % unchanged', changed, before_count, before_amount;
  return changed;
end;
$$;
revoke all on function expense_classification_private.correct_historical_merchants() from public, anon, authenticated, service_role;

-- Administrator-only recovery; compare complete recorded post-change rows so a
-- later amount, description, owner, timestamp, or classification edit is a conflict.
create or replace function expense_classification_private.restore_historical_merchants()
returns table (expense_id uuid, recovery_status text)
language plpgsql set search_path = '' as $$
declare
  migration_key constant text := '20261003100635_correct_historical_expense_merchants';
  recovery_rows jsonb;
  before_immutable jsonb;
  after_immutable jsonb;
  unaffected_rows jsonb;
  after_unaffected jsonb;
begin
  lock table public.expenses in share row exclusive mode;
  if (select count(*) from pg_catalog.pg_trigger where tgrelid = 'public.expenses'::regclass
      and tgname in ('expenses_classify_merchant', 'expenses_set_updated_at') and tgenabled = 'O') <> 2 then
    raise exception 'Recovery expects both merchant and updated-at triggers enabled; review trigger state first';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.expense_id, 'original', b.original_row,
    'status', case when e.id is null then 'deleted_conflict'
      when to_jsonb(e) = b.original_row then 'already_restored'
      when to_jsonb(e) = b.corrected_row then 'restored'
      else 'later_edit_conflict' end) order by b.expense_id), '[]'::jsonb)
  into recovery_rows
  from expense_classification_private.expense_backups b
  left join public.expenses e on e.id = b.expense_id where b.migration_id = migration_key;

  select coalesce(jsonb_agg(to_jsonb(e) - array['category', 'subtype', 'updated_at'] order by e.id), '[]'::jsonb)
  into before_immutable from public.expenses e;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb)
  into unaffected_rows from public.expenses e
  where e.id not in (select (r ->> 'id')::uuid from jsonb_array_elements(recovery_rows) r where r ->> 'status' = 'restored');

  alter table public.expenses disable trigger expenses_classify_merchant;
  alter table public.expenses disable trigger expenses_set_updated_at;
  update public.expenses e
  set category = r -> 'original' ->> 'category', subtype = r -> 'original' ->> 'subtype',
    updated_at = (r -> 'original' ->> 'updated_at')::timestamptz
  from jsonb_array_elements(recovery_rows) r
  where e.id = (r ->> 'id')::uuid and r ->> 'status' = 'restored';
  alter table public.expenses enable trigger expenses_set_updated_at;
  alter table public.expenses enable trigger expenses_classify_merchant;

  select coalesce(jsonb_agg(to_jsonb(e) - array['category', 'subtype', 'updated_at'] order by e.id), '[]'::jsonb)
  into after_immutable from public.expenses e;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb)
  into after_unaffected from public.expenses e
  where e.id in (select (r ->> 'id')::uuid from jsonb_array_elements(unaffected_rows) r);
  if before_immutable is distinct from after_immutable or unaffected_rows is distinct from after_unaffected
     or exists (select 1 from jsonb_array_elements(recovery_rows) r join public.expenses e on e.id = (r ->> 'id')::uuid
       where r ->> 'status' = 'restored' and to_jsonb(e) is distinct from r -> 'original') then
    raise exception 'Recovery invariant failed; transaction must roll back';
  end if;
  return query select (r ->> 'id')::uuid, r ->> 'status' from jsonb_array_elements(recovery_rows) r;
end;
$$;
revoke all on function expense_classification_private.restore_historical_merchants() from public, anon, authenticated, service_role;

select expense_classification_private.correct_historical_merchants();
commit;
