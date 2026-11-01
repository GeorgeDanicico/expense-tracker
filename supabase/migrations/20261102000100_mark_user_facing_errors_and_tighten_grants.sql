-- S9 (docs/security-plan.md, "Data exposure and the database review"): audit P2 and the security
-- definer review.
--
-- 1. User-facing messages. The app passes a database message on to the client only when our own SQL
--    marked it as written for users: `raise exception '…' using errcode = '…', hint = 'user'`
--    (`translateDatabaseError` in src/lib/supabase/errors.ts reads the hint). Postgres' own errors
--    (a row-level security violation, a check or unique constraint, anything naming a table) never
--    carry that hint, so they get the route's generic message instead.
--
--    Every function below is re-created exactly as it is defined today, from `pg_get_functiondef`
--    of the replayed migrations: the same signature, return type, language, volatility, `security
--    definer` (or not) and `search_path`. The only change in each body is `, hint = 'user'` after
--    the `errcode` of every `raise exception`. `create or replace` keeps each function's owner and
--    grants, so no grant is repeated here.
--
--    Three functions keep their raises unmarked on purpose, because their messages are not for users:
--    `family_private.member_level`'s "Unknown module: %" reports a programming error and quotes its
--    argument, and `expense_classification_private.correct_historical_merchants` and
--    `restore_historical_merchants` are one-off maintenance functions whose raises are invariant
--    failures. supabase/tests/security_definer.sql checks that every other `raise exception` in our
--    schemas carries the marker, so a new function can't forget it.
--
-- 2. Grants. `public.set_updated_at()` (a trigger function from before the migrations) could still
--    be executed by `public`, `anon` and `authenticated`. Triggers don't need that privilege, so it
--    is revoked like every other trigger function's.

-- ---------------------------------------------------------------------------
-- 1. The user-facing marker
-- ---------------------------------------------------------------------------

-- family_private.check_creator_is_parent: as defined in 20261015221500_add_family_membership_invariants.sql, with the marker on 1 raise.
create or replace function family_private.check_creator_is_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_creator uuid;
begin
  select f.creator_id into current_creator
  from public.families f
  where f.id = new.id;

  if found and not exists (
    select 1
    from public.family_members m
    where m.family_id = new.id
      and m.user_id = current_creator
      and m.role = 'parent'
  ) then
    raise exception 'A family''s creator must be a parent in that family.'
      using errcode = '23514', hint = 'user';
  end if;
  return null;
end;
$$;

-- family_private.prevent_kid_promotion_with_permissions: as defined in 20261015221500_add_family_membership_invariants.sql, with the marker on 1 raise.
create or replace function family_private.prevent_kid_promotion_with_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'kid' and new.role <> 'kid' and exists (
    select 1 from public.member_permissions p where p.member_id = old.id
  ) then
    raise exception 'Delete a kid''s permissions before changing their role.'
      using errcode = '23514', hint = 'user';
  end if;
  return new;
end;
$$;

-- family_private.prevent_membership_move: as defined in 20261015221500_add_family_membership_invariants.sql, with the marker on 1 raise.
create or replace function family_private.prevent_membership_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.family_id is distinct from old.family_id or new.user_id is distinct from old.user_id then
    raise exception 'A membership''s family and user cannot change.'
      using errcode = '23514', hint = 'user';
  end if;
  return new;
end;
$$;

-- family_private.protect_creator_membership: as defined in 20261015221500_add_family_membership_invariants.sql, with the marker on 1 raise.
create or replace function family_private.protect_creator_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (old.role <> 'parent' or new.role = 'parent') then
    return new;
  end if;

  if exists (
    select 1
    from public.families f
    where f.id = old.family_id
      and f.creator_id = old.user_id
  ) and (
    tg_op = 'UPDATE'
    or exists (select 1 from auth.users u where u.id = old.user_id)
  ) then
    raise exception 'The family creator''s membership cannot be removed or demoted.'
      using errcode = '23514', hint = 'user';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- family_private.require_kid_for_permissions: as defined in 20261015221500_add_family_membership_invariants.sql, with the marker on 1 raise.
create or replace function family_private.require_kid_for_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_role text;
begin
  select m.role into member_role
  from public.family_members m
  where m.id = new.member_id
  for share;

  -- A missing member is left to the foreign key, which reports it as 23503.
  if found and member_role <> 'kid' then
    raise exception 'Only kids have module permissions.'
      using errcode = '23514', hint = 'user';
  end if;
  return new;
end;
$$;

-- mcp_private.token_expires_at: as defined in 20261023000200_create_mcp_access.sql, with the marker on 1 raise.
create or replace function mcp_private.token_expires_at(p_expiry text)
returns timestamp with time zone
language plpgsql
stable
set search_path = ''
as $$
begin
  case p_expiry
    when '1m' then return now() + interval '1 month';
    when '3m' then return now() + interval '3 months';
    when '6m' then return now() + interval '6 months';
    when 'never' then return null;
    else
      raise exception 'Choose an expiry: 1 month, 3 months, 6 months or never.'
        using errcode = '22023', hint = 'user';
  end case;
end;
$$;

-- public.add_managed_kid: as defined in 20261016000600_add_managed_kid_accounts.sql, with the marker on 5 raises.
create or replace function public.add_managed_kid(p_user_id uuid, p_permissions jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_family_id uuid;
  new_member_id uuid;
begin
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent';

  if not found then
    raise exception 'Only parents can add a kid.'
      using errcode = '42501', hint = 'user';
  end if;

  -- Lock the profile so the marking can't change before we commit.
  perform 1
  from public.profiles p
  where p.id = p_user_id
    and p.managed_by_family = caller_family_id
  for share;

  if not found then
    raise exception 'That account wasn''t found.'
      using errcode = 'P0002', hint = 'user';
  end if;

  if exists (
    select 1
    from public.family_members m
    where m.user_id = p_user_id
  ) then
    raise exception 'That account is already in a family.'
      using errcode = '23505', hint = 'user';
  end if;

  if not family_private.is_valid_permissions(p_permissions) then
    raise exception 'Choose an allowed level for every module.'
      using errcode = '23514', hint = 'user';
  end if;

  -- Two calls at once can both pass the check above. The unique user_id on
  -- family_members then refuses the second; give it the same message.
  begin
    insert into public.family_members (family_id, user_id, role)
    values (caller_family_id, p_user_id, 'kid')
    returning id into new_member_id;
  exception
    when unique_violation then
      raise exception 'That account is already in a family.'
        using errcode = '23505', hint = 'user';
  end;

  insert into public.member_permissions (member_id, module, level)
  select new_member_id, e.module, e.level
  from jsonb_each_text(p_permissions) as e(module, level);

  return new_member_id;
end;
$$;

-- public.ai_family_spend: as defined in 20261030000100_create_ai_gate.sql, with the marker on 2 raises.
create or replace function public.ai_family_spend(p_month_start timestamp with time zone)
returns bigint
language plpgsql
stable security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  caller_family uuid;
begin
  if caller_id is null then
    raise exception 'Sign in to use AI features.'
      using errcode = '42501', hint = 'user';
  end if;

  if p_month_start is null then
    raise exception 'A month start is needed.'
      using errcode = '22023', hint = 'user';
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

-- public.ai_global_spend: as defined in 20261030000100_create_ai_gate.sql, with the marker on 1 raise.
create or replace function public.ai_global_spend(p_month_start timestamp with time zone)
returns bigint
language plpgsql
stable security definer
set search_path = ''
as $$
begin
  if p_month_start is null then
    raise exception 'A month start is needed.'
      using errcode = '22023', hint = 'user';
  end if;

  return (
    select coalesce(sum(u.cost_micros), 0)::bigint
    from public.ai_usage u
    where u.created_at >= p_month_start
  );
end;
$$;

-- public.calendar_event_attendees_guard: as defined in 20261028000100_create_family_calendar.sql, with the marker on 1 raise.
create or replace function public.calendar_event_attendees_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.calendar_events e
    join public.family_members m on m.family_id = e.family_id
    where e.id = new.event_id
      and m.id = new.member_id
  ) then
    raise exception 'An event can only be for members of its family.'
      using errcode = '23514', hint = 'user';
  end if;

  return new;
end;
$$;

-- public.calendar_events_guard: as defined in 20261028000100_create_family_calendar.sql, with the marker on 3 raises.
create or replace function public.calendar_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  api_role boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'UPDATE' then
    if new.family_id is distinct from old.family_id then
      raise exception 'An event can''t move to another family.'
        using errcode = '42501', hint = 'user';
    end if;

    if new.series_id is distinct from old.series_id
      or new.series_index is distinct from old.series_index
      or new.series_repeat is distinct from old.series_repeat
    then
      raise exception 'An event''s series and repeat can''t be changed.'
        using errcode = '42501', hint = 'user';
    end if;

    if api_role and new.created_by is distinct from old.created_by then
      raise exception 'An event''s creator can''t be changed.'
        using errcode = '42501', hint = 'user';
    end if;

    if new.updated_at is distinct from old.updated_at
      or (to_jsonb(new) - 'notified_at' - 'notify_locked_until')
        is distinct from (to_jsonb(old) - 'notified_at' - 'notify_locked_until')
    then
      new.updated_at := now();
    end if;
  end if;

  return new;
end;
$$;

-- public.confirm_import_batch: as defined in 20261029000100_create_statement_imports.sql, with the marker on 6 raises.
create or replace function public.confirm_import_batch(p_batch_id uuid, p_rows jsonb)
returns table(id uuid, description text, amount numeric, category text, subtype text, expense_date date, notes text)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  caller_id uuid := app_private.current_user_id();
  batch public.import_batches;
  picked record;
  new_id uuid;
  new_ids uuid[] := '{}';
begin
  select * into batch
  from public.import_batches b
  where b.id = p_batch_id
  for update;

  if not found then
    raise exception 'That import wasn''t found or has expired.'
      using errcode = 'P0002', hint = 'user';
  end if;

  if batch.status <> 'draft' then
    raise exception 'That import has already been confirmed or undone.'
      using errcode = '55000', hint = 'user';
  end if;

  if batch.expires_at <= now() then
    raise exception 'That import wasn''t found or has expired.'
      using errcode = 'P0002', hint = 'user';
  end if;

  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 500
  then
    raise exception 'Confirm between 1 and 500 rows.'
      using errcode = '22023', hint = 'user';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) e(value)
    where jsonb_typeof(e.value) <> 'object'
  ) then
    raise exception 'Every confirmed row must be an object.'
      using errcode = '22023', hint = 'user';
  end if;

  if (
    select count(distinct x.id) from jsonb_to_recordset(p_rows) as x(id uuid)
  ) <> jsonb_array_length(p_rows)
  or exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(id uuid)
    where not exists (
      select 1 from public.import_rows ir
      where ir.id = x.id and ir.batch_id = p_batch_id
    )
  ) then
    raise exception 'Every confirmed row must be a different row of this import.'
      using errcode = '22023', hint = 'user';
  end if;

  for picked in
    select r.description, r.amount, r.expense_date, r.category, r.subtype, r.notes
    from jsonb_array_elements(p_rows) with ordinality as e(value, idx)
    cross join lateral jsonb_to_record(e.value) as r(
      description text, amount numeric, expense_date date, category text,
      subtype text, notes text
    )
    order by e.idx
  loop
    insert into public.expenses (
      user_id, description, amount, category, subtype, expense_date, notes
    )
    values (
      caller_id, picked.description, picked.amount, picked.category,
      picked.subtype, picked.expense_date, picked.notes
    )
    returning expenses.id into new_id;

    insert into public.import_expenses (expense_id, batch_id)
    values (new_id, p_batch_id);

    new_ids := array_append(new_ids, new_id);
  end loop;

  update public.import_batches b
  set status = 'confirmed',
      confirmed_at = now(),
      confirmed_count = cardinality(new_ids),
      expires_at = null
  where b.id = p_batch_id;

  delete from public.import_rows ir
  where ir.batch_id = p_batch_id;

  return query
  select e.id, e.description, e.amount, e.category, e.subtype, e.expense_date, e.notes
  from public.expenses e
  where e.id = any(new_ids)
  order by array_position(new_ids, e.id);
end;
$$;

-- public.create_calendar_events: as defined in 20261028000100_create_family_calendar.sql, with the marker on 3 raises.
create or replace function public.create_calendar_events(p_rows jsonb, p_member_ids uuid[])
returns setof public.calendar_events
language plpgsql
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  caller_family_id uuid := family_private.my_family_id();
  shared_series_id uuid := gen_random_uuid();
  inserted_ids uuid[];
begin
  if caller_family_id is null then
    raise exception 'Join or create a family to use the calendar.'
      using errcode = '42501', hint = 'user';
  end if;

  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 10
  then
    raise exception 'An event series has between 1 and 10 events.'
      using errcode = '22023', hint = 'user';
  end if;

  if p_member_ids is null
    or cardinality(p_member_ids) = 0
    or array_position(p_member_ids, null) is not null
  then
    raise exception 'Choose who the event is for.'
      using errcode = '22023', hint = 'user';
  end if;

  with inserted as (
    insert into public.calendar_events (
      family_id, series_id, series_index, series_repeat, title, notes, location,
      all_day, starts_at, ends_at, timezone, notify_at, created_by
    )
    select
      caller_family_id,
      coalesce(r.series_id, shared_series_id),
      coalesce(r.series_index, 1),
      coalesce(r.series_repeat, 'none'),
      r.title,
      coalesce(r.notes, ''),
      coalesce(r.location, ''),
      coalesce(r.all_day, false),
      r.starts_at,
      r.ends_at,
      coalesce(r.timezone, 'Europe/Bucharest'),
      r.notify_at,
      caller_id
    from jsonb_to_recordset(p_rows) as r(
      series_id uuid, series_index smallint, series_repeat text, title text,
      notes text, location text, all_day boolean, starts_at timestamptz,
      ends_at timestamptz, timezone text, notify_at timestamptz
    )
    returning id, series_index
  )
  select array_agg(i.id order by i.series_index) into inserted_ids
  from inserted i;

  insert into public.calendar_event_attendees (event_id, member_id)
  select e.id, m.member_id
  from unnest(inserted_ids) with ordinality as ids(id, idx)
  join public.calendar_events e on e.id = ids.id
  cross join (select distinct unnest(p_member_ids) as member_id) m
  order by ids.idx, m.member_id;

  return query
  select e.*
  from public.calendar_events e
  where e.id = any(inserted_ids)
  order by e.series_index;
end;
$$;

-- public.create_calendar_feed: as defined in 20261028000100_create_family_calendar.sql, with the marker on 1 raise.
create or replace function public.create_calendar_feed(p_token_hash text)
returns table(id uuid, user_id uuid, created_at timestamp with time zone, last_fetched_at timestamp with time zone, revoked_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
begin
  if caller_id is null then
    raise exception 'Sign in to create a calendar link.'
      using errcode = '42501', hint = 'user';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('calendar_feeds:' || caller_id::text, 0));

  update public.calendar_feeds f
  set revoked_at = now()
  where f.user_id = caller_id
    and f.revoked_at is null;

  return query
  insert into public.calendar_feeds as f (user_id, token_hash)
  values (caller_id, p_token_hash)
  returning f.id, f.user_id, f.created_at, f.last_fetched_at, f.revoked_at;
end;
$$;

-- public.create_family: as defined in 20261016000200_create_family_function.sql, with the marker on 5 raises.
create or replace function public.create_family(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  -- Trim every kind of whitespace, as the app's schema does, not only spaces.
  -- The result also satisfies the families_name_valid check (name = btrim(name)).
  family_name text := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  new_family_id uuid;
begin
  if caller_id is null then
    raise exception 'Sign in to create a family.'
      using errcode = '42501', hint = 'user';
  end if;

  if family_name is null or family_name = '' then
    raise exception 'Enter a family name.'
      using errcode = '23514', hint = 'user';
  end if;

  if char_length(family_name) > 60 then
    raise exception 'Use at most 60 characters.'
      using errcode = '23514', hint = 'user';
  end if;

  if exists (
    select 1
    from public.family_members m
    where m.user_id = caller_id
  ) then
    raise exception 'You''re already in a family.'
      using errcode = '23505', hint = 'user';
  end if;

  insert into public.families (name, creator_id)
  values (family_name, caller_id)
  returning id into new_family_id;

  -- Two calls at once can both pass the check above. The unique user_id on
  -- family_members then refuses the second; give it the same message.
  begin
    insert into public.family_members (family_id, user_id, role)
    values (new_family_id, caller_id, 'parent');
  exception
    when unique_violation then
      raise exception 'You''re already in a family.'
        using errcode = '23505', hint = 'user';
  end;

  return new_family_id;
end;
$$;

-- public.create_family_invite: as defined in 20261016000700_create_family_invites.sql, with the marker on 6 raises.
create or replace function public.create_family_invite(p_role text, p_permissions jsonb, p_code_hash text)
returns table(invite_id uuid, expires_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_family_id uuid;
  invite_permissions jsonb := nullif(p_permissions, 'null'::jsonb);
  new_invite_id uuid;
  new_expires_at timestamptz;
begin
  -- The key share lock keeps the caller's membership from being removed
  -- before this transaction commits, so a parent who is being removed can't
  -- leave a fresh invite behind.
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent'
  for key share;

  if not found then
    raise exception 'Only parents can invite people to the family.'
      using errcode = '42501', hint = 'user';
  end if;

  if p_role is null or p_role not in ('parent', 'kid') then
    raise exception 'Choose whether to invite a parent or a kid.'
      using errcode = '23514', hint = 'user';
  end if;

  if p_role = 'parent' and invite_permissions is not null then
    raise exception 'Parents always have full access, so a parent invite can''t have permissions.'
      using errcode = '23514', hint = 'user';
  end if;

  if p_role = 'kid' and not family_private.is_valid_permissions(invite_permissions) then
    raise exception 'Choose an allowed level for every module.'
      using errcode = '23514', hint = 'user';
  end if;

  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'The invite code is not valid.'
      using errcode = '23514', hint = 'user';
  end if;

  begin
    insert into public.family_invites as i
      (family_id, code_hash, role, permissions, created_by, expires_at)
    values (
      caller_family_id,
      p_code_hash,
      p_role,
      invite_permissions,
      app_private.current_user_id(),
      now() + case when p_role = 'parent' then interval '48 hours' else interval '7 days' end
    )
    returning i.id, i.expires_at into new_invite_id, new_expires_at;
  exception
    when unique_violation then
      raise exception 'That invite code is already in use.'
        using errcode = '23505', hint = 'user';
  end;

  return query select new_invite_id, new_expires_at;
end;
$$;

-- public.create_import_batch: as defined in 20261030000100_create_ai_gate.sql, with the marker on 4 raises.
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
      using errcode = '42501', hint = 'user';
  end if;

  if p_batch is null or jsonb_typeof(p_batch) <> 'object' then
    raise exception 'The import batch must be an object.'
      using errcode = '22023', hint = 'user';
  end if;

  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 500
  then
    raise exception 'An import has between 1 and 500 rows.'
      using errcode = '22023', hint = 'user';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) e(value)
    where jsonb_typeof(e.value) <> 'object'
  ) then
    raise exception 'Every import row must be an object.'
      using errcode = '22023', hint = 'user';
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

-- public.create_mcp_token: as defined in 20261023000200_create_mcp_access.sql, with the marker on 2 raises.
create or replace function public.create_mcp_token(p_name text, p_token_hash text, p_prefix text, p_expiry text)
returns table(id uuid, user_id uuid, name text, prefix text, created_at timestamp with time zone, regenerated_at timestamp with time zone, last_used_at timestamp with time zone, expires_at timestamp with time zone, revoked_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  new_expires_at timestamptz;
begin
  if not mcp_private.personal_tokens_allowed(caller_id) then
    raise exception 'Kids connect AI assistants through the app''s sign-in page, not with tokens.'
      using errcode = '42501', hint = 'user';
  end if;

  new_expires_at := mcp_private.token_expires_at(p_expiry);

  perform pg_advisory_xact_lock(hashtextextended('mcp_tokens:' || caller_id::text, 0));

  if (
    select count(*)
    from public.mcp_tokens t
    where t.user_id = caller_id
      and t.revoked_at is null
      and (t.expires_at is null or t.expires_at > now())
  ) >= 10 then
    raise exception 'You can have at most 10 personal tokens. Revoke one to create another.'
      using errcode = 'P0001', hint = 'user';
  end if;

  return query
  insert into public.mcp_tokens as t (user_id, name, token_hash, prefix, expires_at)
  values (caller_id, p_name, p_token_hash, p_prefix, new_expires_at)
  returning t.id, t.user_id, t.name, t.prefix, t.created_at, t.regenerated_at,
    t.last_used_at, t.expires_at, t.revoked_at;
end;
$$;

-- public.create_net_worth_item_with_valuation: as defined in 20260920135227_create_net_worth_schema.sql, with the marker on 1 raise.
create or replace function public.create_net_worth_item_with_valuation(p_name text, p_kind text, p_category text, p_currency text, p_purchase_amount numeric, p_value numeric, p_valued_on date)
returns uuid
language plpgsql
set search_path = 'public'
as $$
declare
  item_id uuid;
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501', hint = 'user';
  end if;

  insert into public.net_worth_items (
    user_id,
    name,
    kind,
    category,
    currency,
    purchase_amount
  )
  values (
    current_user_id,
    p_name,
    p_kind,
    p_category,
    p_currency,
    p_purchase_amount
  )
  returning id into item_id;

  insert into public.net_worth_valuations (item_id, value, valued_on)
  values (item_id, p_value, p_valued_on);

  return item_id;
end;
$$;

-- public.delete_family: as defined in 20261016000500_add_family_removal_functions.sql, with the marker on 2 raises.
create or replace function public.delete_family(p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  caller_family_id uuid;
  caller_family_name text;
  -- Trim every kind of whitespace, as create_family does for the name.
  typed_name text := regexp_replace(p_confirm_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  select f.id, f.name into caller_family_id, caller_family_name
  from public.families f
  where f.creator_id = caller_id
  for update;

  if not found then
    raise exception 'Only the family''s creator can delete the family.'
      using errcode = '42501', hint = 'user';
  end if;

  if typed_name is null or lower(typed_name) <> lower(caller_family_name) then
    raise exception 'Type the family''s name to confirm.'
      using errcode = '23514', hint = 'user';
  end if;

  insert into public.account_notices (user_id, kind, family_name)
  select m.user_id, 'family_deleted', caller_family_name
  from public.family_members m
  where m.family_id = caller_family_id
    and m.user_id <> caller_id;

  delete from public.families f
  where f.id = caller_family_id;
end;
$$;

-- public.dismiss_notice: as defined in 20261016000100_create_account_notices.sql, with the marker on 1 raise.
create or replace function public.dismiss_notice(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_notices n
  set seen_at = coalesce(n.seen_at, now())
  where n.id = p_notice_id
    and n.user_id = (select app_private.current_user_id());

  if not found then
    raise exception 'Notice not found.'
      using errcode = 'P0002', hint = 'user';
  end if;
end;
$$;

-- public.guard_profile_ai_enabled: as defined in 20261030000100_create_ai_gate.sql, with the marker on 1 raise.
create or replace function public.guard_profile_ai_enabled()
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
      using errcode = '42501', hint = 'user';
  end if;
  return new;
end;
$$;

-- public.guard_profile_avatar_path: as defined in 20261018000100_add_profile_avatars.sql, with the marker on 1 raise.
create or replace function public.guard_profile_avatar_path()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
    and new.avatar_path is distinct from (
      case when tg_op = 'UPDATE' then old.avatar_path else null end
    )
  then
    raise exception 'Profile pictures can only be set by the server.'
      using errcode = '42501', hint = 'user';
  end if;
  return new;
end;
$$;

-- public.guard_profile_managed_account: as defined in 20261016000600_add_managed_kid_accounts.sql, with the marker on 2 raises.
create or replace function public.guard_profile_managed_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.managed_by_family is not null or old.must_change_password then
      raise exception 'Kid accounts can only be removed by the server.'
        using errcode = '42501', hint = 'user';
    end if;
    return old;
  end if;

  if new.managed_by_family is distinct from (
      case when tg_op = 'UPDATE' then old.managed_by_family else null end
    )
    or new.must_change_password is distinct from (
      case when tg_op = 'UPDATE' then old.must_change_password else false end
    )
  then
    raise exception 'Kid account settings can only be changed by the server.'
      using errcode = '42501', hint = 'user';
  end if;
  return new;
end;
$$;

-- public.guard_profile_mcp_enabled: as defined in 20261023000200_create_mcp_access.sql, with the marker on 2 raises.
create or replace function public.guard_profile_mcp_enabled()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  reason text;
begin
  if current_user in ('authenticated', 'anon')
    and new.mcp_enabled
    and not (tg_op = 'UPDATE' and old.mcp_enabled)
  then
    reason := mcp_private.my_kid_block_reason();
    if reason = 'not_permitted' then
      raise exception 'A parent needs to turn on AI assistants for you.'
        using errcode = '42501', hint = 'user';
    elsif reason = 'email_required' then
      raise exception 'Add and confirm an email address in Settings to use AI assistants.'
        using errcode = '42501', hint = 'user';
    end if;
  end if;
  return new;
end;
$$;

-- public.guard_profile_username: as defined in 20261015182916_add_profile_identity.sql, with the marker on 1 raise.
create or replace function public.guard_profile_username()
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
      using errcode = '42501', hint = 'user';
  end if;
  return new;
end;
$$;

-- public.import_batches_guard: as defined in 20261029000100_create_statement_imports.sql, with the marker on 2 raises.
create or replace function public.import_batches_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.source_kind is distinct from old.source_kind
    or new.parser_id is distinct from old.parser_id
    or new.content_hash is distinct from old.content_hash
    or new.row_count is distinct from old.row_count
    or new.created_at is distinct from old.created_at
  then
    raise exception 'An import''s owner, source, content and creation time can''t be changed.'
      using errcode = '42501', hint = 'user';
  end if;

  if new.status is distinct from old.status
    and not (
      (old.status = 'draft' and new.status = 'confirmed')
      or (old.status = 'confirmed' and new.status = 'undone')
    )
  then
    raise exception 'An import can only go from draft to confirmed to undone.'
      using errcode = '55000', hint = 'user';
  end if;

  return new;
end;
$$;

-- public.list_family_invites: as defined in 20261016000900_add_invite_redemption.sql, with the marker on 1 raise.
create or replace function public.list_family_invites()
returns table(invite_id uuid, role text, permissions jsonb, created_by_name text, created_at timestamp with time zone, expires_at timestamp with time zone)
language plpgsql
stable security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  caller_family_id uuid;
begin
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent';

  if not found then
    raise exception 'Only parents can see the family''s invites.'
      using errcode = '42501', hint = 'user';
  end if;

  return query
  select
    i.id,
    i.role,
    i.permissions,
    coalesce(
      p.display_name,
      p.username,
      nullif(split_part(u.email, '@', 1), '')
    ),
    i.created_at,
    i.expires_at
  from public.family_invites i
  left join public.profiles p on p.id = i.created_by
  left join auth.users u on u.id = i.created_by
  where i.family_id = caller_family_id
    and family_private.is_invite_redeemable(i)
  order by i.created_at desc, i.id;
end;
$$;

-- public.preview_family_invite: as defined in 20261016000900_add_invite_redemption.sql, with the marker on 2 raises.
create or replace function public.preview_family_invite(p_code_hash text)
returns table(family_name text, inviter_name text, role text, permissions jsonb, expires_at timestamp with time zone)
language plpgsql
stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if app_private.current_user_id() is null then
    raise exception 'Sign in to use an invite code.'
      using errcode = '42501', hint = 'user';
  end if;

  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'The invite code is not valid.'
      using errcode = '23514', hint = 'user';
  end if;

  return query
  select
    f.name,
    coalesce(
      p.display_name,
      p.username,
      nullif(split_part(u.email, '@', 1), '')
    ),
    i.role,
    i.permissions,
    i.expires_at
  from public.family_invites i
  join public.families f on f.id = i.family_id
  left join public.profiles p on p.id = i.created_by
  left join auth.users u on u.id = i.created_by
  where i.code_hash = p_code_hash
    and family_private.is_invite_redeemable(i);
end;
$$;

-- public.redeem_family_invite: as defined in 20261016000900_add_invite_redemption.sql, with the marker on 5 raises.
create or replace function public.redeem_family_invite(p_code_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  invite_family_id uuid;
  invite public.family_invites;
  new_member_id uuid;
begin
  if caller_id is null then
    raise exception 'Sign in to use an invite code.'
      using errcode = '42501', hint = 'user';
  end if;

  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'The invite code is not valid.'
      using errcode = '23514', hint = 'user';
  end if;

  if exists (
    select 1
    from public.family_members m
    where m.user_id = caller_id
  ) then
    raise exception 'You''re already in a family.'
      using errcode = '23505', hint = 'user';
  end if;

  select i.family_id into invite_family_id
  from public.family_invites i
  where i.code_hash = p_code_hash;

  if invite_family_id is not null then
    perform 1
    from public.families f
    where f.id = invite_family_id
    for key share;
  end if;

  select i.* into invite
  from public.family_invites i
  where i.code_hash = p_code_hash
  for update;

  if invite.id is not null then
    perform 1
    from public.family_members m
    where m.family_id = invite.family_id
      and m.user_id = invite.created_by
    for share;
  end if;

  -- An unknown code leaves every field of invite null, which is not
  -- redeemable.
  if family_private.is_invite_redeemable(invite) is not true then
    raise exception 'This code isn''t valid anymore.'
      using errcode = 'P0002', hint = 'user';
  end if;

  begin
    insert into public.family_members (family_id, user_id, role)
    values (invite.family_id, caller_id, invite.role)
    returning id into new_member_id;
  exception
    when unique_violation then
      raise exception 'You''re already in a family.'
        using errcode = '23505', hint = 'user';
  end;

  if invite.role = 'kid' then
    insert into public.member_permissions (member_id, module, level)
    select new_member_id, e.module, e.level
    from jsonb_each_text(invite.permissions) as e(module, level);
  end if;

  update public.family_invites i
  set used_at = now(),
      used_by = caller_id
  where i.id = invite.id;

  return new_member_id;
end;
$$;

-- public.regenerate_mcp_token: as defined in 20261023000200_create_mcp_access.sql, with the marker on 3 raises.
create or replace function public.regenerate_mcp_token(p_id uuid, p_token_hash text, p_prefix text, p_expiry text)
returns table(id uuid, user_id uuid, name text, prefix text, created_at timestamp with time zone, regenerated_at timestamp with time zone, last_used_at timestamp with time zone, expires_at timestamp with time zone, revoked_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  new_expires_at timestamptz;
begin
  if not mcp_private.personal_tokens_allowed(caller_id) then
    raise exception 'Kids connect AI assistants through the app''s sign-in page, not with tokens.'
      using errcode = '42501', hint = 'user';
  end if;

  new_expires_at := mcp_private.token_expires_at(p_expiry);

  perform pg_advisory_xact_lock(hashtextextended('mcp_tokens:' || caller_id::text, 0));

  -- Locked, so a revoke can't land between this check and the update.
  perform 1
  from public.mcp_tokens t
  where t.id = p_id
    and t.user_id = caller_id
    and t.revoked_at is null
  for update;

  if not found then
    raise exception 'Token not found.'
      using errcode = 'P0002', hint = 'user';
  end if;

  if (
    select count(*)
    from public.mcp_tokens t
    where t.user_id = caller_id
      and t.id <> p_id
      and t.revoked_at is null
      and (t.expires_at is null or t.expires_at > now())
  ) >= 10 then
    raise exception 'You can have at most 10 personal tokens. Revoke one to create another.'
      using errcode = 'P0001', hint = 'user';
  end if;

  return query
  update public.mcp_tokens as t
  set token_hash = p_token_hash,
    prefix = p_prefix,
    expires_at = new_expires_at,
    regenerated_at = now(),
    last_used_at = null
  where t.id = p_id
  returning t.id, t.user_id, t.name, t.prefix, t.created_at, t.regenerated_at,
    t.last_used_at, t.expires_at, t.revoked_at;
end;
$$;

-- public.register_push_subscription: as defined in 20261025000100_create_reminders_and_notifications.sql, with the marker on 1 raise.
create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default ''::text)
returns public.push_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  registered public.push_subscriptions;
begin
  if caller_id is null then
    raise exception 'Sign in to enable notifications.'
      using errcode = '42501', hint = 'user';
  end if;

  delete from public.push_subscriptions s where s.endpoint = p_endpoint;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (caller_id, p_endpoint, p_p256dh, p_auth, coalesce(p_user_agent, ''))
  returning * into registered;

  return registered;
end;
$$;

-- public.reminders_guard: as defined in 20261025000100_create_reminders_and_notifications.sql, with the marker on 2 raises.
create or replace function public.reminders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if array_position(new.lead_minutes, null) is not null
    or cardinality(new.lead_minutes) <> (
      select count(distinct m) from unnest(new.lead_minutes) as m
    )
  then
    raise exception 'A reminder''s lead times must be distinct.'
      using errcode = '23514', hint = 'user';
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'A reminder can''t move to another user.'
        using errcode = '42501', hint = 'user';
    end if;

    new.updated_at := now();
  end if;

  return new;
end;
$$;

-- public.remove_family_member: as defined in 20261016000500_add_family_removal_functions.sql, with the marker on 3 raises.
create or replace function public.remove_family_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  caller_family_id uuid;
  caller_family_name text;
  target_user_id uuid;
begin
  select f.id, f.name into caller_family_id, caller_family_name
  from public.families f
  where f.creator_id = caller_id
  for share;

  if not found then
    raise exception 'Only the family''s creator can remove members.'
      using errcode = '42501', hint = 'user';
  end if;

  -- Lock the membership before deleting it, so a concurrent
  -- set_member_permissions (which locks it for no key update) and this
  -- removal apply one after the other. "For update" is the lock the delete
  -- takes anyway; taking it here avoids upgrading a weaker lock later.
  select m.user_id into target_user_id
  from public.family_members m
  where m.id = p_member_id
    and m.family_id = caller_family_id
  for update;

  if not found then
    raise exception 'That family member wasn''t found.'
      using errcode = 'P0002', hint = 'user';
  end if;

  if target_user_id = caller_id then
    raise exception 'You can''t remove yourself from a family you created. Delete the family instead.'
      using errcode = '42501', hint = 'user';
  end if;

  delete from public.family_members m
  where m.id = p_member_id;

  insert into public.account_notices (user_id, kind, family_name)
  values (target_user_id, 'removed_from_family', caller_family_name);
end;
$$;

-- public.require_password_change: as defined in 20261016000600_add_managed_kid_accounts.sql, with the marker on 3 raises.
create or replace function public.require_password_change(p_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_family_id uuid;
  target_role text;
  target_user_id uuid;
begin
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent';

  if not found then
    raise exception 'Only parents can reset a kid''s password.'
      using errcode = '42501', hint = 'user';
  end if;

  -- Hold off a concurrent role change or removal until we commit.
  select m.role, m.user_id into target_role, target_user_id
  from public.family_members m
  where m.id = p_member_id
    and m.family_id = caller_family_id
  for no key update;

  if not found then
    raise exception 'That family member wasn''t found.'
      using errcode = 'P0002', hint = 'user';
  end if;

  if target_role <> 'kid' then
    raise exception 'Only a kid''s password can be reset.'
      using errcode = '42501', hint = 'user';
  end if;

  insert into public.profiles (id, must_change_password)
  values (target_user_id, true)
  on conflict (id) do update
  set must_change_password = true;

  return target_user_id;
end;
$$;

-- public.revoke_calendar_feed: as defined in 20261028000100_create_family_calendar.sql, with the marker on 1 raise.
create or replace function public.revoke_calendar_feed()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
begin
  if caller_id is null then
    raise exception 'Sign in to turn off your calendar link.'
      using errcode = '42501', hint = 'user';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('calendar_feeds:' || caller_id::text, 0));

  update public.calendar_feeds f
  set revoked_at = now()
  where f.user_id = caller_id
    and f.revoked_at is null;

  return found;
end;
$$;

-- public.revoke_family_invite: as defined in 20261016000700_create_family_invites.sql, with the marker on 2 raises.
create or replace function public.revoke_family_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_family_id uuid;
begin
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent';

  if not found then
    raise exception 'Only parents can revoke invites.'
      using errcode = '42501', hint = 'user';
  end if;

  -- Lock the invite so a revoke and a redeem (F09, which also locks it) apply
  -- one after the other: the invite ends up either used or revoked, not both.
  perform 1
  from public.family_invites i
  where i.id = p_invite_id
    and i.family_id = caller_family_id
  for update;

  if not found then
    raise exception 'That invite wasn''t found.'
      using errcode = 'P0002', hint = 'user';
  end if;

  update public.family_invites i
  set revoked_at = now()
  where i.id = p_invite_id
    and i.revoked_at is null
    and i.used_at is null;
end;
$$;

-- public.send_test_notification: as defined in 20261025000100_create_reminders_and_notifications.sql, with the marker on 1 raise.
create or replace function public.send_test_notification()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
begin
  if caller_id is null then
    raise exception 'Sign in to send a test notification.'
      using errcode = '42501', hint = 'user';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('send_test_notification:' || caller_id::text, 0));

  if exists (
    select 1
    from public.notifications n
    where n.user_id = caller_id
      and n.kind = 'test'
      and n.created_at > now() - interval '1 minute'
  ) then
    return false;
  end if;

  insert into public.notifications (user_id, kind, payload)
  values (
    caller_id,
    'test',
    jsonb_build_object(
      'title', 'Test notification',
      'body', 'Notifications work on this device.',
      'url', '/settings/notifications',
      'tag', 'test'
    )
  );

  return true;
end;
$$;

-- public.set_app_flag: as defined in 20261030000100_create_ai_gate.sql, with the marker on 2 raises.
create or replace function public.set_app_flag(p_key text, p_value jsonb, p_user_id uuid default null::uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_value is null then
    raise exception 'A flag needs a value.'
      using errcode = '22023', hint = 'user';
  end if;

  update public.app_flags f
  set value = p_value,
      updated_at = now(),
      updated_by = p_user_id
  where f.key = p_key;

  if not found then
    raise exception 'That flag doesn''t exist.'
      using errcode = 'P0002', hint = 'user';
  end if;
end;
$$;

-- public.set_member_color: as defined in 20261016001100_add_member_color.sql, with the marker on 4 raises.
create or replace function public.set_member_color(p_member_id uuid, p_color smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_family_id uuid;
begin
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent';

  if not found then
    raise exception 'Only parents can choose member colours.'
      using errcode = '42501', hint = 'user';
  end if;

  perform 1
  from public.family_members m
  where m.id = p_member_id
    and m.family_id = caller_family_id
  for no key update;

  if not found then
    raise exception 'That family member wasn''t found.'
      using errcode = 'P0002', hint = 'user';
  end if;

  if p_color is not null and p_color not between 1 and 8 then
    raise exception 'Choose one of the eight colours.'
      using errcode = '23514', hint = 'user';
  end if;

  begin
    update public.family_members m
    set color = p_color
    where m.id = p_member_id;
  exception when unique_violation then
    raise exception 'Another family member already has that colour.'
      using errcode = '23505', hint = 'user';
  end;
end;
$$;

-- public.set_member_permissions: as defined in 20261016000300_add_member_update_functions.sql, with the marker on 4 raises.
create or replace function public.set_member_permissions(p_member_id uuid, p_permissions jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_family_id uuid;
  target_role text;
begin
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent';

  if not found then
    raise exception 'Only parents can change a kid''s permissions.'
      using errcode = '42501', hint = 'user';
  end if;

  -- Lock the kid's membership so two parents saving at the same time apply
  -- one after the other, instead of both deleting and then both inserting.
  -- It also holds off a concurrent role change or removal until we commit.
  select m.role into target_role
  from public.family_members m
  where m.id = p_member_id
    and m.family_id = caller_family_id
  for no key update;

  if not found then
    raise exception 'That family member wasn''t found.'
      using errcode = 'P0002', hint = 'user';
  end if;

  if target_role <> 'kid' then
    raise exception 'Parents always have full access, so their permissions can''t be changed.'
      using errcode = '42501', hint = 'user';
  end if;

  if not family_private.is_valid_permissions(p_permissions) then
    raise exception 'Choose an allowed level for every module.'
      using errcode = '23514', hint = 'user';
  end if;

  delete from public.member_permissions p
  where p.member_id = p_member_id;

  insert into public.member_permissions (member_id, module, level)
  select p_member_id, e.module, e.level
  from jsonb_each_text(p_permissions) as e(module, level);
end;
$$;

-- public.todos_guard: as defined in 20261024000100_create_todos.sql, with the marker on 3 raises.
create or replace function public.todos_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  api_role boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'UPDATE' then
    if new.family_id is distinct from old.family_id then
      raise exception 'A to-do can''t move to another family.'
        using errcode = '42501', hint = 'user';
    end if;

    if api_role and new.created_by is distinct from old.created_by then
      raise exception 'A to-do''s creator can''t be changed.'
        using errcode = '42501', hint = 'user';
    end if;

    new.updated_at := now();
  end if;

  if new.assignee_member_id is not null
    and (tg_op = 'INSERT' or new.assignee_member_id is distinct from old.assignee_member_id)
    and not exists (
      select 1
      from public.family_members m
      where m.id = new.assignee_member_id
        and m.family_id = new.family_id
    )
  then
    raise exception 'A to-do can only be assigned to a member of its family.'
      using errcode = '23514', hint = 'user';
  end if;

  if new.status <> 'done' then
    new.completed_at := null;
    new.completed_by := null;
  elsif tg_op = 'INSERT' or old.status <> 'done' then
    new.completed_at := now();
    new.completed_by := app_private.current_user_id();
  elsif api_role then
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  end if;

  return new;
end;
$$;

-- public.undo_import_batch: as defined in 20261029000100_create_statement_imports.sql, with the marker on 2 raises.
create or replace function public.undo_import_batch(p_batch_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  batch public.import_batches;
  removed integer;
begin
  select * into batch
  from public.import_batches b
  where b.id = p_batch_id
  for update;

  if not found then
    raise exception 'That import wasn''t found.'
      using errcode = 'P0002', hint = 'user';
  end if;

  if batch.status <> 'confirmed' then
    raise exception 'Only a confirmed import can be undone.'
      using errcode = '55000', hint = 'user';
  end if;

  with gone as (
    delete from public.expenses e
    using public.import_expenses l
    where l.expense_id = e.id
      and l.batch_id = p_batch_id
      and e.user_id = caller_id
    returning e.id
  )
  select count(*)::integer into removed from gone;

  update public.import_batches b
  set status = 'undone',
      undone_at = now()
  where b.id = p_batch_id;

  return removed;
end;
$$;

-- public.update_calendar_events: as defined in 20261028000100_create_family_calendar.sql, with the marker on 4 raises.
create or replace function public.update_calendar_events(p_rows jsonb, p_member_ids uuid[])
returns setof public.calendar_events
language plpgsql
set search_path = ''
as $$
declare
  edit jsonb;
  edit_id uuid;
  updated_ids uuid[] := '{}';
begin
  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
  then
    raise exception 'Choose the events to change.'
      using errcode = '22023', hint = 'user';
  end if;

  if p_member_ids is not null
    and (cardinality(p_member_ids) = 0 or array_position(p_member_ids, null) is not null)
  then
    raise exception 'Choose who the event is for.'
      using errcode = '22023', hint = 'user';
  end if;

  for edit in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(edit) <> 'object' or not (edit ? 'id') then
      raise exception 'Every event to change needs an id.'
        using errcode = '22023', hint = 'user';
    end if;
    edit_id := (edit ->> 'id')::uuid;

    update public.calendar_events c
    set title = case when edit ? 'title' then edit ->> 'title' else c.title end,
      notes = case when edit ? 'notes' then edit ->> 'notes' else c.notes end,
      location = case when edit ? 'location' then edit ->> 'location' else c.location end,
      all_day = case when edit ? 'all_day' then (edit ->> 'all_day')::boolean else c.all_day end,
      starts_at = case when edit ? 'starts_at' then (edit ->> 'starts_at')::timestamptz else c.starts_at end,
      ends_at = case when edit ? 'ends_at' then (edit ->> 'ends_at')::timestamptz else c.ends_at end,
      timezone = case when edit ? 'timezone' then edit ->> 'timezone' else c.timezone end,
      notify_at = case when edit ? 'notify_at' then (edit ->> 'notify_at')::timestamptz else c.notify_at end,
      notified_at = case when edit ? 'notified_at' then (edit ->> 'notified_at')::timestamptz else c.notified_at end
    where c.id = edit_id;

    if not found then
      raise exception 'That event wasn''t found.'
        using errcode = 'P0002', hint = 'user';
    end if;

    updated_ids := updated_ids || edit_id;
  end loop;

  if p_member_ids is not null then
    delete from public.calendar_event_attendees a
    where a.event_id = any(updated_ids)
      and a.member_id <> all(p_member_ids);

    insert into public.calendar_event_attendees (event_id, member_id)
    select e.id, m.member_id
    from (
      select c.id, c.series_index
      from public.calendar_events c
      where c.id = any(updated_ids)
    ) e
    cross join (select distinct unnest(p_member_ids) as member_id) m
    order by e.series_index, m.member_id
    on conflict do nothing;
  end if;

  return query
  select e.*
  from public.calendar_events e
  where e.id = any(updated_ids)
  order by e.series_id, e.series_index;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Trigger functions are never callable directly
-- ---------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon, authenticated;
