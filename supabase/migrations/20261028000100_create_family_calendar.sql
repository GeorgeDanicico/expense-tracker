begin;

-- The family calendar (docs/calendar-plan.md, C1).
--
-- 1. public.calendar_events: one row per event occurrence. Every family has
--    exactly one calendar, so an event belongs to a family directly; there is
--    no calendars table. A repeat is stored as separate rows linked by
--    series_id (at most 10), so there is no rule to expand on read.
-- 2. public.calendar_event_attendees: the members an event is for. An event is
--    yours when you attend it; that one rule decides your feed and your
--    notifications.
-- 3. RLS: every member of the family, parent or kid, sees and changes every
--    event and attendee of their family. There are no role checks.
-- 4. calendar_events_guard and the attendee triggers: bookkeeping that every
--    write path agrees on.
-- 5. create_calendar_events() and update_calendar_events(): save a series and
--    its attendees in one transaction (security invoker, so RLS applies).
-- 6. public.calendar_feeds and the feed functions: one private, revocable
--    iCalendar link per user, read by its hashed token only.
-- 7. Notifications: the event and event_added kinds, the Calendar switch,
--    claim_due_calendar_events() for the worker, and the trigger that queues
--    "X added you".
--
-- Same conventions as the family and to-do tables: the caller is
-- app_private.current_user_id(), policies wrap helpers in a sub-select so
-- they run once per query, set search_path = '' and fully qualified names.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  series_id uuid not null default gen_random_uuid(),       -- shared by a repeat's occurrences
  series_index smallint not null default 1 check (series_index between 1 and 10),
  series_repeat text not null default 'none' check (series_repeat in ('none', 'daily', 'weekly')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  location text not null default '' check (char_length(location) <= 200),
  all_day boolean not null default false,
  starts_at timestamptz not null,                          -- all-day: local midnight of the first day
  ends_at timestamptz not null,                            -- all-day: local midnight after the last day
  timezone text not null default 'Europe/Bucharest',
  notify_at timestamptz,
  notified_at timestamptz,
  notify_locked_until timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, series_index),
  check (ends_at > starts_at and ends_at <= starts_at + interval '31 days'),
  check (series_repeat <> 'none' or series_index = 1)      -- a one-off is the only row of its series
);

-- Serves the range query (a family's events overlapping a window) and the
-- family cascade. The unique (series_id, series_index) constraint already
-- indexes series_id, so the series lookups need no index of their own.
create index calendar_events_family_id_starts_at_idx
  on public.calendar_events (family_id, starts_at);
-- Serves claim_due_calendar_events().
create index calendar_events_notify_at_idx
  on public.calendar_events (notify_at)
  where notified_at is null;

comment on table public.calendar_events is
  'The family calendar: one row per event occurrence. Every member of the family may read and change every event of their family.';
comment on column public.calendar_events.series_id is
  'Shared by the occurrences of a repeat; a one-off is the only row of its own series.';
comment on column public.calendar_events.series_index is
  'This occurrence''s position in its series, 1 to 10.';
comment on column public.calendar_events.series_repeat is
  'none (a one-off), daily or weekly. Fixed when the series is created.';
comment on column public.calendar_events.starts_at is
  'The start instant. For an all-day event: local midnight (in timezone) of the first day.';
comment on column public.calendar_events.ends_at is
  'The end instant, after starts_at and at most 31 days later. For an all-day event: local midnight (in timezone) after the last day.';
comment on column public.calendar_events.timezone is
  'IANA time zone, for display and for working out the repeats. Only Europe/Bucharest is offered for now.';
comment on column public.calendar_events.notify_at is
  'When the worker notifies the attendees: 30 minutes before a timed event, 07:30 local on the first day of an all-day event. Set by the API on every save; null when that time had already passed.';
comment on column public.calendar_events.notified_at is
  'When the worker notified the attendees; the API clears it when it moves notify_at.';
comment on column public.calendar_events.notify_locked_until is
  'Lease set by claim_due_calendar_events(); another worker skips the event until then.';
comment on column public.calendar_events.created_by is
  'The user who added the event; null once that user is deleted. Never changes otherwise.';

create table public.calendar_event_attendees (
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete cascade,
  primary key (event_id, member_id)
);

-- The primary key serves the event cascade. This one serves the member
-- cascade (leaving a family removes you as an attendee), the member filter
-- and the feed.
create index calendar_event_attendees_member_id_idx
  on public.calendar_event_attendees (member_id);

comment on table public.calendar_event_attendees is
  'The members an event is for. An event is a member''s when they attend it. Rows go when the event or the member does.';

create table public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_fetched_at timestamptz,
  revoked_at timestamptz
);

-- One live link per user (revoked rows are few, so the user cascade needs no
-- index of its own).
create unique index calendar_feeds_one_live_per_user_idx
  on public.calendar_feeds (user_id)
  where revoked_at is null;

comment on table public.calendar_feeds is
  'A user''s calendar feed links, stored as a SHA-256 hash of the secret in the URL. Revoked rows are kept for the record. Written only by the calendar feed functions.';
comment on column public.calendar_feeds.token_hash is
  'Lowercase hex SHA-256 of the whole token. Not readable by signed-in users.';
comment on column public.calendar_feeds.last_fetched_at is
  'When a calendar app last fetched the feed, to within 5 minutes.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.calendar_events enable row level security;
alter table public.calendar_event_attendees enable row level security;
alter table public.calendar_feeds enable row level security;

revoke all on table public.calendar_events, public.calendar_event_attendees, public.calendar_feeds
  from public, anon, authenticated;
grant select, insert, update, delete on table public.calendar_events to authenticated;
-- An attendee row has nothing to update: a member is added or removed.
grant select, insert, delete on table public.calendar_event_attendees to authenticated;
-- Reads only, and never the hash, so no API bug can send one to the browser.
-- Writes go through create_calendar_feed and revoke_calendar_feed.
grant select (id, user_id, created_at, last_fetched_at, revoked_at)
  on table public.calendar_feeds to authenticated;

create policy calendar_events_select_family on public.calendar_events
for select to authenticated
using (family_id = (select family_private.my_family_id()));

create policy calendar_events_insert_family on public.calendar_events
for insert to authenticated
with check (
  family_id = (select family_private.my_family_id())
  and created_by = (select app_private.current_user_id())
);

create policy calendar_events_update_family on public.calendar_events
for update to authenticated
using (family_id = (select family_private.my_family_id()))
with check (family_id = (select family_private.my_family_id()));

create policy calendar_events_delete_family on public.calendar_events
for delete to authenticated
using (family_id = (select family_private.my_family_id()));

-- Through the parent event, which the caller's own events policy already
-- limits to their family.
create policy calendar_event_attendees_select_family on public.calendar_event_attendees
for select to authenticated
using (exists (
  select 1 from public.calendar_events e
  where e.id = event_id
    and e.family_id = (select family_private.my_family_id())
));

create policy calendar_event_attendees_insert_family on public.calendar_event_attendees
for insert to authenticated
with check (exists (
  select 1 from public.calendar_events e
  where e.id = event_id
    and e.family_id = (select family_private.my_family_id())
));

create policy calendar_event_attendees_delete_family on public.calendar_event_attendees
for delete to authenticated
using (exists (
  select 1 from public.calendar_events e
  where e.id = event_id
    and e.family_id = (select family_private.my_family_id())
));

create policy calendar_feeds_select_own on public.calendar_feeds
for select to authenticated
using (user_id = (select app_private.current_user_id()));

-- ---------------------------------------------------------------------------
-- Bookkeeping triggers
-- ---------------------------------------------------------------------------

-- Security invoker: current_user tells the API roles apart from trusted
-- writers (as in todos_guard). Foreign key actions run as the table owner, so
-- when a user is deleted, `on delete set null` may clear created_by; the API
-- roles may not change it.
--
-- On update: family_id, series_id, series_index and series_repeat never
-- change (42501), created_by never changes for the API roles (42501), and
-- updated_at = now() (which the feed publishes as LAST-MODIFIED). A change to
-- only the worker's bookkeeping (notified_at, notify_locked_until) leaves
-- updated_at alone, so claiming an event doesn't make calendar apps refetch it.
create function public.calendar_events_guard()
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
        using errcode = '42501';
    end if;

    if new.series_id is distinct from old.series_id
      or new.series_index is distinct from old.series_index
      or new.series_repeat is distinct from old.series_repeat
    then
      raise exception 'An event''s series and repeat can''t be changed.'
        using errcode = '42501';
    end if;

    if api_role and new.created_by is distinct from old.created_by then
      raise exception 'An event''s creator can''t be changed.'
        using errcode = '42501';
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

revoke all on function public.calendar_events_guard() from public, anon, authenticated;

comment on function public.calendar_events_guard() is
  'Trigger: family_id and the series columns never change and created_by never changes for the API roles (42501); sets updated_at unless only the worker''s notification bookkeeping changed.';

create trigger calendar_events_guard
before insert or update on public.calendar_events
for each row execute function public.calendar_events_guard();

-- Security invoker, so the lookup reads family_members under the caller's own
-- policy, which shows only the caller's family and so can't be used to probe
-- other families' member ids. The attendee must be a member of the event's
-- family (23514).
create function public.calendar_event_attendees_guard()
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
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.calendar_event_attendees_guard() from public, anon, authenticated;

comment on function public.calendar_event_attendees_guard() is
  'Trigger: the attendee must be a member of the event''s family (23514).';

create trigger calendar_event_attendees_guard
before insert on public.calendar_event_attendees
for each row execute function public.calendar_event_attendees_guard();

-- Adding or removing an attendee touches the event, so the feed's
-- LAST-MODIFIED moves and calendar apps pick the change up. When the event
-- itself is being deleted there is nothing left to touch.
create function public.calendar_event_attendees_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.calendar_events e
  set updated_at = now()
  where e.id = coalesce(new.event_id, old.event_id);

  return null;
end;
$$;

revoke all on function public.calendar_event_attendees_touch() from public, anon, authenticated;

comment on function public.calendar_event_attendees_touch() is
  'Trigger: sets updated_at on the event when an attendee is added or removed.';

create trigger calendar_event_attendees_touch
after insert or delete on public.calendar_event_attendees
for each row execute function public.calendar_event_attendees_touch();

-- ---------------------------------------------------------------------------
-- Saving a series
-- ---------------------------------------------------------------------------

-- Inserts the 1-10 rows in p_rows and the same attendees on each, in one
-- transaction, and returns the rows by series_index. Security invoker, so RLS
-- applies: 42501 without a family.
--
-- Each element of p_rows has title, starts_at and ends_at, and optionally
-- notes, location, all_day, timezone, notify_at, series_id (one is generated
-- and shared by every row that has none), series_index (default 1) and
-- series_repeat (default 'none'). family_id and created_by are the caller's.
-- p_member_ids must hold at least one member of the caller's family. The
-- events go in first, so the "added you" notification (the attendee trigger)
-- sees the whole series.
--
-- Errors: 22023 for no rows, more than 10 rows or no attendees; the table's
-- checks (23514, 23502) and the attendee guard (23514) abort the whole call,
-- so a failing row inserts nothing.
create function public.create_calendar_events(p_rows jsonb, p_member_ids uuid[])
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
      using errcode = '42501';
  end if;

  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 10
  then
    raise exception 'An event series has between 1 and 10 events.'
      using errcode = '22023';
  end if;

  if p_member_ids is null
    or cardinality(p_member_ids) = 0
    or array_position(p_member_ids, null) is not null
  then
    raise exception 'Choose who the event is for.'
      using errcode = '22023';
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

revoke all on function public.create_calendar_events(jsonb, uuid[]) from public, anon;
grant execute on function public.create_calendar_events(jsonb, uuid[]) to authenticated;

comment on function public.create_calendar_events(jsonb, uuid[]) is
  'Inserts the 1-10 event rows in p_rows and the same attendees on each, atomically, as the caller (RLS applies), and returns the rows. 42501 without a family, 22023 for a bad row count or no attendees, 23514 for a bad row or an attendee outside the family.';

-- Updates the rows in p_rows and, when p_member_ids isn't null, replaces their
-- attendees with exactly those members, in one transaction. Returns the
-- updated rows by series, then series_index. Security invoker, so RLS applies.
--
-- Each element of p_rows has the id of the row and the values to set; a key
-- that is absent keeps the stored value, and one that is null sets null (only
-- notify_at and notified_at may be). The settable keys are title, notes,
-- location, all_day, starts_at, ends_at, timezone, notify_at and notified_at.
-- The family, creator and series columns never change.
--
-- Attendees are replaced by difference: members already attending stay (so a
-- series' "added you" notification doesn't repeat), the others go, and the new
-- ones are added.
--
-- Errors: 22023 for no rows, a row without an id, or an empty attendee list;
-- P0002 when any row isn't visible to the caller (another family's, or
-- already deleted), and then nothing changes.
create function public.update_calendar_events(p_rows jsonb, p_member_ids uuid[])
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
      using errcode = '22023';
  end if;

  if p_member_ids is not null
    and (cardinality(p_member_ids) = 0 or array_position(p_member_ids, null) is not null)
  then
    raise exception 'Choose who the event is for.'
      using errcode = '22023';
  end if;

  for edit in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(edit) <> 'object' or not (edit ? 'id') then
      raise exception 'Every event to change needs an id.'
        using errcode = '22023';
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
        using errcode = 'P0002';
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

revoke all on function public.update_calendar_events(jsonb, uuid[]) from public, anon;
grant execute on function public.update_calendar_events(jsonb, uuid[]) to authenticated;

comment on function public.update_calendar_events(jsonb, uuid[]) is
  'Updates the event rows in p_rows (id plus the values to set; absent keys keep their value) and, when p_member_ids isn''t null, replaces their attendees by difference, atomically, as the caller (RLS applies). P0002 when any row isn''t visible; 22023 for no rows or an empty attendee list.';

-- ---------------------------------------------------------------------------
-- The calendar feed
-- ---------------------------------------------------------------------------

-- Creates the caller's feed link from the hash of a secret the server made,
-- revoking their live link first, so a user has at most one. The advisory lock
-- serialises one user's calls. Returns the new row without the hash. 42501
-- without a user; 23514 for a hash that isn't 64 lowercase hex characters.
create function public.create_calendar_feed(p_token_hash text)
returns table (
  id uuid,
  user_id uuid,
  created_at timestamptz,
  last_fetched_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
begin
  if caller_id is null then
    raise exception 'Sign in to create a calendar link.'
      using errcode = '42501';
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

-- Revokes the caller's live feed link. False, changing nothing, when they have
-- none. 42501 without a user.
create function public.revoke_calendar_feed()
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
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('calendar_feeds:' || caller_id::text, 0));

  update public.calendar_feeds f
  set revoked_at = now()
  where f.user_id = caller_id
    and f.revoked_at is null;

  return found;
end;
$$;

-- The feed for a token hash, for the feed route (which has no session, so this
-- is granted to anon). Null for an unknown or revoked hash. For a live one:
--   { familyName, events: [{ id, title, notes, location, allDay, startsAt,
--     endsAt, timezone, updatedAt }] }
-- with the times as UTC ISO 8601 strings, holding only the events the owner
-- attends that ended at most 90 days ago, by start. When the owner is in no
-- family, familyName is null and events is empty. It sets last_fetched_at,
-- at most every 5 minutes.
--
-- Security definer, and it reads nothing but the token owner's own events, so
-- a bug in the route can't widen it. Anyone holding the hash's secret already
-- has the feed; the hash alone is not enough to ask for it, since the caller
-- must send the hash of the secret they hold.
create function public.calendar_feed(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  feed_user_id uuid;
  member_row record;
  family_name text;
  events_json jsonb;
begin
  select f.user_id into feed_user_id
  from public.calendar_feeds f
  where f.token_hash = p_token_hash
    and f.revoked_at is null;

  if not found then
    return null;
  end if;

  update public.calendar_feeds f
  set last_fetched_at = now()
  where f.token_hash = p_token_hash
    and f.revoked_at is null
    and (f.last_fetched_at is null or f.last_fetched_at < now() - interval '5 minutes');

  select m.id, m.family_id into member_row
  from public.family_members m
  where m.user_id = feed_user_id;

  if not found then
    return jsonb_build_object('familyName', null, 'events', '[]'::jsonb);
  end if;

  select fam.name into family_name
  from public.families fam
  where fam.id = member_row.family_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'title', e.title,
      'notes', e.notes,
      'location', e.location,
      'allDay', e.all_day,
      'startsAt', to_char(e.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'endsAt', to_char(e.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'timezone', e.timezone,
      'updatedAt', to_char(e.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
    order by e.starts_at, e.id
  ), '[]'::jsonb)
  into events_json
  from public.calendar_events e
  join public.calendar_event_attendees a on a.event_id = e.id
  where a.member_id = member_row.id
    and e.ends_at > now() - interval '90 days';

  return jsonb_build_object('familyName', family_name, 'events', events_json);
end;
$$;

revoke all on function public.create_calendar_feed(text) from public, anon;
grant execute on function public.create_calendar_feed(text) to authenticated;
revoke all on function public.revoke_calendar_feed() from public, anon;
grant execute on function public.revoke_calendar_feed() to authenticated;
revoke all on function public.calendar_feed(text) from public;
grant execute on function public.calendar_feed(text) to anon, authenticated;

comment on function public.create_calendar_feed(text) is
  'Creates the caller''s calendar feed link from the SHA-256 hash of its secret, revoking the live one first. Returns the row without the hash. 42501 without a user, 23514 for a malformed hash.';
comment on function public.revoke_calendar_feed() is
  'Revokes the caller''s live calendar feed link. False when there was none. 42501 without a user.';
comment on function public.calendar_feed(text) is
  'The feed for a token hash: { familyName, events } with only the events the token''s owner attends that ended at most 90 days ago; null for an unknown or revoked hash; an empty list once the owner is in no family. Sets last_fetched_at at most every 5 minutes. Granted to anon.';

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (
    kind in ('reminder', 'todo_assigned', 'todo_due', 'event', 'event_added', 'test')
  );

alter table public.notification_settings
  add column calendar_enabled boolean not null default true;

comment on column public.notification_settings.calendar_enabled is
  'Whether calendar notifications (event, event_added) are sent.';

-- Claims up to p_batch events whose notify_at has passed, that haven't been
-- notified and aren't leased by another worker, leases them for 2 minutes
-- (FOR UPDATE SKIP LOCKED) and returns them, oldest notify_at first, each with
-- the user ids of its attendees. An event that has already ended (the worker
-- was down) is marked notified here and not returned, so nothing is sent for
-- it. service_role only.
create function public.claim_due_calendar_events(p_batch integer)
returns table (
  id uuid,
  series_id uuid,
  family_id uuid,
  title text,
  location text,
  all_day boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  notify_at timestamptz,
  attendee_user_ids uuid[]
)
language sql
set search_path = ''
as $$
  with expired as (
    update public.calendar_events x
    set notified_at = now()
    where x.id in (
      select c.id
      from public.calendar_events c
      where c.notify_at is not null
        and c.notify_at <= now()
        and c.notified_at is null
        and c.ends_at <= now()
      for update skip locked
    )
    returning x.id
  ),
  claimed as (
    update public.calendar_events e
    set notify_locked_until = now() + interval '2 minutes'
    where e.id in (
      select c.id
      from public.calendar_events c
      where c.notify_at is not null
        and c.notify_at <= now()
        and c.notified_at is null
        and c.ends_at > now()
        and (c.notify_locked_until is null or c.notify_locked_until <= now())
      order by c.notify_at
      limit greatest(p_batch, 0)
      for update skip locked
    )
    returning e.*
  )
  select cl.id, cl.series_id, cl.family_id, cl.title, cl.location, cl.all_day,
    cl.starts_at, cl.ends_at, cl.timezone, cl.notify_at,
    coalesce((
      select array_agg(m.user_id order by m.user_id)
      from public.calendar_event_attendees a
      join public.family_members m on m.id = a.member_id
      where a.event_id = cl.id
    ), '{}'::uuid[]) as attendee_user_ids
  from claimed cl
  order by cl.notify_at, cl.id
$$;

revoke all on function public.claim_due_calendar_events(integer) from public, anon, authenticated;
grant execute on function public.claim_due_calendar_events(integer) to service_role;

comment on function public.claim_due_calendar_events(integer) is
  'Worker: leases up to p_batch events whose notify_at has passed for 2 minutes (FOR UPDATE SKIP LOCKED) and returns them with their attendees'' user ids; marks already-ended ones notified without returning them. service_role only.';

-- Security definer, because users can't write the outbox. When a member is
-- added to an event, queues an event_added row for that member's user, unless
-- that user is the caller (adding yourself). It is once per series and user:
-- dedupe_key = event_added:<series_id>:<user id>, with on conflict do nothing,
-- so adding someone to a 10-day series, or to each of its events one by one,
-- notifies them once. The adder's name is worked out as get_family() does:
-- display_name, else username, else the part of the email before the '@'.
create function public.calendar_event_attendees_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  attendee_user_id uuid;
  adder_name text;
  event_row public.calendar_events;
  series_length integer;
begin
  select m.user_id into attendee_user_id
  from public.family_members m
  where m.id = new.member_id;

  if attendee_user_id is null or attendee_user_id is not distinct from caller_id then
    return null;
  end if;

  select * into event_row
  from public.calendar_events e
  where e.id = new.event_id;

  if not found then
    return null;
  end if;

  select count(*)::integer into series_length
  from public.calendar_events e
  where e.series_id = event_row.series_id;

  select coalesce(p.display_name, p.username, nullif(split_part(u.email, '@', 1), ''))
  into adder_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = caller_id;

  insert into public.notifications (user_id, kind, payload, dedupe_key)
  values (
    attendee_user_id,
    'event_added',
    jsonb_build_object(
      'title', coalesce(adder_name, 'Someone') || ' added you',
      'body', event_row.title,
      'url', '/calendar?event=' || event_row.id::text,
      'tag', 'event_added:' || event_row.series_id::text,
      'eventId', event_row.id,
      'eventTitle', event_row.title,
      'startsAt', to_char(event_row.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'allDay', event_row.all_day,
      'timezone', event_row.timezone,
      'seriesRepeat', event_row.series_repeat,
      'seriesLength', series_length,
      'adderName', adder_name
    ),
    'event_added:' || event_row.series_id::text || ':' || attendee_user_id::text
  )
  on conflict (dedupe_key) do nothing;

  return null;
end;
$$;

revoke all on function public.calendar_event_attendees_notify() from public, anon, authenticated;

comment on function public.calendar_event_attendees_notify() is
  'Trigger: queues one event_added notification per series and user for a member added to an event by someone else. Nothing when you add yourself.';

create trigger calendar_event_attendees_notify
after insert on public.calendar_event_attendees
for each row execute function public.calendar_event_attendees_notify();

commit;
