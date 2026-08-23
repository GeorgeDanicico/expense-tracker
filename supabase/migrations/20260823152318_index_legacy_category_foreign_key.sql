create index if not exists expenses_category_id_user_id_idx
  on public.expenses (category_id, user_id)
  where category_id is not null;
