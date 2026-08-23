begin;

-- The restored project contained an earlier, unused tracker starter. Keep its
-- tables available to authenticated users while removing anonymous discovery
-- and bringing ownership policies up to the current RLS pattern.
revoke all on table public.profiles from anon;
revoke all on table public.categories from anon;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_delete_own on public.profiles;

create policy profiles_select_own on public.profiles
for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles
for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy profiles_delete_own on public.profiles
for delete to authenticated using ((select auth.uid()) = id);

drop policy if exists categories_select_own on public.categories;
drop policy if exists categories_insert_own on public.categories;
drop policy if exists categories_update_own on public.categories;
drop policy if exists categories_delete_own on public.categories;

create policy categories_select_own on public.categories
for select to authenticated using ((select auth.uid()) = user_id);
create policy categories_insert_own on public.categories
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy categories_update_own on public.categories
for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy categories_delete_own on public.categories
for delete to authenticated using ((select auth.uid()) = user_id);

alter function public.set_updated_at() set search_path = '';
revoke all on function public.handle_new_user() from public, anon, authenticated;

commit;
