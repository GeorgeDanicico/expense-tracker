-- Run using a privileged SQL connection after the rules migration, before the
-- historical correction. This file is read-only and cannot modify expenses.
begin read only;
with inspected as (
  select e.*, expense_classification_private.inspect_merchant(description, notes) as rule
  from public.expenses e
)
select user_id, rule ->> 'merchant' as matched_merchant,
  array_agg(distinct description order by description) as matched_descriptions,
  category as current_category, subtype as current_subtype,
  'car' as target_category, rule ->> 'subtype' as target_subtype,
  count(*) as expense_count, sum(amount) as amount
from inspected
where rule ->> 'subtype' is not null
  and (category is distinct from 'car' or subtype is distinct from rule ->> 'subtype')
group by user_id, rule ->> 'merchant', category, subtype, rule ->> 'subtype'
order by user_id, matched_merchant, current_category, current_subtype;

with inspected as (
  select e.*, expense_classification_private.inspect_merchant(description, notes) as rule
  from public.expenses e
)
select user_id, id, description, category, subtype, amount,
  rule ->> 'status' as review_reason,
  rule ->> 'description_merchant' as description_merchant,
  rule ->> 'source_merchant' as source_merchant
from inspected
where rule ->> 'status' in ('conflicting_source', 'conflicting_description', 'unrecognized_spelling_or_suffix')
order by user_id, review_reason, id;

select count(*) as ledger_count, coalesce(sum(amount), 0) as ledger_amount
from public.expenses;
commit;
