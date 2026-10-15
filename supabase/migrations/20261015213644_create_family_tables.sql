begin;

-- Phase 1 (F03): families, their members and each kid's module permissions.
-- RLS is on with no policies yet, so signed-in users can read nothing here;
-- F06 adds the read policies, and every write goes through RPCs (F07 on).

-- Private helpers for the family module (filled in by F06).
-- Keep this schema out of the Supabase exposed-schema list.
create schema if not exists family_private;
revoke all on schema family_private from public, anon, authenticated, service_role;
grant usage on schema family_private to authenticated, service_role;

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  creator_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint families_name_valid check (
    name = btrim(name) and char_length(name) between 1 and 60
  )
);

create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  joined_at timestamptz not null default now(),
  last_active_at timestamptz,
  constraint family_members_user_id_key unique (user_id),
  constraint family_members_role_valid check (role in ('parent', 'kid'))
);

create index family_members_family_id_idx on public.family_members (family_id);

create table public.member_permissions (
  member_id uuid not null references public.family_members(id) on delete cascade,
  module text not null,
  level text not null,
  primary key (member_id, module),
  -- Must allow exactly the (module, level) pairs in MODULE_LEVELS in
  -- src/lib/permissions.ts. Change both together.
  constraint member_permissions_level_allowed check (
    (module, level) in (
      ('expenses', 'off'),
      ('expenses', 'edit'),
      ('investments', 'off'),
      ('investments', 'edit'),
      ('net_worth', 'off'),
      ('net_worth', 'edit'),
      ('family_finance', 'off'),
      ('family_finance', 'view')
    )
  )
);

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.member_permissions enable row level security;

-- Reads only, and only once F06 adds policies. Writes go through the RPCs.
revoke all on table public.families, public.family_members, public.member_permissions
  from public, anon, authenticated;
grant select on table public.families, public.family_members, public.member_permissions
  to authenticated;

comment on table public.families is
  'A family. The creator is always a parent member of it (enforced from F05).';
comment on column public.families.name is 'Trimmed family name, 1-60 characters.';
comment on table public.family_members is
  'One row per user in a family. A user belongs to at most one family.';
comment on table public.member_permissions is
  'A kid''s level per module. A module without a row counts as off. Allowed pairs mirror src/lib/permissions.ts.';

commit;
