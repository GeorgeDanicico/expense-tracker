-- Isolated rehearsal only. Reconstruct the legacy objects assumed by the first
-- checked-in migration from their inspected schema; never run on a live project.
create schema if not exists auth;
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create table if not exists auth.users (
  id uuid primary key, email text, encrypted_password text,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz
);
-- The standalone Supabase Postgres image supplies a minimal auth.users stub.
alter table auth.users
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists raw_app_meta_data jsonb,
  add column if not exists raw_user_meta_data jsonb,
  add column if not exists encrypted_password text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, full_name text, avatar_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, color text not null default '#64748b',
  is_archived boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id), amount numeric(12,2) not null,
  description text not null, category text not null, expense_date date not null, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
grant select, insert, update, delete on public.profiles, public.categories to authenticated;
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
-- Only their signatures are needed by the historic privilege-hardening migration.
create function public.handle_new_user() returns trigger language plpgsql as $$ begin return new; end $$;
create function public.reset_daily_tokens() returns void language sql as $$ select $$;
