begin;
create extension if not exists pgtap;
select plan(57);

-- C1 (docs/calendar-plan.md): calendar feed links and calendar_feed().
--
-- Users (prefix d9300000), with user number NN:
--   family A ('Family A', ...00fa): 01 creator parent, 02 kid, 03 second parent
--   family B ('Family B', ...00fb): 04 creator parent
--   05 has no family.
-- Member id of user NN: ...0000000f00NN. Event ids: ...0000000e00NN.
--
-- Fixture events (inserted as the table owner), each with its attendees:
--   01 A, 3 Nov 09:00-10:00 Bucharest, for members 01 and 02
--   02 A, 4 Nov 09:00-10:00, for member 02 (the kid) only
--   03 A, 5 Nov 09:00-10:00, for member 01 only
--   04 A, ended 100 days ago, for member 01
--   05 A, ended 89 days ago, for member 01
--   06 A, 6 Nov, for member 03 only
--   07 B, 3 Nov, for member 04
-- Hashes are 64 hex characters: pg_temp.hash(n).

create function pg_temp.uid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d9300000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.mid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d9300000-0000-4000-8000-0000000f00' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.eid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d9300000-0000-4000-8000-0000000e00' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.hash(n integer)
returns text
language sql
immutable
as $$
  select repeat(lpad(n::text, 2, '0'), 32)
$$;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'c1-feed-' || n || '@example.test', 'not-used', now(), '{}', '{}', now(), now()
from generate_series(1, 5) as n
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('d9300000-0000-4000-8000-0000000000fa', 'Family A', pg_temp.uid(1)),
  ('d9300000-0000-4000-8000-0000000000fb', 'Family B', pg_temp.uid(4));

insert into public.family_members (id, family_id, user_id, role) values
  (pg_temp.mid(1), 'd9300000-0000-4000-8000-0000000000fa', pg_temp.uid(1), 'parent'),
  (pg_temp.mid(2), 'd9300000-0000-4000-8000-0000000000fa', pg_temp.uid(2), 'kid'),
  (pg_temp.mid(3), 'd9300000-0000-4000-8000-0000000000fa', pg_temp.uid(3), 'parent'),
  (pg_temp.mid(4), 'd9300000-0000-4000-8000-0000000000fb', pg_temp.uid(4), 'parent');

insert into public.calendar_events (id, family_id, title, notes, location, all_day, starts_at, ends_at, created_by) values
  (pg_temp.eid(1), 'd9300000-0000-4000-8000-0000000000fa', 'Visit, the "parents"', 'Bring cake', 'Cluj', false,
    '2026-11-03 09:00+02', '2026-11-03 10:00+02', pg_temp.uid(3)),
  (pg_temp.eid(2), 'd9300000-0000-4000-8000-0000000000fa', 'Kid only', '', '', false,
    '2026-11-04 09:00+02', '2026-11-04 10:00+02', pg_temp.uid(3)),
  (pg_temp.eid(3), 'd9300000-0000-4000-8000-0000000000fa', 'Parent only', '', '', true,
    '2026-11-05 00:00+02', '2026-11-06 00:00+02', pg_temp.uid(1)),
  (pg_temp.eid(4), 'd9300000-0000-4000-8000-0000000000fa', 'Ancient', '', '', false,
    now() - interval '100 days 1 hour', now() - interval '100 days', pg_temp.uid(1)),
  (pg_temp.eid(5), 'd9300000-0000-4000-8000-0000000000fa', 'Recent past', '', '', false,
    now() - interval '89 days 1 hour', now() - interval '89 days', pg_temp.uid(1)),
  (pg_temp.eid(6), 'd9300000-0000-4000-8000-0000000000fa', 'Second parent only', '', '', false,
    '2026-11-06 09:00+02', '2026-11-06 10:00+02', pg_temp.uid(3)),
  (pg_temp.eid(7), 'd9300000-0000-4000-8000-0000000000fb', 'Other family', '', '', false,
    '2026-11-03 09:00+02', '2026-11-03 10:00+02', pg_temp.uid(4));

insert into public.calendar_event_attendees (event_id, member_id) values
  (pg_temp.eid(1), pg_temp.mid(1)),
  (pg_temp.eid(1), pg_temp.mid(2)),
  (pg_temp.eid(2), pg_temp.mid(2)),
  (pg_temp.eid(3), pg_temp.mid(1)),
  (pg_temp.eid(4), pg_temp.mid(1)),
  (pg_temp.eid(5), pg_temp.mid(1)),
  (pg_temp.eid(6), pg_temp.mid(3)),
  (pg_temp.eid(7), pg_temp.mid(4));

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

-- The event numbers in a calendar_feed() result, in order.
create function pg_temp.feed_events(p_feed jsonb)
returns integer[]
language sql
as $$
  select coalesce(array_agg(right(e ->> 'id', 2)::integer order by ord), '{}')
  from jsonb_array_elements(p_feed -> 'events') with ordinality as t(e, ord)
$$;

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------

select has_table('public', 'calendar_feeds', 'public.calendar_feeds exists');
select policies_are('public', 'calendar_feeds', array['calendar_feeds_select_own'],
  'calendar_feeds has only the owner''s select policy');
select table_privs_are('public', 'calendar_feeds', 'authenticated', array[]::text[],
  'authenticated has no table-wide privileges on calendar_feeds');
select table_privs_are('public', 'calendar_feeds', 'anon', array[]::text[],
  'anon has no privileges on calendar_feeds');
select column_privs_are('public', 'calendar_feeds', 'token_hash', 'authenticated', array[]::text[],
  'authenticated can''t read token_hash');
select column_privs_are('public', 'calendar_feeds', 'last_fetched_at', 'authenticated', array['SELECT'],
  'authenticated can read last_fetched_at');
select is(
  (select pg_get_indexdef(i.indexrelid) from pg_catalog.pg_index i
   where i.indexrelid = 'public.calendar_feeds_one_live_per_user_idx'::regclass),
  'CREATE UNIQUE INDEX calendar_feeds_one_live_per_user_idx ON public.calendar_feeds USING btree (user_id) WHERE (revoked_at IS NULL)',
  'there is a partial unique index: one live link per user'
);
select ok(
  has_function_privilege('authenticated', 'public.create_calendar_feed(text)', 'execute')
  and has_function_privilege('authenticated', 'public.revoke_calendar_feed()', 'execute')
  and has_function_privilege('authenticated', 'public.calendar_feed(text)', 'execute')
  and has_function_privilege('anon', 'public.calendar_feed(text)', 'execute')
  and not has_function_privilege('anon', 'public.create_calendar_feed(text)', 'execute')
  and not has_function_privilege('anon', 'public.revoke_calendar_feed()', 'execute'),
  'the feed functions are granted as planned: only calendar_feed to anon'
);
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
   from pg_catalog.pg_proc p
   where p.oid in (
     'public.create_calendar_feed(text)'::regprocedure,
     'public.revoke_calendar_feed()'::regprocedure,
     'public.calendar_feed(text)'::regprocedure
   )),
  'the feed functions are security definer with an empty search_path'
);

-- ---------------------------------------------------------------------------
-- Creating, regenerating and revoking links
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(1);

select is(
  (select row(f.user_id, f.last_fetched_at, f.revoked_at)::text from public.create_calendar_feed(pg_temp.hash(1)) f),
  row(pg_temp.uid(1), null::timestamptz, null::timestamptz)::text,
  'a user creates a link; the result has no hash'
);
select is(
  (select array_agg(row(f.user_id, f.revoked_at is null)::text) from public.calendar_feeds f),
  array[row(pg_temp.uid(1), true)::text],
  'the user reads their own link'
);
select is(pg_temp.attempt('select token_hash from public.calendar_feeds'), 'error:42501',
  'but never its token_hash');
select is(pg_temp.attempt('select * from public.calendar_feeds'), 'error:42501',
  'not even through select *');
select is(
  pg_temp.attempt(format('insert into public.calendar_feeds (user_id, token_hash) values (%L, %L)',
    pg_temp.uid(1), pg_temp.hash(9))),
  'error:42501',
  'users can''t insert links directly'
);
select is(
  pg_temp.attempt(format($q$update public.calendar_feeds set revoked_at = null where user_id = %L$q$, pg_temp.uid(1))),
  'error:42501',
  'or update them'
);
select is(
  pg_temp.attempt('delete from public.calendar_feeds'),
  'error:42501',
  'or delete them'
);

-- Regenerating revokes the old link; only one is live.
select is(
  (select count(*)::integer from public.create_calendar_feed(pg_temp.hash(2))),
  1,
  'creating again regenerates the link'
);
select is(
  (select array_agg(f.revoked_at is null order by f.revoked_at is null) from public.calendar_feeds f),
  array[false, true],
  'the old link is revoked and the new one is live'
);
reset role;
select is(
  (select count(*)::integer from public.calendar_feeds f where f.user_id = pg_temp.uid(1) and f.revoked_at is null),
  1,
  'exactly one live link per user'
);
select is(
  pg_temp.attempt(format('insert into public.calendar_feeds (user_id, token_hash) values (%L, %L)',
    pg_temp.uid(1), pg_temp.hash(9))),
  'error:23505',
  'the database refuses a second live link, whoever writes it'
);
select is(
  pg_temp.attempt(format('insert into public.calendar_feeds (user_id, token_hash) values (%L, %L)',
    pg_temp.uid(3), pg_temp.hash(1))),
  'error:23505',
  'a token hash is unique'
);

set local role authenticated;
select pg_temp.act_as(1);
select is(pg_temp.attempt($q$select * from public.create_calendar_feed('not-a-hash')$q$), 'error:23514',
  'a malformed hash is refused');
select is(
  pg_temp.attempt(format('select * from public.create_calendar_feed(%L)', upper(repeat('ab', 32)))),
  'error:23514',
  'and so is an uppercase one'
);
select is(
  (select count(*)::integer from public.calendar_feeds f where f.revoked_at is null),
  1,
  'a refused hash doesn''t cost the user their live link'
);

select is(public.revoke_calendar_feed(), true, 'a user revokes their link');
select is(public.revoke_calendar_feed(), false, 'revoking again does nothing');
select is(
  (select count(*)::integer from public.calendar_feeds f where f.revoked_at is null),
  0,
  'no live link is left'
);

-- Other users don't see or touch someone else's links.
select pg_temp.act_as(2);
select is((select count(*)::integer from public.calendar_feeds), 0, 'a user sees none of someone else''s links');
select is(public.revoke_calendar_feed(), false, 'and revoking changes nothing of theirs');

-- No user, and anon.
select pg_temp.act_as(null);
select is(pg_temp.attempt(format('select * from public.create_calendar_feed(%L)', pg_temp.hash(8))), 'error:42501',
  'a session without a user can''t create a link');
select is(pg_temp.attempt('select public.revoke_calendar_feed()'), 'error:42501',
  'or revoke one');
reset role;
set local role anon;
select is(pg_temp.attempt(format('select * from public.create_calendar_feed(%L)', pg_temp.hash(8))), 'error:42501',
  'anon can''t create a link');
select is(pg_temp.attempt('select * from public.calendar_feeds'), 'error:42501', 'or read the table');
reset role;

-- ---------------------------------------------------------------------------
-- calendar_feed: only the owner's attended events
-- ---------------------------------------------------------------------------

-- Live links: user 01 (hash 11), user 02 (hash 12), user 03 (hash 13),
-- user 05, who has no family (hash 15).
insert into public.calendar_feeds (user_id, token_hash) values
  (pg_temp.uid(1), pg_temp.hash(11)),
  (pg_temp.uid(2), pg_temp.hash(12)),
  (pg_temp.uid(3), pg_temp.hash(13)),
  (pg_temp.uid(5), pg_temp.hash(15));

set local role anon;

select is(
  pg_temp.feed_events(public.calendar_feed(pg_temp.hash(11))),
  array[5, 1, 3],
  'anon reads the parent''s feed: events they attend, the recent past included, by start'
);
select is(
  public.calendar_feed(pg_temp.hash(11)) -> 'familyName',
  '"Family A"'::jsonb,
  'the feed carries the family name'
);
select is(
  pg_temp.feed_events(public.calendar_feed(pg_temp.hash(12))),
  array[1, 2],
  'the kid''s feed holds only the kid''s events, the shared one included'
);
select is(
  pg_temp.feed_events(public.calendar_feed(pg_temp.hash(13))),
  array[6],
  'the second parent''s feed holds only theirs'
);
select is(
  (select e from jsonb_array_elements(public.calendar_feed(pg_temp.hash(11)) -> 'events') e
   where e ->> 'id' = pg_temp.eid(1)::text) - 'updatedAt',
  jsonb_build_object(
    'id', pg_temp.eid(1),
    'title', 'Visit, the "parents"',
    'notes', 'Bring cake',
    'location', 'Cluj',
    'allDay', false,
    'startsAt', '2026-11-03T07:00:00Z',
    'endsAt', '2026-11-03T08:00:00Z',
    'timezone', 'Europe/Bucharest'
  ),
  'an event has its fields, with the times in UTC'
);
select is(
  (select (e ->> 'updatedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
   from jsonb_array_elements(public.calendar_feed(pg_temp.hash(11)) -> 'events') e
   where e ->> 'id' = pg_temp.eid(1)::text),
  true,
  'updatedAt is a UTC timestamp'
);
select is(
  (select row(e ->> 'allDay', e ->> 'startsAt', e ->> 'endsAt')::text
   from jsonb_array_elements(public.calendar_feed(pg_temp.hash(11)) -> 'events') e
   where e ->> 'id' = pg_temp.eid(3)::text),
  row('true', '2026-11-04T22:00:00Z', '2026-11-05T22:00:00Z')::text,
  'an all-day event keeps its local midnights as instants'
);
select ok(
  pg_temp.feed_events(public.calendar_feed(pg_temp.hash(11))) <> array[4],
  'an event that ended more than 90 days ago is left out'
);
select is(public.calendar_feed(pg_temp.hash(99)), null::jsonb, 'an unknown hash gets null');
select is(public.calendar_feed('nonsense'), null::jsonb, 'and so does anything that isn''t a hash');
select is(public.calendar_feed(null), null::jsonb, 'and null');
select is(pg_temp.attempt('select * from public.calendar_events'), 'error:42501',
  'anon still can''t read the events table');
reset role;

select is(
  pg_temp.feed_events(public.calendar_feed(pg_temp.hash(11))),
  array[5, 1, 3],
  'a signed-in role can read a feed by its hash too'
);

-- No family: an empty calendar, not an error.
select is(
  public.calendar_feed(pg_temp.hash(15)),
  jsonb_build_object('familyName', null, 'events', '[]'::jsonb),
  'an owner with no family gets an empty calendar'
);

-- ---------------------------------------------------------------------------
-- last_fetched_at, at most every 5 minutes
-- ---------------------------------------------------------------------------

select is(
  (select f.last_fetched_at is not null from public.calendar_feeds f where f.token_hash = pg_temp.hash(11)),
  true,
  'fetching a feed sets last_fetched_at'
);
update public.calendar_feeds set last_fetched_at = now() - interval '1 minute' where token_hash = pg_temp.hash(11);
select pg_temp.attempt(format('select public.calendar_feed(%L)', pg_temp.hash(11)));
select is(
  (select f.last_fetched_at from public.calendar_feeds f where f.token_hash = pg_temp.hash(11)),
  now() - interval '1 minute',
  'a fetch within 5 minutes leaves last_fetched_at alone'
);
update public.calendar_feeds set last_fetched_at = now() - interval '10 minutes' where token_hash = pg_temp.hash(11);
select pg_temp.attempt(format('select public.calendar_feed(%L)', pg_temp.hash(11)));
select is(
  (select f.last_fetched_at from public.calendar_feeds f where f.token_hash = pg_temp.hash(11)),
  now(),
  'a later one moves it'
);

-- ---------------------------------------------------------------------------
-- Revoking, regenerating and leaving the family
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(1);
select is(public.revoke_calendar_feed(), true, 'the parent revokes their link');
reset role;
select is(public.calendar_feed(pg_temp.hash(11)), null::jsonb, 'a revoked link gets null');

set local role authenticated;
select pg_temp.act_as(2);
select pg_temp.attempt(format('select * from public.create_calendar_feed(%L)', pg_temp.hash(22)));
reset role;
select is(public.calendar_feed(pg_temp.hash(12)), null::jsonb, 'a regenerated link''s old token gets null');
select is(
  pg_temp.feed_events(public.calendar_feed(pg_temp.hash(22))),
  array[1, 2],
  'and the new one works'
);

-- The second parent leaves the family (removed by the creator).
set local role authenticated;
select pg_temp.act_as(1);
select pg_temp.attempt(format('select public.remove_family_member(%L)', pg_temp.mid(3)));
reset role;
select is(
  public.calendar_feed(pg_temp.hash(13)),
  jsonb_build_object('familyName', null, 'events', '[]'::jsonb),
  'once the owner has left the family their feed is empty'
);

-- A deleted account's links go with it.
delete from auth.users where id = pg_temp.uid(2);
select is(public.calendar_feed(pg_temp.hash(22)), null::jsonb, 'a deleted user''s link stops working');
select is(
  (select count(*)::integer from public.calendar_feeds f where f.user_id = pg_temp.uid(2)),
  0,
  'and its rows are gone'
);

select * from finish();
rollback;
