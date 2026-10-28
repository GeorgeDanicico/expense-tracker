begin;
create extension if not exists pgtap;
select plan(90);

-- C1 (docs/calendar-plan.md): the family calendar's events and attendees.
--
-- Users (prefix d9100000), with user number NN:
--   family A ('Family A', ...00fa): 01 creator parent, 02 kid, 03 second parent
--   family B ('Family B', ...00fb): 04 creator parent, 05 kid
--   06 has no family.
-- Member id of user NN: ...0000000f00NN. Event ids: ...0000000e00NN, so
-- pg_temp.visible() can turn the events a caller sees back into numbers.
--
-- Fixture events (inserted as the table owner, 3 November 2026, 09:00-10:00 in
-- Bucharest; the attendee is the member of the same number as its creator
-- unless noted):
--   01 family A, created by the parent (01), for member 01
--   02 family A, created by the kid (02), for member 02
--   03 family B, created by its parent (04), for members 04 and 05
--   04 family A, created by the kid (02), for the parent to delete
--   05 family A, created by the parent (01), for the kid to delete

create function pg_temp.uid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d9100000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.mid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d9100000-0000-4000-8000-0000000f00' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.eid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d9100000-0000-4000-8000-0000000e00' || lpad(n::text, 2, '0'))::uuid
$$;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'c1-user-' || n || '@example.test', 'not-used', now(), '{}', '{}', now(), now()
from generate_series(1, 6) as n
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('d9100000-0000-4000-8000-0000000000fa', 'Family A', pg_temp.uid(1)),
  ('d9100000-0000-4000-8000-0000000000fb', 'Family B', pg_temp.uid(4));

insert into public.family_members (id, family_id, user_id, role) values
  (pg_temp.mid(1), 'd9100000-0000-4000-8000-0000000000fa', pg_temp.uid(1), 'parent'),
  (pg_temp.mid(2), 'd9100000-0000-4000-8000-0000000000fa', pg_temp.uid(2), 'kid'),
  (pg_temp.mid(3), 'd9100000-0000-4000-8000-0000000000fa', pg_temp.uid(3), 'parent'),
  (pg_temp.mid(4), 'd9100000-0000-4000-8000-0000000000fb', pg_temp.uid(4), 'parent'),
  (pg_temp.mid(5), 'd9100000-0000-4000-8000-0000000000fb', pg_temp.uid(5), 'kid');

insert into public.calendar_events (id, family_id, title, starts_at, ends_at, created_by) values
  (pg_temp.eid(1), 'd9100000-0000-4000-8000-0000000000fa', 'Swimming',
    '2026-11-03 09:00+02', '2026-11-03 10:00+02', pg_temp.uid(1)),
  (pg_temp.eid(2), 'd9100000-0000-4000-8000-0000000000fa', 'Piano',
    '2026-11-03 09:00+02', '2026-11-03 10:00+02', pg_temp.uid(2)),
  (pg_temp.eid(3), 'd9100000-0000-4000-8000-0000000000fb', 'Dentist',
    '2026-11-03 09:00+02', '2026-11-03 10:00+02', pg_temp.uid(4)),
  (pg_temp.eid(4), 'd9100000-0000-4000-8000-0000000000fa', 'Kid event to delete',
    '2026-11-03 09:00+02', '2026-11-03 10:00+02', pg_temp.uid(2)),
  (pg_temp.eid(5), 'd9100000-0000-4000-8000-0000000000fa', 'Parent event to delete',
    '2026-11-03 09:00+02', '2026-11-03 10:00+02', pg_temp.uid(1));

insert into public.calendar_event_attendees (event_id, member_id) values
  (pg_temp.eid(1), pg_temp.mid(1)),
  (pg_temp.eid(2), pg_temp.mid(2)),
  (pg_temp.eid(3), pg_temp.mid(4)),
  (pg_temp.eid(3), pg_temp.mid(5)),
  (pg_temp.eid(4), pg_temp.mid(2)),
  (pg_temp.eid(5), pg_temp.mid(1));

-- Gives events an old updated_at, so the trigger's bumps are visible. The guard
-- triggers are off while it does (the guard would set updated_at straight back to now()).
-- Run it as the table owner.
create function pg_temp.age_events(p_ids uuid[])
returns void
language plpgsql
as $$
begin
  perform set_config('session_replication_role', 'replica', true);
  update public.calendar_events set updated_at = '2020-01-01 00:00:00+00' where id = any(p_ids);
  perform set_config('session_replication_role', 'origin', true);
end;
$$;

select pg_temp.age_events(array[pg_temp.eid(1), pg_temp.eid(2), pg_temp.eid(3), pg_temp.eid(4), pg_temp.eid(5)]);

-- ---------------------------------------------------------------------------
-- Test helpers (security invoker, so they run under the caller's RLS)
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

-- The event numbers the caller can read.
create function pg_temp.visible()
returns integer[]
language sql
as $$
  select coalesce(array_agg(right(e.id::text, 2)::integer order by e.id), '{}')
  from public.calendar_events e
  where e.id::text like 'd9100000-%'
$$;

-- The attendees of event n, as the member numbers the caller can read.
create function pg_temp.attending(n integer)
returns integer[]
language sql
as $$
  select coalesce(array_agg(right(a.member_id::text, 2)::integer order by a.member_id), '{}')
  from public.calendar_event_attendees a
  where a.event_id = pg_temp.eid(n)
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

-- An insert of a one-off event in family A, created by user p_user, with the
-- given extra column assignments appended (p_cols, p_vals).
create function pg_temp.insert_event(
  p_id uuid,
  p_user integer,
  p_starts text,
  p_ends text,
  p_title text default 'Event'
)
returns text
language sql
as $$
  select pg_temp.attempt(format(
    $q$insert into public.calendar_events (id, family_id, title, starts_at, ends_at, created_by)
      values (%L, 'd9100000-0000-4000-8000-0000000000fa', %L, %L, %L, %L)$q$,
    p_id, p_title, p_starts, p_ends, pg_temp.uid(p_user)))
$$;

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------

select has_table('public', 'calendar_events', 'public.calendar_events exists');
select has_table('public', 'calendar_event_attendees', 'public.calendar_event_attendees exists');
select has_table('public', 'calendar_feeds', 'public.calendar_feeds exists');
select ok(
  (select bool_and(c.relrowsecurity) from pg_catalog.pg_class c
   where c.oid in ('public.calendar_events'::regclass, 'public.calendar_event_attendees'::regclass,
     'public.calendar_feeds'::regclass)),
  'RLS is enabled on all three tables'
);
select table_privs_are('public', 'calendar_events', 'authenticated',
  array['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  'authenticated can select, insert, update and delete events');
select table_privs_are('public', 'calendar_event_attendees', 'authenticated',
  array['DELETE', 'INSERT', 'SELECT'],
  'authenticated can select, insert and delete attendees, not update them');
select table_privs_are('public', 'calendar_events', 'anon', array[]::text[],
  'anon has no privileges on events');
select table_privs_are('public', 'calendar_event_attendees', 'anon', array[]::text[],
  'anon has no privileges on attendees');
select policies_are('public', 'calendar_events',
  array['calendar_events_select_family', 'calendar_events_insert_family',
    'calendar_events_update_family', 'calendar_events_delete_family'],
  'events have exactly the four family policies');
select policies_are('public', 'calendar_event_attendees',
  array['calendar_event_attendees_select_family', 'calendar_event_attendees_insert_family',
    'calendar_event_attendees_delete_family'],
  'attendees have exactly the three family policies');
select has_index('public', 'calendar_events', 'calendar_events_family_id_starts_at_idx',
  array['family_id', 'starts_at'], 'events are indexed by family and start for the range query');
select has_index('public', 'calendar_event_attendees', 'calendar_event_attendees_member_id_idx',
  array['member_id'], 'attendees are indexed by member');
select is(
  (select pg_get_indexdef(i.indexrelid) from pg_catalog.pg_index i
   where i.indexrelid = 'public.calendar_events_notify_at_idx'::regclass),
  'CREATE INDEX calendar_events_notify_at_idx ON public.calendar_events USING btree (notify_at) WHERE (notified_at IS NULL)',
  'events have a partial index on notify_at for events not yet notified'
);
select has_trigger('public', 'calendar_events', 'calendar_events_guard',
  'events have the calendar_events_guard trigger');
select has_trigger('public', 'calendar_event_attendees', 'calendar_event_attendees_guard',
  'attendees have the family check trigger');
select has_trigger('public', 'calendar_event_attendees', 'calendar_event_attendees_touch',
  'attendees have the touch trigger');
select has_trigger('public', 'calendar_event_attendees', 'calendar_event_attendees_notify',
  'attendees have the notify trigger');

-- ---------------------------------------------------------------------------
-- The parent (01) uses the whole calendar, the kid's events included
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(1);

select is(pg_temp.visible(), array[1, 2, 4, 5], 'the parent sees every event of family A, and no other');
select is(pg_temp.attending(2), array[2], 'the parent sees the kid''s event''s attendees');
select is(pg_temp.attending(3), '{}'::integer[], 'and no attendees of another family''s event');
select is(pg_temp.insert_event(pg_temp.eid(11), 1, '2026-11-04 09:00+02', '2026-11-04 10:00+02', 'Parents'' evening'),
  'rows:1', 'the parent adds an event');
select is(
  pg_temp.attempt(format('insert into public.calendar_event_attendees (event_id, member_id) values (%L, %L), (%L, %L)',
    pg_temp.eid(11), pg_temp.mid(2), pg_temp.eid(11), pg_temp.mid(3))),
  'rows:2',
  'the parent adds the kid and the other parent as attendees'
);
select is(
  pg_temp.attempt(format($q$update public.calendar_events set title = 'Piano lesson' where id = %L$q$, pg_temp.eid(2))),
  'rows:1',
  'the parent edits the kid''s event'
);
select is(
  pg_temp.attempt(format('delete from public.calendar_event_attendees where event_id = %L', pg_temp.eid(2))),
  'rows:1',
  'the parent removes the kid from the kid''s event'
);
select is(
  pg_temp.attempt(format('insert into public.calendar_event_attendees (event_id, member_id) values (%L, %L)',
    pg_temp.eid(2), pg_temp.mid(1))),
  'rows:1',
  'and adds themselves'
);
select is(
  pg_temp.attempt(format('delete from public.calendar_events where id = %L', pg_temp.eid(4))),
  'rows:1',
  'the parent deletes an event the kid created'
);
select is(pg_temp.attending(4), '{}'::integer[], 'deleting an event deletes its attendees');
select is(
  pg_temp.insert_event(pg_temp.eid(12), 2, '2026-11-04 09:00+02', '2026-11-04 10:00+02'),
  'error:42501',
  'the parent can''t add an event in the kid''s name'
);
select is(
  pg_temp.attempt(format($q$insert into public.calendar_events (family_id, title, starts_at, ends_at)
    values ('d9100000-0000-4000-8000-0000000000fa', 'No creator', '2026-11-04 09:00+02', '2026-11-04 10:00+02')$q$)),
  'error:42501',
  'an event can''t be added without a creator'
);
select is(
  pg_temp.attempt(format($q$insert into public.calendar_events (family_id, title, starts_at, ends_at, created_by)
    values ('d9100000-0000-4000-8000-0000000000fb', 'Wrong family', '2026-11-04 09:00+02', '2026-11-04 10:00+02', %L)$q$,
    pg_temp.uid(1))),
  'error:42501',
  'the parent can''t add an event to another family'
);

-- ---------------------------------------------------------------------------
-- The kid (02) uses the whole calendar, the parent's events included
-- ---------------------------------------------------------------------------

select pg_temp.act_as(2);

select is(pg_temp.visible(), array[1, 2, 5, 11], 'the kid sees every event of family A');
select is(pg_temp.attending(11), array[2, 3], 'the kid sees the attendees of the parents'' event');
select is(
  pg_temp.insert_event(pg_temp.eid(13), 2, '2026-11-05 09:00+02', '2026-11-05 10:00+02', 'Football'),
  'rows:1',
  'the kid adds an event'
);
select is(
  pg_temp.attempt(format('insert into public.calendar_event_attendees (event_id, member_id) values (%L, %L)',
    pg_temp.eid(13), pg_temp.mid(2))),
  'rows:1',
  'and attends it'
);
select is(
  pg_temp.attempt(format($q$update public.calendar_events set location = 'The pool' where id = %L$q$, pg_temp.eid(1))),
  'rows:1',
  'the kid edits the parent''s event'
);
select is(
  pg_temp.attempt(format('insert into public.calendar_event_attendees (event_id, member_id) values (%L, %L)',
    pg_temp.eid(1), pg_temp.mid(2))),
  'rows:1',
  'the kid adds themselves to the parent''s event'
);
select is(
  pg_temp.attempt(format('delete from public.calendar_event_attendees where event_id = %L and member_id = %L',
    pg_temp.eid(1), pg_temp.mid(1))),
  'rows:1',
  'and removes the parent from it'
);
select is(
  pg_temp.attempt(format('delete from public.calendar_events where id = %L', pg_temp.eid(5))),
  'rows:1',
  'the kid deletes an event the parent created'
);

-- ---------------------------------------------------------------------------
-- Attendees must be in the event's family
-- ---------------------------------------------------------------------------

select pg_temp.act_as(1);

select is(
  pg_temp.attempt(format('insert into public.calendar_event_attendees (event_id, member_id) values (%L, %L)',
    pg_temp.eid(11), pg_temp.mid(4))),
  'error:23514',
  'an event can''t be for a member of another family'
);
select is(
  pg_temp.attempt(format('insert into public.calendar_event_attendees (event_id, member_id) values (%L, %L)',
    pg_temp.eid(11), pg_temp.eid(11))),
  'error:23514',
  'an attendee that isn''t a member at all is refused'
);
select is(
  pg_temp.attempt(format('insert into public.calendar_event_attendees (event_id, member_id) values (%L, %L)',
    pg_temp.eid(11), pg_temp.mid(2))),
  'error:23505',
  'a member attends an event once'
);
select is(
  pg_temp.attempt(format('update public.calendar_event_attendees set member_id = %L where event_id = %L',
    pg_temp.mid(1), pg_temp.eid(11))),
  'error:42501',
  'attendees can''t be updated, only added and removed'
);

-- ---------------------------------------------------------------------------
-- family_id, created_by and the series columns never change
-- ---------------------------------------------------------------------------

select is(
  pg_temp.attempt(format($q$update public.calendar_events set family_id = 'd9100000-0000-4000-8000-0000000000fb' where id = %L$q$,
    pg_temp.eid(1))),
  'error:42501',
  'an event can''t move to another family'
);
select is(
  pg_temp.attempt(format('update public.calendar_events set created_by = %L where id = %L', pg_temp.uid(2), pg_temp.eid(1))),
  'error:42501',
  'an event''s creator can''t be changed'
);
select is(
  pg_temp.attempt(format('update public.calendar_events set created_by = null where id = %L', pg_temp.eid(2))),
  'error:42501',
  'an event''s creator can''t be cleared'
);
select is(
  pg_temp.attempt(format('update public.calendar_events set series_id = gen_random_uuid() where id = %L', pg_temp.eid(1))),
  'error:42501',
  'an event can''t change series'
);
select is(
  pg_temp.attempt(format('update public.calendar_events set series_index = 2 where id = %L', pg_temp.eid(1))),
  'error:42501',
  'an event''s place in its series can''t change'
);
select is(
  pg_temp.attempt(format($q$update public.calendar_events set series_repeat = 'daily' where id = %L$q$, pg_temp.eid(1))),
  'error:42501',
  'an event''s repeat can''t change'
);
select is(
  (select row(e.family_id, e.created_by, e.series_index, e.series_repeat)::text
   from public.calendar_events e where e.id = pg_temp.eid(1)),
  row('d9100000-0000-4000-8000-0000000000fa'::uuid, pg_temp.uid(1), 1::smallint, 'none'::text)::text,
  'the event keeps its family, creator and series'
);

-- ---------------------------------------------------------------------------
-- Column checks
-- ---------------------------------------------------------------------------

select is(
  pg_temp.insert_event(pg_temp.eid(14), 1, '2026-11-06 09:00+02', '2026-11-06 10:00+02', '   '),
  'error:23514',
  'a blank title is refused'
);
select is(
  pg_temp.insert_event(pg_temp.eid(14), 1, '2026-11-06 10:00+02', '2026-11-06 09:00+02'),
  'error:23514',
  'an end before the start is refused'
);
select is(
  pg_temp.insert_event(pg_temp.eid(14), 1, '2026-11-06 10:00+02', '2026-11-06 10:00+02'),
  'error:23514',
  'an end equal to the start is refused'
);
select is(
  pg_temp.insert_event(pg_temp.eid(14), 1, '2026-11-01 00:00+02', '2026-12-03 00:00+02'),
  'error:23514',
  'a 32-day event is refused'
);
select is(
  pg_temp.insert_event(pg_temp.eid(14), 1, '2026-11-01 00:00+02', '2026-12-02 00:00+02', 'A long trip'),
  'rows:1',
  'a 31-day event is allowed'
);
select is(
  pg_temp.attempt(format($q$insert into public.calendar_events (family_id, title, starts_at, ends_at, created_by, series_index)
    values ('d9100000-0000-4000-8000-0000000000fa', 'One-off as no. 2', '2026-11-06 09:00+02', '2026-11-06 10:00+02', %L, 2)$q$,
    pg_temp.uid(1))),
  'error:23514',
  'a one-off is the only row of its series'
);
select is(
  pg_temp.attempt(format($q$insert into public.calendar_events (family_id, title, starts_at, ends_at, created_by, series_index, series_repeat)
    values ('d9100000-0000-4000-8000-0000000000fa', 'Eleventh', '2026-11-06 09:00+02', '2026-11-06 10:00+02', %L, 11, 'daily')$q$,
    pg_temp.uid(1))),
  'error:23514',
  'a series has at most 10 events'
);
select is(
  pg_temp.attempt(format($q$insert into public.calendar_events (family_id, title, starts_at, ends_at, created_by, series_repeat)
    values ('d9100000-0000-4000-8000-0000000000fa', 'Monthly', '2026-11-06 09:00+02', '2026-11-06 10:00+02', %L, 'monthly')$q$,
    pg_temp.uid(1))),
  'error:23514',
  'only none, daily and weekly repeats are stored'
);
select is(
  pg_temp.attempt(format($q$insert into public.calendar_events (family_id, title, notes, starts_at, ends_at, created_by)
    values ('d9100000-0000-4000-8000-0000000000fa', 'Long notes', %L, '2026-11-06 09:00+02', '2026-11-06 10:00+02', %L)$q$,
    repeat('x', 2001), pg_temp.uid(1))),
  'error:23514',
  'notes are at most 2,000 characters'
);
select is(
  pg_temp.attempt(format($q$insert into public.calendar_events (family_id, title, location, starts_at, ends_at, created_by)
    values ('d9100000-0000-4000-8000-0000000000fa', 'Far away', %L, '2026-11-06 09:00+02', '2026-11-06 10:00+02', %L)$q$,
    repeat('x', 201), pg_temp.uid(1))),
  'error:23514',
  'a location is at most 200 characters'
);
select is(
  pg_temp.attempt(format($q$update public.calendar_events set ends_at = starts_at - interval '1 hour' where id = %L$q$, pg_temp.eid(1))),
  'error:23514',
  'an edit can''t put the end before the start either'
);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

select ok(
  (select e.updated_at > '2021-01-01' from public.calendar_events e where e.id = pg_temp.eid(1)),
  'an edit bumps updated_at'
);

reset role;
select pg_temp.age_events(array[pg_temp.eid(11)]);
set local role authenticated;
select pg_temp.act_as(1);
select pg_temp.attempt(format('delete from public.calendar_event_attendees where event_id = %L and member_id = %L',
  pg_temp.eid(11), pg_temp.mid(3)));
select ok(
  (select e.updated_at > '2021-01-01' from public.calendar_events e where e.id = pg_temp.eid(11)),
  'removing an attendee bumps the event''s updated_at'
);

reset role;
select pg_temp.age_events(array[pg_temp.eid(11)]);
set local role authenticated;
select pg_temp.act_as(1);
select pg_temp.attempt(format('insert into public.calendar_event_attendees (event_id, member_id) values (%L, %L)',
  pg_temp.eid(11), pg_temp.mid(3)));
select ok(
  (select e.updated_at > '2021-01-01' from public.calendar_events e where e.id = pg_temp.eid(11)),
  'adding an attendee bumps the event''s updated_at'
);

-- The worker's bookkeeping isn't an edit: LAST-MODIFIED in the feed stays put.
reset role;
select pg_temp.age_events(array[pg_temp.eid(11)]);
update public.calendar_events set notified_at = now(), notify_locked_until = now() where id = pg_temp.eid(11);
select is(
  (select e.updated_at from public.calendar_events e where e.id = pg_temp.eid(11)),
  '2020-01-01 00:00:00+00'::timestamptz,
  'claiming and marking an event notified leaves updated_at alone'
);
update public.calendar_events set notify_at = now() where id = pg_temp.eid(11);
select ok(
  (select e.updated_at > '2021-01-01' from public.calendar_events e where e.id = pg_temp.eid(11)),
  'moving notify_at counts as an edit'
);

-- ---------------------------------------------------------------------------
-- A member of another family (04) sees and changes nothing of family A
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(4);

select is(pg_temp.visible(), array[3], 'a member of family B sees only family B''s events');
select is(pg_temp.attending(1), '{}'::integer[], 'and no attendees of family A''s events');
select is(
  pg_temp.attempt(format($q$update public.calendar_events set title = 'Hacked' where id = %L$q$, pg_temp.eid(1))),
  'rows:0',
  'they can''t edit family A''s events'
);
select is(
  pg_temp.attempt(format('delete from public.calendar_events where id = %L', pg_temp.eid(1))),
  'rows:0',
  'or delete them'
);
select is(
  pg_temp.attempt(format('delete from public.calendar_event_attendees where event_id = %L', pg_temp.eid(1))),
  'rows:0',
  'or remove their attendees'
);
select is(
  pg_temp.attempt(format('insert into public.calendar_event_attendees (event_id, member_id) values (%L, %L)',
    pg_temp.eid(1), pg_temp.mid(4))),
  'error:23514',
  'or add themselves to them'
);
select is(
  pg_temp.insert_event(pg_temp.eid(15), 4, '2026-11-04 09:00+02', '2026-11-04 10:00+02'),
  'error:42501',
  'or add an event to family A'
);

-- ---------------------------------------------------------------------------
-- A user with no family (06) and anon
-- ---------------------------------------------------------------------------

select pg_temp.act_as(6);

select is(pg_temp.visible(), '{}'::integer[], 'a user with no family sees no events');
select is(
  pg_temp.attempt(format($q$update public.calendar_events set title = 'Hacked' where id = %L$q$, pg_temp.eid(1))),
  'rows:0',
  'and changes none'
);
select is(
  pg_temp.insert_event(pg_temp.eid(16), 6, '2026-11-04 09:00+02', '2026-11-04 10:00+02'),
  'error:42501',
  'and can''t add one'
);

select pg_temp.act_as(null);
select is(pg_temp.visible(), '{}'::integer[], 'a session without a user sees no events');

reset role;
set local role anon;
select is(pg_temp.attempt('select * from public.calendar_events'), 'error:42501', 'anon can''t read events');
select is(pg_temp.attempt('select * from public.calendar_event_attendees'), 'error:42501',
  'anon can''t read attendees');
reset role;

-- ---------------------------------------------------------------------------
-- Leaving a family removes you as an attendee; deleting it deletes its events
-- ---------------------------------------------------------------------------

-- Event 11 is for members 02 and 03; event 13 is for member 02.
select is(
  (select array_agg(right(a.member_id::text, 2)::integer order by a.member_id)
   from public.calendar_event_attendees a where a.event_id = pg_temp.eid(11)),
  array[2, 3],
  'before the removal, event 11 is for the kid and the second parent'
);

set local role authenticated;
select pg_temp.act_as(1);
select is(pg_temp.attempt(format('select public.remove_family_member(%L)', pg_temp.mid(3))), 'rows:1',
  'the creator removes the second parent');
reset role;

select is(
  (select array_agg(right(a.member_id::text, 2)::integer order by a.member_id)
   from public.calendar_event_attendees a where a.event_id = pg_temp.eid(11)),
  array[2],
  'a removed member is no longer an attendee'
);
select ok(
  (select count(*) = 1 from public.calendar_events e where e.id = pg_temp.eid(11)),
  'but the event stays'
);

-- A member leaving by deleting their account (auth.users) is the same cascade.
delete from auth.users where id = pg_temp.uid(2);
select is(
  (select count(*)::integer from public.calendar_event_attendees a
   where a.event_id in (pg_temp.eid(2), pg_temp.eid(11), pg_temp.eid(13))
     and a.member_id = pg_temp.mid(2)),
  0,
  'a deleted account is no longer an attendee anywhere'
);
select is(
  (select e.created_by from public.calendar_events e where e.id = pg_temp.eid(2)),
  null::uuid,
  'and the events it created keep going without a creator'
);

-- Family B has an event with two attendees, so the cascades from the family
-- reach attendees through both the event and the members.
set local role authenticated;
select pg_temp.act_as(4);
select is(pg_temp.attempt($q$select public.delete_family('Family B')$q$), 'rows:1', 'the creator deletes family B');
reset role;

select is(
  (select count(*)::integer from public.calendar_events e where e.id = pg_temp.eid(3)),
  0,
  'deleting a family deletes its events'
);
select is(
  (select count(*)::integer from public.calendar_event_attendees a where a.event_id = pg_temp.eid(3)),
  0,
  'and their attendees'
);
select ok(
  (select count(*) > 0 from public.calendar_events e where e.family_id = 'd9100000-0000-4000-8000-0000000000fa'),
  'family A''s events are untouched'
);

-- And deleting family A, with attendees still on its events, as the owner.
delete from public.families where id = 'd9100000-0000-4000-8000-0000000000fa';
select is(
  (select count(*)::integer from public.calendar_events e where e.family_id = 'd9100000-0000-4000-8000-0000000000fa'),
  0,
  'deleting family A deletes its events too'
);
select is(
  (select count(*)::integer from public.calendar_event_attendees a where a.event_id::text like 'd9100000-%'),
  0,
  'and no attendee rows are left behind'
);

select * from finish();
rollback;
