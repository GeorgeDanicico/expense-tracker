begin;

alter table public.expenses add column subtype text;

alter table public.expenses drop constraint expenses_category_valid;
alter table public.expenses add constraint expenses_category_valid check (
  category in ('housing', 'groceries', 'transport', 'car', 'utilities', 'health',
    'entertainment', 'shopping', 'education', 'travel', 'other')
);

alter table public.expenses add constraint expenses_subtype_valid check (
  subtype is null or (
    category = 'car' and subtype in ('car_maintenance', 'car_fuel', 'car_repairs')
  )
);

comment on column public.expenses.subtype is
  'Optional fixed subtype belonging to the expense main category.';

commit;
