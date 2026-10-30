begin;

-- The AI gate, part 1 (docs/statement-import-plan.md, I14; roadmap step 8.1).
--
-- 1. public.app_flags: switches the whole app reads, starting with ai_enabled,
--    the kill switch. Everyone signed in reads them; only service_role writes,
--    through set_app_flag().
-- 2. public.ai_usage: the ledger, one row per model call, written by the server
--    after the call. Owners read their own rows; nobody updates or deletes.
-- 3. profiles.ai_enabled: the per-user opt-in switch, off by default, with a
--    guard like mcp_enabled's. A kid also needs the `ai` permission, and
--    turning that permission off turns the kid's switch off.
-- 4. The `ai` kid permission (off, edit) in the permission catalogue, as `mcp`
--    was added in 20261023000100.
-- 5. my_ai_access(): the caller's access, for the gate and the settings page.
-- 6. ai_family_spend() and ai_global_spend(): this month's spend, for the
--    budget checks.
-- 7. A notification kind for budget warnings ('ai_budget') in the outbox.
-- 8. For the statement reader: import_rows.category_source, and the optional
--    category, subtype and category_source per row in create_import_batch().
--
-- Same conventions as the MCP and import migrations: the caller is
-- app_private.current_user_id(), set search_path = '' and fully qualified
-- names, and error messages written for users.

-- Private helpers for the AI gate.
-- Keep this schema out of the Supabase exposed-schema list.
create schema if not exists ai_private;
revoke all on schema ai_private from public, anon, authenticated, service_role;
grant usage on schema ai_private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Flags
-- ---------------------------------------------------------------------------

create table public.app_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,59}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.app_flags enable row level security;

revoke all on table public.app_flags from public, anon, authenticated, service_role;
grant select on table public.app_flags to authenticated, service_role;

create policy app_flags_select_all on public.app_flags
for select to authenticated
using (true);

insert into public.app_flags (key, value) values ('ai_enabled', 'true'::jsonb);

comment on table public.app_flags is
  'App-wide switches, read by everyone signed in and written only by service_role through set_app_flag(). ai_enabled is the AI kill switch: false pauses every model call for everyone.';
comment on column public.app_flags.updated_by is
  'The admin who last set the flag; null when the gate itself turned it off at the global budget, or when it was set with SQL.';

-- Sets a flag's value, recording who and when. For the server's secret key
-- only: the admin page (roadmap 8.3) checks that the caller is an admin
-- (APP_ADMIN_USER_IDS) before calling it, and the gate calls it with no user
-- when the global budget is reached. P0002 for a flag that doesn't exist.
create function public.set_app_flag(p_key text, p_value jsonb, p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_value is null then
    raise exception 'A flag needs a value.'
      using errcode = '22023';
  end if;

  update public.app_flags f
  set value = p_value,
      updated_at = now(),
      updated_by = p_user_id
  where f.key = p_key;

  if not found then
    raise exception 'That flag doesn''t exist.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_app_flag(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.set_app_flag(text, jsonb, uuid) to service_role;

comment on function public.set_app_flag(text, jsonb, uuid) is
  'Sets a flag and records who and when. service_role only. 22023 for a null value, P0002 for an unknown flag.';

-- ---------------------------------------------------------------------------
-- The usage ledger
-- ---------------------------------------------------------------------------

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  -- Both are set null, not cascaded, when the user or the family goes away:
  -- the ledger keeps the money that was spent.
  user_id uuid references auth.users(id) on delete set null,
  -- The caller's family at the time of the call; null without one.
  family_id uuid references public.families(id) on delete set null,
  feature text not null check (feature ~ '^[a-z][a-z0-9_]{0,39}$'),
  provider text not null check (char_length(provider) between 1 and 40),
  model text not null check (char_length(model) between 1 and 100),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  -- Millionths of a dollar, so a call that costs a fraction of a cent is exact.
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  outcome text not null check (char_length(outcome) between 1 and 40),
  created_at timestamptz not null default now()
);

-- Serve the spend sums and the owner's reads.
create index ai_usage_family_id_created_at_idx on public.ai_usage (family_id, created_at)
  where family_id is not null;
create index ai_usage_user_id_created_at_idx on public.ai_usage (user_id, created_at);
create index ai_usage_created_at_idx on public.ai_usage (created_at);

alter table public.ai_usage enable row level security;

-- No update or delete for anyone: a ledger only grows.
revoke all on table public.ai_usage from public, anon, authenticated, service_role;
grant select on table public.ai_usage to authenticated;
grant select, insert on table public.ai_usage to service_role;

create policy ai_usage_select_own on public.ai_usage
for select to authenticated
using (user_id = (select app_private.current_user_id()));

comment on table public.ai_usage is
  'The AI ledger: one row per model call, failed and refused ones included, inserted by the server after the call. Owners read their own rows; nobody updates or deletes them.';
comment on column public.ai_usage.family_id is
  'The caller''s family at the time of the call (null without one), so a family''s month is the sum of its rows even after a member leaves, and a member who joins brings no spend.';
comment on column public.ai_usage.feature is
  'A short key for what the call was for: statements first.';
comment on column public.ai_usage.cost_micros is
  'The call''s cost in millionths of a dollar, priced from the pricing table when it was made.';
comment on column public.ai_usage.outcome is
  'ok, or why the call failed: max_tokens, refusal, invalid_output, timeout, rate_limited, provider_error.';

-- ---------------------------------------------------------------------------
-- The opt-in switch
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column ai_enabled boolean not null default false;

comment on column public.profiles.ai_enabled is
  'Whether AI features may use this account''s data. Off by default; while off, the gate refuses every call. A kid also needs the ai permission.';

-- Why a kid can't use AI whatever their switch says: false when the user is a
-- kid member whose ai permission is off (a missing row is off). True for
-- anyone who isn't a kid member.
create function ai_private.kid_ai_permitted(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.family_members m
    where m.user_id = p_user_id
      and m.role = 'kid'
      and coalesce((
        select p.level
        from public.member_permissions p
        where p.member_id = m.id and p.module = 'ai'
      ), 'off') <> 'edit'
  )
$$;

-- kid_ai_permitted for the caller, for the switch guard below, which runs as
-- the caller and so can't call the ungranted helper.
create function ai_private.my_kid_ai_permitted()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select ai_private.kid_ai_permitted(app_private.current_user_id())
$$;

revoke all on all functions in schema ai_private from public, anon, authenticated, service_role;
grant execute on function ai_private.my_kid_ai_permitted() to authenticated;

comment on function ai_private.kid_ai_permitted(uuid) is
  'False for a kid member whose ai permission is off; true for everyone else. Ungranted.';
comment on function ai_private.my_kid_ai_permitted() is
  'kid_ai_permitted for the caller. Granted to authenticated for the profiles switch guard.';

-- The caller's access to AI features: 'ok', 'not_permitted' (a kid whose ai
-- permission is off) or 'ai_off' (their switch is off). A user without a
-- profile row counts as switched off. The flag and the budgets are the gate's.
create function public.my_ai_access()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not ai_private.kid_ai_permitted(app_private.current_user_id()) then 'not_permitted'
    when not coalesce((
      select p.ai_enabled from public.profiles p where p.id = app_private.current_user_id()
    ), false) then 'ai_off'
    else 'ok'
  end
$$;

revoke all on function public.my_ai_access() from public, anon;
grant execute on function public.my_ai_access() to authenticated;

comment on function public.my_ai_access() is
  'The caller''s AI access: ok, ai_off (the switch is off) or not_permitted (a kid whose ai permission is off).';

-- Same pattern as guard_profile_mcp_enabled (20261023000200), and security
-- invoker for the same reason: `current_user` tells the API roles apart from
-- trusted writers. The API roles can't turn the switch on (insert or update)
-- for a kid whose ai permission is off. Turning it off is always allowed. The
-- owner policies already limit the API roles to their own row, so the caller's
-- permission is the row's.
create function public.guard_profile_ai_enabled()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
    and new.ai_enabled
    and not (tg_op = 'UPDATE' and old.ai_enabled)
    and not ai_private.my_kid_ai_permitted()
  then
    raise exception 'A parent needs to turn on AI features for you.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_profile_ai_enabled() from public, anon, authenticated;

comment on function public.guard_profile_ai_enabled() is
  'Trigger: refuses (42501) the API roles turning profiles.ai_enabled on for a kid without the ai permission.';

create trigger profiles_guard_ai_enabled
before insert or update of ai_enabled on public.profiles
for each row execute function public.guard_profile_ai_enabled();

-- ---------------------------------------------------------------------------
-- The `ai` kid permission
-- ---------------------------------------------------------------------------

-- Three places list the permission catalogue and must change together with
-- MODULE_KEYS and MODULE_LEVELS in src/lib/permissions.ts:
-- 1. the member_permissions_level_allowed check (F03),
-- 2. family_private.module_keys() (F06),
-- 3. family_private.is_valid_permissions(jsonb) (F07).
-- Each is redefined below exactly as 20261023000100 left it, with ai added.
-- Existing kids need no rows: a module without a row counts as off.

alter table public.member_permissions
  drop constraint member_permissions_level_allowed;

-- Must allow exactly the (module, level) pairs in MODULE_LEVELS in
-- src/lib/permissions.ts. Change both together.
alter table public.member_permissions
  add constraint member_permissions_level_allowed check (
    (module, level) in (
      ('expenses', 'off'),
      ('expenses', 'edit'),
      ('investments', 'off'),
      ('investments', 'edit'),
      ('net_worth', 'off'),
      ('net_worth', 'edit'),
      ('family_finance', 'off'),
      ('family_finance', 'view'),
      ('mcp', 'off'),
      ('mcp', 'edit'),
      ('ai', 'off'),
      ('ai', 'edit')
    )
  );

-- The module keys of the permission catalogue, in catalogue order. Must match
-- MODULE_KEYS in src/lib/permissions.ts and the member_permissions_level_allowed
-- check from F03. Change all three together.
create or replace function family_private.module_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['expenses', 'investments', 'net_worth', 'family_finance', 'mcp', 'ai']
$$;

-- Whether p_permissions is a complete permissions object from the catalogue:
-- a JSON object with exactly the keys of family_private.module_keys(), each a
-- string level that module allows. False for null and for anything that isn't
-- an object.
--
-- The (module, level) pairs must match MODULE_LEVELS in src/lib/permissions.ts
-- and the member_permissions_level_allowed check from F03, which stays the
-- backstop. Change all three together.
create or replace function family_private.is_valid_permissions(p_permissions jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then
    return false;
  end if;

  return (
    select coalesce(array_agg(k.key order by k.key), '{}')
    from jsonb_object_keys(p_permissions) as k(key)
  ) = (
    select array_agg(k.module order by k.module)
    from unnest(family_private.module_keys()) as k(module)
  )
  and not exists (
    select 1
    from jsonb_each(p_permissions) as e(module, level)
    where jsonb_typeof(e.level) <> 'string'
      or (e.module, e.level #>> '{}') not in (
        ('expenses', 'off'),
        ('expenses', 'edit'),
        ('investments', 'off'),
        ('investments', 'edit'),
        ('net_worth', 'off'),
        ('net_worth', 'edit'),
        ('family_finance', 'off'),
        ('family_finance', 'view'),
        ('mcp', 'off'),
        ('mcp', 'edit'),
        ('ai', 'off'),
        ('ai', 'edit')
      )
  );
end;
$$;

-- Kid invites store a full catalogue object, and redemption refuses one that
-- isn't, so pending invites created before this migration get ai off.
update public.family_invites
set permissions = permissions || '{"ai": "off"}'::jsonb
where role = 'kid' and not permissions ? 'ai';

-- Turning a kid's ai permission off turns their switch off. set_member_permissions
-- replaces a kid's rows by deleting them and inserting the new ones, so the
-- check can't run per row: this constraint trigger is deferred to the end of
-- the transaction, when the rows are final, and switches off a kid who no
-- longer has ai at edit. A kid who was removed from the family has no member
-- row left to find, and is left alone.
create function ai_private.sync_kid_ai_switch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_member uuid := coalesce(new.member_id, old.member_id);
  affected_module text := coalesce(new.module, old.module);
begin
  if affected_module = 'ai'
    and not exists (
      select 1
      from public.member_permissions p
      where p.member_id = affected_member
        and p.module = 'ai'
        and p.level = 'edit'
    )
  then
    update public.profiles p
    set ai_enabled = false
    from public.family_members m
    where m.id = affected_member
      and p.id = m.user_id
      and p.ai_enabled;
  end if;
  return null;
end;
$$;

revoke all on function ai_private.sync_kid_ai_switch() from public, anon, authenticated, service_role;

comment on function ai_private.sync_kid_ai_switch() is
  'Deferred constraint trigger: once a kid''s ai permission is not edit at the end of the transaction, their profiles.ai_enabled is turned off.';

create constraint trigger member_permissions_sync_ai_switch
after insert or update or delete on public.member_permissions
deferrable initially deferred
for each row execute function ai_private.sync_kid_ai_switch();

-- ---------------------------------------------------------------------------
-- Spend
-- ---------------------------------------------------------------------------

-- The spend, in micros, of the caller's family since p_month_start, or the
-- caller's own spend when they have no family. Security definer, so a kid's
-- call sees the whole family's total without being able to read other
-- members' rows. A family's rows are the ones stamped with its id at the time
-- of the call: a member who left keeps their past rows in the family's month,
-- and a member who joins brings no spend. A user without a family counts only
-- their own rows made without one. Calls are never in the future, so the month
-- has no end here; the caller passes the start of the current month.
create function public.ai_family_spend(p_month_start timestamptz)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  caller_family uuid;
begin
  if caller_id is null then
    raise exception 'Sign in to use AI features.'
      using errcode = '42501';
  end if;

  if p_month_start is null then
    raise exception 'A month start is needed.'
      using errcode = '22023';
  end if;

  select m.family_id into caller_family
  from public.family_members m
  where m.user_id = caller_id;

  if caller_family is not null then
    return (
      select coalesce(sum(u.cost_micros), 0)::bigint
      from public.ai_usage u
      where u.family_id = caller_family
        and u.created_at >= p_month_start
    );
  end if;

  return (
    select coalesce(sum(u.cost_micros), 0)::bigint
    from public.ai_usage u
    where u.user_id = caller_id
      and u.family_id is null
      and u.created_at >= p_month_start
  );
end;
$$;

revoke all on function public.ai_family_spend(timestamptz) from public, anon;
grant execute on function public.ai_family_spend(timestamptz) to authenticated;

comment on function public.ai_family_spend(timestamptz) is
  'The caller''s family''s AI spend in micros since p_month_start (the caller''s own, made without a family, when they have none). 42501 without a user, 22023 without a month start.';

-- Everyone's spend since p_month_start, for the global backstop.
create function public.ai_global_spend(p_month_start timestamptz)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_month_start is null then
    raise exception 'A month start is needed.'
      using errcode = '22023';
  end if;

  return (
    select coalesce(sum(u.cost_micros), 0)::bigint
    from public.ai_usage u
    where u.created_at >= p_month_start
  );
end;
$$;

revoke all on function public.ai_global_spend(timestamptz) from public, anon, authenticated;
grant execute on function public.ai_global_spend(timestamptz) to service_role;

comment on function public.ai_global_spend(timestamptz) is
  'Everyone''s AI spend in micros since p_month_start, for the global backstop. service_role only. 22023 without a month start.';

-- ---------------------------------------------------------------------------
-- Budget notifications
-- ---------------------------------------------------------------------------

-- The outbox gets a kind for budget warnings: 80% and 100% of a family's
-- month, and the global backstop. The worker (kindAllowed in
-- src/lib/notifications/worker.ts) sends it whenever Browser notifications
-- are on. Redefined as 20261028000100 left it, with ai_budget added.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (
    kind in ('reminder', 'todo_assigned', 'todo_due', 'event', 'event_added', 'ai_budget', 'test')
  );

-- ---------------------------------------------------------------------------
-- Categories on import rows
-- ---------------------------------------------------------------------------

alter table public.import_rows
  add column category_source text;

alter table public.import_rows
  add constraint import_rows_category_source_valid check (
    category_source is null or category_source in ('rule', 'history', 'ai')
  );

comment on column public.import_rows.category_source is
  'Where the row''s category came from: rule (the merchant classification), history (the user''s own earlier expenses), ai (the model); null for rows a parser read, with the category unset.';

-- As in 20261029000100, with an optional category, subtype and category_source
-- per row. The merchant classification still runs inside the function and
-- wins when it recognises the row (car, its subtype, rule_matched, source
-- 'rule'). Otherwise the row keeps the category and subtype it was given
-- (checked by the import_rows checks: 23514 for a bad one), or 'other' as
-- before; its category_source is the one given, and null when no category was.
--
-- p_rows is an array of 1-500 objects with expense_date, description, amount
-- and currency, and optionally notes, category, subtype and category_source.
create or replace function public.create_import_batch(p_batch jsonb, p_rows jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  new_batch_id uuid;
begin
  if caller_id is null then
    raise exception 'Sign in to import a statement.'
      using errcode = '42501';
  end if;

  if p_batch is null or jsonb_typeof(p_batch) <> 'object' then
    raise exception 'The import batch must be an object.'
      using errcode = '22023';
  end if;

  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 500
  then
    raise exception 'An import has between 1 and 500 rows.'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) e(value)
    where jsonb_typeof(e.value) <> 'object'
  ) then
    raise exception 'Every import row must be an object.'
      using errcode = '22023';
  end if;

  delete from public.import_batches b
  where b.user_id = caller_id
    and b.status = 'draft'
    and b.expires_at <= now();

  insert into public.import_batches (
    user_id, status, source_kind, parser_id, content_hash, currency,
    period_start, period_end, row_count, skipped_credits, expires_at
  )
  select
    caller_id, 'draft', b.source_kind, b.parser_id, b.content_hash, b.currency,
    b.period_start, b.period_end, jsonb_array_length(p_rows),
    coalesce(b.skipped_credits, 0), now() + interval '24 hours'
  from jsonb_to_record(p_batch) as b(
    source_kind text, parser_id text, content_hash text, currency text,
    period_start date, period_end date, skipped_credits integer
  )
  returning id into new_batch_id;

  insert into public.import_rows (
    batch_id, position, expense_date, description, amount, currency,
    category, subtype, rule_matched, category_source, notes
  )
  select
    new_batch_id, e.idx::smallint, r.expense_date, r.description, r.amount, r.currency,
    case
      when c.subtype is not null then 'car'
      else coalesce(r.category, 'other')
    end,
    case
      when c.subtype is not null then c.subtype
      else r.subtype
    end,
    c.subtype is not null,
    case
      when c.subtype is not null then 'rule'
      when r.category is not null then r.category_source
    end,
    r.notes
  from jsonb_array_elements(p_rows) with ordinality as e(value, idx)
  cross join lateral jsonb_to_record(e.value) as r(
    expense_date date, description text, amount numeric, currency text, notes text,
    category text, subtype text, category_source text
  )
  cross join lateral (
    select expense_classification_private.classify_expense_merchant(r.description, null) as subtype
  ) c
  order by e.idx;

  return new_batch_id;
end;
$$;

comment on function public.create_import_batch(jsonb, jsonb) is
  'Deletes the caller''s expired drafts, then inserts a draft batch (24 hours) and its 1-500 rows atomically, as the caller (RLS applies). Rows the merchant classification recognises get car, their subtype and source rule, whatever they were given; others keep the optional category, subtype and category_source they carry, or become other. Returns the batch id. 42501 without a user, 22023 for a bad shape or row count, 23505 for a hash the caller already has live, 23514 and 23502 for a bad row.';

commit;
