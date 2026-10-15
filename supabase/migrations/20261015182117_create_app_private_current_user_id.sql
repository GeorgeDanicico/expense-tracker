begin;

-- Single place where SQL learns who the caller is. New functions and policies
-- call app_private.current_user_id() instead of auth.uid(), so a different auth
-- system only needs this one function redefined. Keep this schema out of the
-- Supabase exposed-schema list.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated, service_role;
grant usage on schema app_private to authenticated, service_role;

create function app_private.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select auth.uid()
$$;

revoke all on all functions in schema app_private from public, anon, authenticated, service_role;
grant execute on function app_private.current_user_id() to authenticated, service_role;

comment on function app_private.current_user_id() is
  'The calling user''s id (the JWT sub), or null without claims. Use this instead of auth.uid() in new SQL.';
commit;
