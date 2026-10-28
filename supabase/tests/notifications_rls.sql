begin;
create extension if not exists pgtap;
select plan(82);

-- R1 (docs/reminders-plan.md): notification settings, push subscriptions, the
-- outbox, the worker heartbeat and the worker's claim functions.
--
-- Users (prefix d8200000): 01 and 02, no family needed; 03 (parent), 04 (kid)
-- and 05 (parent) are the family of the calendar tests at the end (C1,
-- docs/calendar-plan.md).
-- Outbox ids: ...0000000b00NN. Reminder ids: ...0000000a00NN.
--
-- Fixture outbox rows (all for user 02):
--   01 pending, due an hour ago
--   02 pending, due in an hour
--   03 sent
--   04 pending, due, but leased by another worker
-- Fixture reminders (all for user 02):
--   01 next_notify_at two hours ago
--   02 next_notify_at an hour ago, but muted
--   03 next_notify_at in an hour
--   04 next_notify_at an hour ago, but leased by another worker
--   05 next_notify_at null
--   06 next_notify_at an hour ago
-- User 02 has a settings row and the subscription https://push.example.test/b.

create function pg_temp.uid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d8200000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.nid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d8200000-0000-4000-8000-0000000b00' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.rid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d8200000-0000-4000-8000-0000000a00' || lpad(n::text, 2, '0'))::uuid
$$;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'r1-notify-' || n || '@example.test', 'not-used', now(), '{}', '{}', now(), now()
from generate_series(1, 5) as n
on conflict (id) do nothing;

insert into public.notifications (id, user_id, kind, payload, send_at, status, locked_until) values
  (pg_temp.nid(1), pg_temp.uid(2), 'reminder', '{}', now() - interval '1 hour', 'pending', null),
  (pg_temp.nid(2), pg_temp.uid(2), 'reminder', '{}', now() + interval '1 hour', 'pending', null),
  (pg_temp.nid(3), pg_temp.uid(2), 'reminder', '{}', now() - interval '1 hour', 'sent', null),
  (pg_temp.nid(4), pg_temp.uid(2), 'reminder', '{}', now() - interval '1 hour', 'pending', now() + interval '1 minute');

insert into public.reminders (id, user_id, title, starts_on, next_notify_at, notifications_muted, notify_locked_until) values
  (pg_temp.rid(1), pg_temp.uid(2), 'Due', '2026-10-01', now() - interval '2 hours', false, null),
  (pg_temp.rid(2), pg_temp.uid(2), 'Muted', '2026-10-01', now() - interval '1 hour', true, null),
  (pg_temp.rid(3), pg_temp.uid(2), 'Later', '2026-10-01', now() + interval '1 hour', false, null),
  (pg_temp.rid(4), pg_temp.uid(2), 'Leased', '2026-10-01', now() - interval '1 hour', false, now() + interval '1 minute'),
  (pg_temp.rid(5), pg_temp.uid(2), 'Nothing to notify', '2026-10-01', null, false, null),
  (pg_temp.rid(6), pg_temp.uid(2), 'Also due', '2026-10-01', now() - interval '1 hour', false, null);

insert into public.notification_settings (user_id, todos_enabled) values (pg_temp.uid(2), false);

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  (pg_temp.uid(2), 'https://push.example.test/b', 'key-b', 'auth-b');

insert into public.worker_heartbeats (name, beat_at, version) values ('worker-1', now(), 'test');

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

-- The subscription endpoints the caller can read.
create function pg_temp.endpoints()
returns text[]
language sql
as $$
  select coalesce(array_agg(s.endpoint order by s.endpoint), '{}')
  from public.push_subscriptions s
  where s.endpoint like 'https://push.example.test/%'
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

-- The fixture numbers among ids (ignoring rows that aren't fixtures).
create function pg_temp.numbers(ids uuid[])
returns integer[]
language sql
as $$
  select coalesce(array_agg(right(i::text, 2)::integer order by i), '{}')
  from unnest(ids) as i
  where i::text like 'd8200000-%'
$$;

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------

select has_table('public', 'notifications', 'public.notifications exists');
select has_table('public', 'worker_heartbeats', 'public.worker_heartbeats exists');
select has_table('public', 'notification_settings', 'public.notification_settings exists');
select has_table('public', 'push_subscriptions', 'public.push_subscriptions exists');
select ok(
  (select bool_and(c.relrowsecurity) from pg_catalog.pg_class c
   where c.oid in ('public.notifications'::regclass, 'public.worker_heartbeats'::regclass,
     'public.notification_settings'::regclass, 'public.push_subscriptions'::regclass)),
  'RLS is enabled on all four tables'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies p
   where p.schemaname = 'public' and p.tablename in ('notifications', 'worker_heartbeats')),
  0,
  'notifications and worker_heartbeats have no policies'
);
select table_privs_are('public', 'notifications', 'authenticated', array[]::text[],
  'authenticated has no privileges on notifications');
select table_privs_are('public', 'worker_heartbeats', 'authenticated', array[]::text[],
  'authenticated has no privileges on worker_heartbeats');
select table_privs_are('public', 'notification_settings', 'authenticated', array['INSERT', 'SELECT', 'UPDATE'],
  'authenticated can select, insert and update notification_settings');
select table_privs_are('public', 'push_subscriptions', 'authenticated', array['DELETE', 'SELECT'],
  'authenticated can select and delete push_subscriptions');
select ok(
  has_function_privilege('service_role', 'public.claim_notifications(integer)', 'execute')
  and has_function_privilege('service_role', 'public.claim_due_reminders(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_notifications(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_due_reminders(integer)', 'execute')
  and not has_function_privilege('anon', 'public.claim_notifications(integer)', 'execute')
  and not has_function_privilege('anon', 'public.claim_due_reminders(integer)', 'execute'),
  'the claim functions are granted to service_role only'
);
select ok(
  (select bool_and(p.proconfig @> array['search_path=""'])
   from pg_catalog.pg_proc p
   where p.oid in (
     'public.register_push_subscription(text, text, text, text)'::regprocedure,
     'public.send_test_notification()'::regprocedure,
     'public.todos_notify_assignee()'::regprocedure,
     'public.claim_notifications(integer)'::regprocedure,
     'public.claim_due_reminders(integer)'::regprocedure
   )),
  'the new functions set an empty search_path'
);
select is(
  (select pg_get_indexdef(i.indexrelid) from pg_catalog.pg_index i
   where i.indexrelid = 'public.notifications_send_at_pending_idx'::regclass),
  'CREATE INDEX notifications_send_at_pending_idx ON public.notifications USING btree (send_at) WHERE (status = ''pending''::text)',
  'notifications has a partial index on send_at for pending rows'
);
select has_index('public', 'notifications', 'notifications_created_at_idx', array['created_at'],
  'notifications is indexed by created_at for clean-up');

-- ---------------------------------------------------------------------------
-- Users can't touch the outbox, the heartbeat or the claim functions
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(1);

select is(pg_temp.attempt('select * from public.notifications'), 'error:42501',
  'a user can''t read the outbox');
select is(
  pg_temp.attempt(format($q$insert into public.notifications (user_id, kind, payload)
    values (%L, 'test', '{}')$q$, pg_temp.uid(1))),
  'error:42501',
  'a user can''t queue a notification, even for themselves'
);
select is(pg_temp.attempt('select * from public.worker_heartbeats'), 'error:42501',
  'a user can''t read worker heartbeats');
select is(
  pg_temp.attempt($q$insert into public.worker_heartbeats (name, beat_at, version) values ('fake', now(), 'x')$q$),
  'error:42501',
  'a user can''t write a worker heartbeat'
);
select is(pg_temp.attempt('select * from public.claim_notifications(10)'), 'error:42501',
  'a user can''t claim outbox rows');
select is(pg_temp.attempt('select * from public.claim_due_reminders(10)'), 'error:42501',
  'a user can''t claim due reminders');

-- ---------------------------------------------------------------------------
-- send_test_notification
-- ---------------------------------------------------------------------------

select is(public.send_test_notification(), true, 'a test notification is queued');
select is(public.send_test_notification(), false, 'a second one within the minute is a no-op');

-- ---------------------------------------------------------------------------
-- Notification settings: each user sees and changes only their own
-- ---------------------------------------------------------------------------

select is((select count(*)::integer from public.notification_settings), 0,
  'a user without a settings row sees none, not someone else''s');
select is(
  pg_temp.attempt(format('insert into public.notification_settings (user_id, reminders_enabled) values (%L, false)',
    pg_temp.uid(1))),
  'rows:1',
  'a user saves their own settings'
);
select is(
  pg_temp.attempt(format('insert into public.notification_settings (user_id) values (%L)', pg_temp.uid(2))),
  'error:42501',
  'a user can''t save settings for someone else'
);
select is(
  pg_temp.attempt(format('update public.notification_settings set push_enabled = false where user_id = %L',
    pg_temp.uid(1))),
  'rows:1',
  'a user changes their own settings'
);
select is(
  pg_temp.attempt(format('update public.notification_settings set todos_enabled = true where user_id = %L',
    pg_temp.uid(2))),
  'rows:0',
  'a user can''t change someone else''s settings'
);
select is(
  pg_temp.attempt(format('delete from public.notification_settings where user_id = %L', pg_temp.uid(1))),
  'error:42501',
  'settings can''t be deleted (a missing row means the defaults)'
);
select is(
  (select array_agg(row(s.user_id, s.push_enabled, s.reminders_enabled, s.todos_enabled)::text)
   from public.notification_settings s),
  array[row(pg_temp.uid(1), false, false, true)::text],
  'a user sees only their own settings'
);

-- ---------------------------------------------------------------------------
-- Push subscriptions
-- ---------------------------------------------------------------------------

select is(pg_temp.endpoints(), '{}'::text[], 'a user sees no one else''s subscriptions');
select is(
  pg_temp.attempt(format($q$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (%L, 'https://push.example.test/x', 'k', 'a')$q$, pg_temp.uid(1))),
  'error:42501',
  'a user can''t insert a subscription directly'
);
select is(
  (select s.user_id from public.register_push_subscription(
    'https://push.example.test/a', 'key-a', 'auth-a', 'Firefox') s),
  pg_temp.uid(1),
  'a user registers a new subscription'
);
select is(
  (select s.user_id from public.register_push_subscription(
    'https://push.example.test/b', 'key-b2', 'auth-b2', 'Chrome') s),
  pg_temp.uid(1),
  'registering an endpoint someone else had moves it to the caller'
);
select is(pg_temp.endpoints(), array['https://push.example.test/a', 'https://push.example.test/b'],
  'the user sees both of their subscriptions');
select is(
  pg_temp.attempt($q$select public.register_push_subscription('http://push.example.test/c', 'k', 'a', '')$q$),
  'error:23514',
  'an endpoint must be https'
);

select pg_temp.act_as(2);

select is(pg_temp.endpoints(), '{}'::text[], 'the previous owner no longer has the moved subscription');
select is(
  pg_temp.attempt($q$delete from public.push_subscriptions where endpoint = 'https://push.example.test/a'$q$),
  'rows:0',
  'a user can''t delete someone else''s subscription'
);
select is(
  (select array_agg(row(s.user_id, s.todos_enabled)::text) from public.notification_settings s),
  array[row(pg_temp.uid(2), false)::text],
  'the other user also sees only their own settings'
);

select pg_temp.act_as(1);
select is(
  pg_temp.attempt($q$delete from public.push_subscriptions where endpoint = 'https://push.example.test/a'$q$),
  'rows:1',
  'a user deletes their own subscription'
);

-- ---------------------------------------------------------------------------
-- Without a user, and anon
-- ---------------------------------------------------------------------------

select pg_temp.act_as(null);
select is(pg_temp.attempt('select public.send_test_notification()'), 'error:42501',
  'a session without a user can''t send a test');
select is(
  pg_temp.attempt($q$select public.register_push_subscription('https://push.example.test/d', 'k', 'a', '')$q$),
  'error:42501',
  'a session without a user can''t register a subscription'
);

reset role;
set local role anon;
select is(pg_temp.attempt('select public.send_test_notification()'), 'error:42501',
  'anon can''t send a test');
reset role;

select is(
  (select array_agg(n.payload ->> 'tag') from public.notifications n
   where n.user_id = pg_temp.uid(1)),
  array['test'],
  'the test calls queued exactly one test row, for the caller'
);

-- ---------------------------------------------------------------------------
-- The worker (service_role) claims with a lease
-- ---------------------------------------------------------------------------

set local role service_role;

select is(
  (select pg_temp.numbers(array_agg(c.id)) from public.claim_notifications(10) c),
  array[1],
  'claim_notifications returns due pending rows that aren''t leased'
);
select is(pg_temp.attempt('select * from public.claim_notifications(10)'), 'rows:0',
  'claimed rows are leased, so a second claim gets none');
select is(
  (select pg_temp.numbers(array_agg(c.id)) from public.claim_due_reminders(1) c),
  array[1],
  'claim_due_reminders returns at most the batch, oldest first'
);
select is(
  (select pg_temp.numbers(array_agg(c.id)) from public.claim_due_reminders(10) c),
  array[6],
  'claim_due_reminders skips muted, future, leased and already claimed reminders'
);
select is(pg_temp.attempt('select * from public.claim_due_reminders(10)'), 'rows:0',
  'a third claim gets no reminders');
select is(
  pg_temp.attempt($q$insert into public.worker_heartbeats (name, beat_at, version) values ('worker-2', now(), 'test')$q$),
  'rows:1',
  'the worker writes its heartbeat'
);

reset role;

select is(
  (select array_agg(n.locked_until = now() + interval '2 minutes' order by n.id) from public.notifications n
   where n.id = pg_temp.nid(1)),
  array[true],
  'a claimed outbox row is leased for 2 minutes'
);
select is(
  (select array_agg(r.notify_locked_until = now() + interval '2 minutes' order by r.id) from public.reminders r
   where r.id in (pg_temp.rid(1), pg_temp.rid(6))),
  array[true, true],
  'claimed reminders are leased for 2 minutes'
);

-- ---------------------------------------------------------------------------
-- Calendar (docs/calendar-plan.md, C1): the Calendar switch, the new kinds,
-- claim_due_calendar_events and the "added you" trigger
-- ---------------------------------------------------------------------------
--
-- Family 'Family C' (...00fc): 03 creator parent, 04 kid, 05 parent. Member id
-- of user NN: ...0000000f00NN. Event ids: ...0000000e00NN.
--
-- Fixture events (inserted as the table owner):
--   01 due (notify_at 10 minutes ago, starts in 20 minutes), for members 03, 04
--   02 due but already over (the worker was down), for member 03
--   03 not due yet (notify_at in an hour)
--   04 due but already notified
--   05 due but leased by another worker
--   06 with no notify_at
--   07 due, notify_at 20 minutes ago (older than 01), for member 05

create function pg_temp.mid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d8200000-0000-4000-8000-0000000f00' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.eid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d8200000-0000-4000-8000-0000000e00' || lpad(n::text, 2, '0'))::uuid
$$;

insert into public.families (id, name, creator_id) values
  ('d8200000-0000-4000-8000-0000000000fc', 'Family C', pg_temp.uid(3));
insert into public.family_members (id, family_id, user_id, role) values
  (pg_temp.mid(3), 'd8200000-0000-4000-8000-0000000000fc', pg_temp.uid(3), 'parent'),
  (pg_temp.mid(4), 'd8200000-0000-4000-8000-0000000000fc', pg_temp.uid(4), 'kid'),
  (pg_temp.mid(5), 'd8200000-0000-4000-8000-0000000000fc', pg_temp.uid(5), 'parent');

insert into public.calendar_events (id, family_id, title, starts_at, ends_at, notify_at, notified_at,
  notify_locked_until, created_by) values
  (pg_temp.eid(1), 'd8200000-0000-4000-8000-0000000000fc', 'Due', now() + interval '20 minutes',
    now() + interval '80 minutes', now() - interval '10 minutes', null, null, pg_temp.uid(3)),
  (pg_temp.eid(2), 'd8200000-0000-4000-8000-0000000000fc', 'Over', now() - interval '90 minutes',
    now() - interval '30 minutes', now() - interval '2 hours', null, null, pg_temp.uid(3)),
  (pg_temp.eid(3), 'd8200000-0000-4000-8000-0000000000fc', 'Later', now() + interval '90 minutes',
    now() + interval '150 minutes', now() + interval '1 hour', null, null, pg_temp.uid(3)),
  (pg_temp.eid(4), 'd8200000-0000-4000-8000-0000000000fc', 'Done', now() + interval '20 minutes',
    now() + interval '80 minutes', now() - interval '10 minutes', now() - interval '5 minutes', null, pg_temp.uid(3)),
  (pg_temp.eid(5), 'd8200000-0000-4000-8000-0000000000fc', 'Leased', now() + interval '20 minutes',
    now() + interval '80 minutes', now() - interval '10 minutes', null, now() + interval '1 minute', pg_temp.uid(3)),
  (pg_temp.eid(6), 'd8200000-0000-4000-8000-0000000000fc', 'No time', now() + interval '20 minutes',
    now() + interval '80 minutes', null, null, null, pg_temp.uid(3)),
  (pg_temp.eid(7), 'd8200000-0000-4000-8000-0000000000fc', 'Oldest due', now() + interval '10 minutes',
    now() + interval '70 minutes', now() - interval '20 minutes', null, null, pg_temp.uid(3));

insert into public.calendar_event_attendees (event_id, member_id) values
  (pg_temp.eid(1), pg_temp.mid(3)),
  (pg_temp.eid(1), pg_temp.mid(4)),
  (pg_temp.eid(2), pg_temp.mid(3)),
  (pg_temp.eid(7), pg_temp.mid(5));

-- The fixture attendees above were added by nobody, which queues "added you"
-- rows for them. Clear those, so the counts below are the tests' own.
delete from public.notifications where kind = 'event_added';

select is(
  (select c.column_default from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'notification_settings' and c.column_name = 'calendar_enabled'),
  'true',
  'notification_settings has a calendar_enabled switch, on by default'
);
select is(
  (select c.is_nullable from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'notification_settings' and c.column_name = 'calendar_enabled'),
  'NO',
  'and it is never null'
);
select is(
  pg_temp.attempt(format($q$insert into public.notifications (user_id, kind, payload) values (%L, 'event', '{}')$q$, pg_temp.uid(3))),
  'rows:1',
  'the outbox accepts the event kind'
);
select is(
  pg_temp.attempt(format($q$insert into public.notifications (user_id, kind, payload) values (%L, 'event_added', '{}')$q$, pg_temp.uid(3))),
  'rows:1',
  'and the event_added kind'
);
select is(
  pg_temp.attempt(format($q$insert into public.notifications (user_id, kind, payload) values (%L, 'calendar', '{}')$q$, pg_temp.uid(3))),
  'error:23514',
  'but no other kind'
);
select is(
  pg_temp.attempt(format($q$insert into public.notifications (user_id, kind, payload) values (%L, 'todo_due', '{}')$q$, pg_temp.uid(3))),
  'rows:1',
  'and the earlier kinds still work'
);
delete from public.notifications where user_id in (pg_temp.uid(3), pg_temp.uid(4), pg_temp.uid(5));

-- The claim function is the worker's alone.
select ok(
  has_function_privilege('service_role', 'public.claim_due_calendar_events(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_due_calendar_events(integer)', 'execute')
  and not has_function_privilege('anon', 'public.claim_due_calendar_events(integer)', 'execute'),
  'claim_due_calendar_events is granted to service_role only'
);
select ok(
  (select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p
   where p.oid = 'public.claim_due_calendar_events(integer)'::regprocedure),
  'and sets an empty search_path'
);

set local role authenticated;
select pg_temp.act_as(3);
select is(pg_temp.attempt('select * from public.claim_due_calendar_events(10)'), 'error:42501',
  'a user can''t claim due events');
reset role;
set local role anon;
select is(pg_temp.attempt('select * from public.claim_due_calendar_events(10)'), 'error:42501',
  'anon can''t claim due events');
reset role;

set local role service_role;

select is(
  (select array_agg(right(c.id::text, 2)::integer order by c.notify_at) from public.claim_due_calendar_events(1) c),
  array[7],
  'claim_due_calendar_events returns at most the batch, the oldest notify_at first'
);
select is(
  (select array_agg(right(c.id::text, 2)::integer order by c.notify_at) from public.claim_due_calendar_events(10) c),
  array[1],
  'it skips events that are not due, over, notified, leased, without a time or already claimed'
);
select is(pg_temp.attempt('select * from public.claim_due_calendar_events(10)'), 'rows:0',
  'claimed events are leased, so a second claim gets none');
reset role;

select is(
  (select array_agg(c.id order by c.notify_at)
   from public.calendar_events c where c.id in (pg_temp.eid(1), pg_temp.eid(7)) and c.notify_locked_until = now() + interval '2 minutes'),
  array[pg_temp.eid(7), pg_temp.eid(1)],
  'a claimed event is leased for 2 minutes'
);
select is(
  (select row(c.notified_at is not null, c.notify_locked_until is null)::text from public.calendar_events c where c.id = pg_temp.eid(2)),
  row(true, true)::text,
  'an event that was already over is marked notified without being returned or leased'
);
select is(
  (select c.notified_at is null from public.calendar_events c where c.id = pg_temp.eid(3)),
  true,
  'an event that isn''t due is untouched'
);

-- What the worker gets: the event and its attendees' users.
update public.calendar_events set notify_locked_until = null where id = pg_temp.eid(1);
set local role service_role;
select is(
  (select row(c.title, c.all_day, c.timezone, c.attendee_user_ids)::text from public.claim_due_calendar_events(10) c),
  row('Due'::text, false, 'Europe/Bucharest'::text, array[pg_temp.uid(3), pg_temp.uid(4)])::text,
  'the claim returns the event with its attendees'' user ids'
);
reset role;

-- An attendee-less event is returned with an empty list (it's claimed all the same).
update public.calendar_events set notify_locked_until = null where id = pg_temp.eid(1);
delete from public.calendar_event_attendees where event_id = pg_temp.eid(1);
set local role service_role;
select is(
  (select c.attendee_user_ids from public.claim_due_calendar_events(10) c),
  '{}'::uuid[],
  'an event with no attendees comes back with an empty list'
);
reset role;

-- "X added you": once per series and user, never for yourself.
delete from public.notifications where kind = 'event_added';

set local role authenticated;
select pg_temp.act_as(3);

select is(
  (select count(*)::integer from public.create_calendar_events(
    (select jsonb_agg(jsonb_build_object(
      'series_id', 'd8200000-0000-4000-8000-0000000000a1',
      'series_index', k, 'series_repeat', 'daily', 'title', 'School trip',
      'starts_at', to_char('2027-03-01 07:00+00'::timestamptz + (k - 1) * interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'ends_at', to_char('2027-03-01 08:00+00'::timestamptz + (k - 1) * interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by k)
     from generate_series(1, 5) as k),
    array[pg_temp.mid(3), pg_temp.mid(4)])),
  5,
  'a parent creates a 5-day series for themselves and the kid'
);
reset role;

select is(
  (select array_agg(n.user_id::text) from public.notifications n where n.kind = 'event_added'),
  array[pg_temp.uid(4)::text],
  'the kid gets one "added you" row for the whole series, and the parent none for themselves'
);
select is(
  (select n.payload - 'eventId' from public.notifications n where n.kind = 'event_added'),
  jsonb_build_object(
    'title', 'r1-notify-3 added you',
    'body', 'School trip',
    'url', '/calendar?event=' || (select e.id from public.calendar_events e
      where e.series_id = 'd8200000-0000-4000-8000-0000000000a1' and e.series_index = 1),
    'tag', 'event_added:d8200000-0000-4000-8000-0000000000a1',
    'eventTitle', 'School trip',
    'startsAt', '2027-03-01T07:00:00Z',
    'allDay', false,
    'timezone', 'Europe/Bucharest',
    'seriesRepeat', 'daily',
    'seriesLength', 5,
    'adderName', 'r1-notify-3'
  ),
  'it names the adder, the event, its start and the series'
);
select is(
  (select n.payload ->> 'eventId' from public.notifications n where n.kind = 'event_added'),
  (select e.id::text from public.calendar_events e
   where e.series_id = 'd8200000-0000-4000-8000-0000000000a1' and e.series_index = 1),
  'and points at the first event of the series'
);
select is(
  (select n.dedupe_key from public.notifications n where n.kind = 'event_added'),
  'event_added:d8200000-0000-4000-8000-0000000000a1:' || pg_temp.uid(4),
  'the row is keyed by series and user'
);

set local role authenticated;
select pg_temp.act_as(3);

-- Saving the same attendees again, or adding the kid to one more event of the
-- series, queues nothing; adding the other parent queues one row for them.
select is(
  (select count(*)::integer from public.update_calendar_events(
    (select jsonb_agg(jsonb_build_object('id', e.id, 'location', 'Zoo'))
     from public.calendar_events e where e.series_id = 'd8200000-0000-4000-8000-0000000000a1'),
    array[pg_temp.mid(3), pg_temp.mid(4)])),
  5,
  'the parent saves the series again with the same attendees'
);
select is(
  (select count(*)::integer from public.update_calendar_events(
    (select jsonb_agg(jsonb_build_object('id', e.id))
     from public.calendar_events e where e.series_id = 'd8200000-0000-4000-8000-0000000000a1'),
    array[pg_temp.mid(3), pg_temp.mid(4), pg_temp.mid(5)])),
  5,
  'and adds the other parent to all five events'
);
reset role;

select is(
  (select array_agg(n.user_id::text order by n.user_id) from public.notifications n where n.kind = 'event_added'),
  array[pg_temp.uid(4)::text, pg_temp.uid(5)::text],
  'adding another member to a 5-day series queues one row for them, and none for the kid again'
);

-- Adding yourself queues nothing, adding someone else does.
set local role authenticated;
select pg_temp.act_as(4);
select is(
  (select count(*)::integer from public.create_calendar_events(
    '[{"title": "Football", "starts_at": "2027-03-10T07:00:00Z", "ends_at": "2027-03-10T08:00:00Z"}]',
    array[pg_temp.mid(4)])),
  1,
  'the kid creates an event for themselves'
);
select is(
  pg_temp.attempt(format('insert into public.calendar_event_attendees (event_id, member_id)
    select e.id, %L from public.calendar_events e where e.title = %L', pg_temp.mid(3), 'Football')),
  'rows:1',
  'the kid adds the parent to it'
);
reset role;

select is(
  (select array_agg(n.user_id::text order by n.user_id) from public.notifications n where n.kind = 'event_added'),
  array[pg_temp.uid(3)::text, pg_temp.uid(4)::text, pg_temp.uid(5)::text],
  'adding another member to a one-off queues a row for them'
);
select is(
  (select n.payload ->> 'seriesLength' from public.notifications n
   where n.kind = 'event_added' and n.user_id = pg_temp.uid(3)),
  '1',
  'a one-off''s series length is 1'
);
select is(
  (select count(*)::integer from public.notifications n
   where n.kind = 'event_added' and n.user_id = pg_temp.uid(4)),
  1,
  'and the kid, who added themselves, has only the school trip row'
);

select * from finish();
rollback;
