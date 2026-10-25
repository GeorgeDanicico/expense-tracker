begin;
create extension if not exists pgtap;
select plan(51);

-- R1 (docs/reminders-plan.md): notification settings, push subscriptions, the
-- outbox, the worker heartbeat and the worker's claim functions.
--
-- Users (prefix d8200000): 01 and 02, no family needed.
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
from generate_series(1, 2) as n
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

select * from finish();
rollback;
