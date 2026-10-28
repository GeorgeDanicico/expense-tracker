begin;
create extension if not exists pgtap;
select plan(45);

-- C1 (docs/calendar-plan.md): create_calendar_events() and
-- update_calendar_events(), which save a series and its attendees atomically.
--
-- Users (prefix d9200000), with user number NN:
--   family A ('Family A', ...00fa): 01 creator parent, 02 kid
--   family B ('Family B', ...00fb): 03 creator parent
--   04 has no family.
-- Member id of user NN: ...0000000f00NN. Fixture event ids: ...0000000e00NN.
--
-- Fixture events (inserted as the table owner): 01 family A, a one-off for
-- member 01; 02 family B, a one-off for member 03.

create function pg_temp.uid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d9200000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.mid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d9200000-0000-4000-8000-0000000f00' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.eid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d9200000-0000-4000-8000-0000000e00' || lpad(n::text, 2, '0'))::uuid
$$;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'c1-save-' || n || '@example.test', 'not-used', now(), '{}', '{}', now(), now()
from generate_series(1, 4) as n
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('d9200000-0000-4000-8000-0000000000fa', 'Family A', pg_temp.uid(1)),
  ('d9200000-0000-4000-8000-0000000000fb', 'Family B', pg_temp.uid(3));

insert into public.family_members (id, family_id, user_id, role) values
  (pg_temp.mid(1), 'd9200000-0000-4000-8000-0000000000fa', pg_temp.uid(1), 'parent'),
  (pg_temp.mid(2), 'd9200000-0000-4000-8000-0000000000fa', pg_temp.uid(2), 'kid'),
  (pg_temp.mid(3), 'd9200000-0000-4000-8000-0000000000fb', pg_temp.uid(3), 'parent');

insert into public.calendar_events (id, family_id, title, starts_at, ends_at, created_by) values
  (pg_temp.eid(1), 'd9200000-0000-4000-8000-0000000000fa', 'Swimming',
    '2026-11-03 09:00+02', '2026-11-03 10:00+02', pg_temp.uid(1)),
  (pg_temp.eid(2), 'd9200000-0000-4000-8000-0000000000fb', 'Dentist',
    '2026-11-03 09:00+02', '2026-11-03 10:00+02', pg_temp.uid(3));
insert into public.calendar_event_attendees (event_id, member_id) values
  (pg_temp.eid(1), pg_temp.mid(1)),
  (pg_temp.eid(2), pg_temp.mid(3));

-- ---------------------------------------------------------------------------
-- Test helpers
-- ---------------------------------------------------------------------------

-- Act as user n (null: a session without a user).
create function pg_temp.act_as(n integer)
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    case when n is null then '{"role":"authenticated"}'
      else json_build_object('sub', pg_temp.uid(n), 'role', 'authenticated')::text end,
    true
  );
  select null::void;
$$;

-- Runs a statement and reports "rows:<n>" or "error:<sqlstate>".
create function pg_temp.attempt(p_sql text)
returns text
language plpgsql
as $$
declare
  affected integer;
begin
  execute p_sql;
  get diagnostics affected = row_count;
  return 'rows:' || affected;
exception when others then
  return 'error:' || sqlstate;
end;
$$;

-- A weekly series of p_count rows from 2026-11-03 09:00 Bucharest, as the JSON
-- the API sends. Row k (1-based) has the title p_title || ' ' || k, unless it
-- is the bad one, whose title is blank.
create function pg_temp.series_rows(p_series uuid, p_count integer, p_title text, p_bad integer default null)
returns jsonb
language sql
as $$
  select jsonb_agg(jsonb_build_object(
    'series_id', p_series,
    'series_index', k,
    'series_repeat', 'weekly',
    'title', case when k = p_bad then '   ' else p_title || ' ' || k end,
    'starts_at', to_char('2026-11-03 07:00+00'::timestamptz + (k - 1) * interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ends_at', to_char('2026-11-03 08:00+00'::timestamptz + (k - 1) * interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'notify_at', to_char('2026-11-03 06:30+00'::timestamptz + (k - 1) * interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) order by k)
  from generate_series(1, p_count) as k
$$;

-- "<events>/<attendee rows>" for events whose title starts with p_title.
create function pg_temp.counts(p_title text)
returns text
language sql
as $$
  select (select count(*) from public.calendar_events e where e.title like p_title || '%')
    || '/' || (select count(*) from public.calendar_event_attendees a
      join public.calendar_events e on e.id = a.event_id where e.title like p_title || '%')
$$;

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.create_calendar_events(jsonb, uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.update_calendar_events(jsonb, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.create_calendar_events(jsonb, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.update_calendar_events(jsonb, uuid[])', 'execute'),
  'the save functions are granted to authenticated and not anon'
);
select ok(
  (select bool_and(not p.prosecdef and p.proconfig @> array['search_path=""'])
   from pg_catalog.pg_proc p
   where p.oid in (
     'public.create_calendar_events(jsonb, uuid[])'::regprocedure,
     'public.update_calendar_events(jsonb, uuid[])'::regprocedure
   )),
  'the save functions are security invoker with an empty search_path'
);

-- ---------------------------------------------------------------------------
-- create_calendar_events
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(1);

select is(
  (select count(*)::integer from public.create_calendar_events(
    pg_temp.series_rows('d9200000-0000-4000-8000-0000000000aa', 10, 'Swim'),
    array[pg_temp.mid(1), pg_temp.mid(2)])),
  10,
  'creating a 10-event series returns 10 rows'
);
select is(pg_temp.counts('Swim '), '10/20', 'the rows and the attendees of both members were inserted together');
select is(
  (select array_agg(e.series_index order by e.series_index)
   from public.calendar_events e where e.series_id = 'd9200000-0000-4000-8000-0000000000aa'),
  array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]::smallint[],
  'the series has indexes 1 to 10'
);
select is(
  (select row(count(distinct e.family_id), min(e.family_id::text), count(distinct e.created_by), min(e.created_by::text),
     min(e.series_repeat), count(distinct e.timezone), min(e.timezone), min(e.notes), min(e.location), bool_or(e.all_day))::text
   from public.calendar_events e where e.series_id = 'd9200000-0000-4000-8000-0000000000aa'),
  row(1, 'd9200000-0000-4000-8000-0000000000fa', 1, pg_temp.uid(1)::text, 'weekly', 1, 'Europe/Bucharest', '', '', false)::text,
  'every row has the caller''s family and creator, and the defaults'
);
select is(
  (select e.notify_at from public.calendar_events e
   where e.series_id = 'd9200000-0000-4000-8000-0000000000aa' and e.series_index = 3),
  '2026-11-17 06:30+00'::timestamptz,
  'notify_at is stored as given'
);
select is(
  (select array_agg(s.series_index order by s.series_index)
   from public.create_calendar_events(
     pg_temp.series_rows('d9200000-0000-4000-8000-0000000000ab', 3, 'Order'), array[pg_temp.mid(1)]) s),
  array[1, 2, 3]::smallint[],
  'the returned rows come back by series_index'
);

-- A one-off: a series of its own, with everything defaulted.
select is(
  (select row(s.series_index, s.series_repeat, s.notes, s.location, s.all_day, s.timezone,
     s.notify_at, s.notified_at, s.created_by)::text
   from public.create_calendar_events(
     '[{"title": "One-off", "starts_at": "2026-11-10T07:00:00Z", "ends_at": "2026-11-10T08:00:00Z"}]',
     array[pg_temp.mid(1)]) s),
  row(1::smallint, 'none'::text, ''::text, ''::text, false, 'Europe/Bucharest'::text,
    null::timestamptz, null::timestamptz, pg_temp.uid(1))::text,
  'a row with only title, start and end gets the defaults'
);
select is(
  (select count(distinct s.series_id)::integer from public.create_calendar_events(
    '[{"title": "Shared", "series_index": 1, "series_repeat": "daily", "starts_at": "2026-11-10T07:00:00Z", "ends_at": "2026-11-10T08:00:00Z"},
      {"title": "Shared", "series_index": 2, "series_repeat": "daily", "starts_at": "2026-11-11T07:00:00Z", "ends_at": "2026-11-11T08:00:00Z"}]',
    array[pg_temp.mid(1)]) s),
  1,
  'rows without a series_id share one generated series'
);
select is(
  (select array_agg(s.all_day) from public.create_calendar_events(
    '[{"title": "Holiday", "all_day": true, "starts_at": "2026-11-10T22:00:00Z", "ends_at": "2026-11-13T22:00:00Z", "notes": "Pack", "location": "Sinaia"}]',
    array[pg_temp.mid(1), pg_temp.mid(1)]) s),
  array[true],
  'an all-day event spanning three days is allowed'
);
select is(pg_temp.counts('Holiday'), '1/1', 'a repeated member id is added once');

-- Atomic: a failing row inserts nothing.
select is(
  pg_temp.attempt(format($q$select * from public.create_calendar_events(%L::jsonb, %L::uuid[])$q$,
    pg_temp.series_rows('d9200000-0000-4000-8000-0000000000ac', 10, 'Broken', 7),
    array[pg_temp.mid(1), pg_temp.mid(2)])),
  'error:23514',
  'a series with a blank title in row 7 fails'
);
select is(pg_temp.counts('Broken'), '0/0', 'and inserts no events and no attendees');
select is(
  pg_temp.attempt(format($q$select * from public.create_calendar_events(%L::jsonb, %L::uuid[])$q$,
    pg_temp.series_rows('d9200000-0000-4000-8000-0000000000ad', 4, 'Foreign'),
    array[pg_temp.mid(1), pg_temp.mid(3)])),
  'error:23514',
  'an attendee from another family fails the call'
);
select is(pg_temp.counts('Foreign'), '0/0', 'and leaves no events behind');
select is(
  pg_temp.attempt(format($q$select * from public.create_calendar_events(%L::jsonb, %L::uuid[])$q$,
    '[{"title": "Too long", "starts_at": "2026-11-01T00:00:00Z", "ends_at": "2026-12-03T00:00:00Z"}]',
    array[pg_temp.mid(1)])),
  'error:23514',
  'a 32-day event fails the call'
);
select is(
  pg_temp.attempt(format($q$select * from public.create_calendar_events(%L::jsonb, %L::uuid[])$q$,
    '[{"starts_at": "2026-11-01T00:00:00Z", "ends_at": "2026-11-02T00:00:00Z"}]',
    array[pg_temp.mid(1)])),
  'error:23502',
  'a row without a title fails the call'
);

-- Bad calls.
select is(
  pg_temp.attempt(format($q$select * from public.create_calendar_events(%L::jsonb, %L::uuid[])$q$,
    pg_temp.series_rows('d9200000-0000-4000-8000-0000000000ae', 11, 'Eleven'), array[pg_temp.mid(1)])),
  'error:22023',
  'an 11-event series is refused'
);
select is(pg_temp.counts('Eleven'), '0/0', 'and inserts nothing');
select is(
  pg_temp.attempt($q$select * from public.create_calendar_events('[]', array[]::uuid[])$q$),
  'error:22023',
  'no rows is refused'
);
select is(
  pg_temp.attempt($q$select * from public.create_calendar_events('{"title": "Not an array"}', null)$q$),
  'error:22023',
  'rows that aren''t an array are refused'
);
select is(
  pg_temp.attempt($q$select * from public.create_calendar_events(
    '[{"title": "Nobody", "starts_at": "2026-11-10T07:00:00Z", "ends_at": "2026-11-10T08:00:00Z"}]', array[]::uuid[])$q$),
  'error:22023',
  'an event for nobody is refused'
);
select is(
  pg_temp.attempt($q$select * from public.create_calendar_events(
    '[{"title": "Nobody", "starts_at": "2026-11-10T07:00:00Z", "ends_at": "2026-11-10T08:00:00Z"}]', null)$q$),
  'error:22023',
  'a null attendee list is refused'
);

-- The kid creates too; a user without a family and anon can't.
select pg_temp.act_as(2);
select is(
  (select count(*)::integer from public.create_calendar_events(
    '[{"title": "Kid event", "starts_at": "2026-11-10T07:00:00Z", "ends_at": "2026-11-10T08:00:00Z"}]',
    array[pg_temp.mid(2)])),
  1,
  'a kid creates an event'
);
select pg_temp.act_as(4);
select is(
  pg_temp.attempt(format($q$select * from public.create_calendar_events(%L::jsonb, %L::uuid[])$q$,
    '[{"title": "Lonely", "starts_at": "2026-11-10T07:00:00Z", "ends_at": "2026-11-10T08:00:00Z"}]', array[pg_temp.mid(1)])),
  'error:42501',
  'a user without a family can''t create events'
);
select pg_temp.act_as(null);
select is(
  pg_temp.attempt(format($q$select * from public.create_calendar_events(%L::jsonb, %L::uuid[])$q$,
    '[{"title": "Ghost", "starts_at": "2026-11-10T07:00:00Z", "ends_at": "2026-11-10T08:00:00Z"}]', array[pg_temp.mid(1)])),
  'error:42501',
  'a session without a user can''t create events'
);
reset role;
set local role anon;
select is(
  pg_temp.attempt($q$select * from public.create_calendar_events('[]', null)$q$),
  'error:42501',
  'anon can''t call create_calendar_events'
);
reset role;
select is(pg_temp.counts('Ghost') || pg_temp.counts('Lonely'), '0/00/0', 'and neither created anything');

-- ---------------------------------------------------------------------------
-- update_calendar_events
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(1);

-- Rows 2 to 4 of the Swim series: a new title and a time an hour later, the
-- notify time cleared, and the attendees replaced by the kid alone.
select is(
  (select array_agg(row(s.series_index, s.title, s.starts_at, s.notify_at is null, s.notes)::text order by s.series_index)
   from public.update_calendar_events(
     (select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'title', 'Swim club',
        'starts_at', to_char(e.starts_at + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'ends_at', to_char(e.ends_at + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'notify_at', null,
        'notified_at', null))
      from public.calendar_events e
      where e.series_id = 'd9200000-0000-4000-8000-0000000000aa' and e.series_index between 2 and 4),
     array[pg_temp.mid(2)]) s),
  array[
    row(2::smallint, 'Swim club'::text, '2026-11-10 08:00+00'::timestamptz, true, ''::text)::text,
    row(3::smallint, 'Swim club'::text, '2026-11-17 08:00+00'::timestamptz, true, ''::text)::text,
    row(4::smallint, 'Swim club'::text, '2026-11-24 08:00+00'::timestamptz, true, ''::text)::text
  ],
  'updating rows 2-4 returns them with the new values, absent keys unchanged'
);
select is(
  (select array_agg(row(e.series_index, e.title, e.notify_at is null)::text order by e.series_index)
   from public.calendar_events e
   where e.series_id = 'd9200000-0000-4000-8000-0000000000aa' and e.series_index in (1, 2, 5)),
  array[
    row(1::smallint, 'Swim 1'::text, false)::text,
    row(2::smallint, 'Swim club'::text, true)::text,
    row(5::smallint, 'Swim 5'::text, false)::text
  ],
  'only the given rows changed'
);
select is(
  (select array_agg(row(e.series_index, a.member_id = pg_temp.mid(2))::text order by e.series_index, a.member_id)
   from public.calendar_events e join public.calendar_event_attendees a on a.event_id = e.id
   where e.series_id = 'd9200000-0000-4000-8000-0000000000aa' and e.series_index in (1, 2, 3, 4, 5)),
  array[
    row(1::smallint, false)::text, row(1::smallint, true)::text,
    row(2::smallint, true)::text,
    row(3::smallint, true)::text,
    row(4::smallint, true)::text,
    row(5::smallint, false)::text, row(5::smallint, true)::text
  ],
  'the attendees of the updated rows were replaced, the others kept'
);

-- A null attendee list keeps the attendees.
select is(
  (select count(*)::integer from public.update_calendar_events(
    format('[{"id": "%s", "location": "The pool"}]', (select e.id from public.calendar_events e
      where e.series_id = 'd9200000-0000-4000-8000-0000000000aa' and e.series_index = 1))::jsonb,
    null)),
  1,
  'an update without an attendee list succeeds'
);
select is(
  (select row(e.location, (select count(*) from public.calendar_event_attendees a where a.event_id = e.id))::text
   from public.calendar_events e
   where e.series_id = 'd9200000-0000-4000-8000-0000000000aa' and e.series_index = 1),
  row('The pool'::text, 2::bigint)::text,
  'and keeps the attendees'
);

-- Atomic: a row that isn't visible fails the whole call.
select is(
  pg_temp.attempt(format($q$select * from public.update_calendar_events(%L::jsonb, null)$q$,
    jsonb_build_array(
      jsonb_build_object('id', pg_temp.eid(1), 'title', 'Changed'),
      jsonb_build_object('id', pg_temp.eid(2), 'title', 'Hacked')))),
  'error:P0002',
  'updating another family''s event is P0002'
);
reset role;
select is(
  (select array_agg(e.title order by e.id) from public.calendar_events e where e.id in (pg_temp.eid(1), pg_temp.eid(2))),
  array['Swimming', 'Dentist'],
  'and changes nothing, not even the visible row before it'
);
set local role authenticated;
select pg_temp.act_as(1);
select is(
  pg_temp.attempt(format($q$select * from public.update_calendar_events(%L::jsonb, null)$q$,
    format('[{"id": "%s", "title": "Gone"}]', gen_random_uuid()))),
  'error:P0002',
  'updating an event that doesn''t exist is P0002'
);
select is(
  pg_temp.attempt(format($q$select * from public.update_calendar_events(%L::jsonb, %L::uuid[])$q$,
    format('[{"id": "%s", "title": "Moved"}]', pg_temp.eid(1)), array[pg_temp.mid(3)])),
  'error:23514',
  'an attendee from another family fails an update'
);
select is(
  pg_temp.attempt(format($q$select * from public.update_calendar_events(%L::jsonb, null)$q$,
    format('[{"id": "%s", "starts_at": "2026-11-03T07:00:00Z", "ends_at": "2026-12-20T07:00:00Z"}]', pg_temp.eid(1)))),
  'error:23514',
  'an update that makes the event longer than 31 days fails'
);
select is(
  pg_temp.attempt(format($q$select * from public.update_calendar_events(%L::jsonb, null)$q$,
    format('[{"id": "%s", "title": "   "}]', pg_temp.eid(1)))),
  'error:23514',
  'an update to a blank title fails'
);
select is(
  pg_temp.attempt(format($q$select * from public.update_calendar_events(%L::jsonb, null)$q$,
    '[{"title": "No id"}]')),
  'error:22023',
  'a row without an id is refused'
);
select is(
  pg_temp.attempt($q$select * from public.update_calendar_events('[]', null)$q$),
  'error:22023',
  'no rows is refused'
);
select is(
  pg_temp.attempt(format($q$select * from public.update_calendar_events(%L::jsonb, %L::uuid[])$q$,
    format('[{"id": "%s", "title": "Nobody"}]', pg_temp.eid(1)), array[]::uuid[])),
  'error:22023',
  'an empty attendee list is refused'
);
select is(
  (select e.title from public.calendar_events e where e.id = pg_temp.eid(1)),
  'Swimming',
  'none of the failed updates changed the event'
);

-- The family and series columns can't be sent: they aren't settable keys.
select is(
  (select row(s.series_index, s.series_repeat, s.family_id)::text from public.update_calendar_events(
    format('[{"id": "%s", "series_index": 5, "series_repeat": "daily", "family_id": "%s"}]', pg_temp.eid(1),
      'd9200000-0000-4000-8000-0000000000fb')::jsonb, null) s),
  row(1::smallint, 'none'::text, 'd9200000-0000-4000-8000-0000000000fa'::uuid)::text,
  'family and series keys in an update are ignored'
);

reset role;

select * from finish();
rollback;
