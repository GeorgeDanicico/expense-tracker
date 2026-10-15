begin;

-- Phase 1 (F04): a username for accounts that sign in without an email, and a
-- display name shown to the rest of the family. Both are optional for existing
-- accounts, so no backfill is needed.
alter table public.profiles
  add column if not exists username text,
  add column if not exists display_name text;

alter table public.profiles
  add constraint profiles_username_key unique (username),
  add constraint profiles_username_format check (
    username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'
  ),
  add constraint profiles_display_name_valid check (
    display_name = btrim(display_name) and char_length(display_name) between 1 and 40
  );

comment on column public.profiles.username is
  'Lowercase sign-in name for username accounts (3-30 characters). Set only by the server; signed-in users cannot change it.';
comment on column public.profiles.display_name is
  'Trimmed name (1-40 characters) shown to the rest of the family. The owner may change it.';

-- The existing owner policies let a signed-in user insert and update their own
-- row. Usernames are assigned by the server, so refuse any attempt by the API
-- roles to set or change one. Trusted writers (the service role, migrations and
-- security definer functions, which run as their owner) are not affected.
-- This function must stay security invoker: `current_user` is what tells the
-- API roles apart from trusted writers.
create function public.guard_profile_username()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
    and new.username is distinct from (
      case when tg_op = 'UPDATE' then old.username else null end
    )
  then
    raise exception 'Usernames can only be set by the server.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_profile_username() from public, anon, authenticated;

create trigger profiles_guard_username
before insert or update of username on public.profiles
for each row execute function public.guard_profile_username();

commit;
