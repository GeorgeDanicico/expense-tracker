begin;
create extension if not exists pgtap;
select plan(52);

-- R1 (docs/reminders-plan.md): reminders are private to their owner.
--
-- Users (prefix d8100000), with user number NN:
--   family A ('Family A', ...00fa): 01 parent, 02 kid (the main owner)
--   family B ('Family B', ...00fb): 03 parent
--   04 has no family.
-- Reminder ids: ...0000000a00NN, so pg_temp.visible() can turn the reminders
-- a caller sees back into numbers. Expense ids: ...0000000e00NN.
--
-- Fixture reminders (inserted as the table owner), one per user:
--   01 owned by the kid (02), with one completion (2026-10-01)
--   02 owned by the parent (01)
--   03 owned by family B's parent (03)
--   04 owned by the user with no family (04)
-- Fixture expenses: 01 the kid's, 02 the parent's.

create function pg_temp.uid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d8100000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.mid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d8100000-0000-4000-8000-0000000f00' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.rid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d8100000-0000-4000-8000-0000000a00' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.eid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d8100000-0000-4000-8000-0000000e00' || lpad(n::text, 2, '0'))::uuid
$$;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'r1-user-' || n || '@example.test', 'not-used', now(), '{}', '{}', now(), now()
from generate_series(1, 4) as n
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('d8100000-0000-4000-8000-0000000000fa', 'Family A', pg_temp.uid(1)),
  ('d8100000-0000-4000-8000-0000000000fb', 'Family B', pg_temp.uid(3));

insert into public.family_members (id, family_id, user_id, role) values
  (pg_temp.mid(1), 'd8100000-0000-4000-8000-0000000000fa', pg_temp.uid(1), 'parent'),
  (pg_temp.mid(2), 'd8100000-0000-4000-8000-0000000000fa', pg_temp.uid(2), 'kid'),
  (pg_temp.mid(3), 'd8100000-0000-4000-8000-0000000000fb', pg_temp.uid(3), 'parent');

insert into public.reminders (id, user_id, title, starts_on, repeat_unit) values
  (pg_temp.rid(1), pg_temp.uid(2), 'Feed the fish', '2026-10-01', 'week'),
  (pg_temp.rid(2), pg_temp.uid(1), 'Pay rent', '2026-10-31', 'month'),
  (pg_temp.rid(3), pg_temp.uid(3), 'Car insurance', '2026-12-01', 'year'),
  (pg_temp.rid(4), pg_temp.uid(4), 'Dentist', '2026-11-05', 'none');

insert into public.reminder_completions (reminder_id, occurrence_on) values
  (pg_temp.rid(1), '2026-10-01');

insert into public.expenses (id, user_id, description, amount, category, expense_date) values
  (pg_temp.eid(1), pg_temp.uid(2), 'Fish food', 12, 'other', '2026-10-08'),
  (pg_temp.eid(2), pg_temp.uid(1), 'Rent', 500, 'other', '2026-10-31');

-- An old updated_at, so the trigger's bump is visible.
update public.reminders set updated_at = '2020-01-01 00:00:00+00' where id = pg_temp.rid(1);

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

-- The reminder numbers the caller can read.
create function pg_temp.visible()
returns integer[]
language sql
as $$
  select coalesce(array_agg(right(r.id::text, 2)::integer order by r.id), '{}')
  from public.reminders r
  where r.id::text like 'd8100000-%'
$$;

-- The completions of reminder n the caller can read.
create function pg_temp.completions(n integer)
returns integer
language sql
as $$
  select count(*)::integer from public.reminder_completions c where c.reminder_id = pg_temp.rid(n)
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

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------

select has_table('public', 'reminders', 'public.reminders exists');
select has_table('public', 'reminder_completions', 'public.reminder_completions exists');
select ok(
  (select bool_and(c.relrowsecurity) from pg_catalog.pg_class c
   where c.oid in ('public.reminders'::regclass, 'public.reminder_completions'::regclass)),
  'RLS is enabled on reminders and reminder_completions'
);
select table_privs_are('public', 'reminders', 'authenticated', array['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  'authenticated can select, insert, update and delete reminders');
select table_privs_are('public', 'reminder_completions', 'authenticated', array['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  'authenticated can select, insert, update and delete reminder_completions');
select table_privs_are('public', 'reminders', 'anon', array[]::text[], 'anon has no privileges on reminders');
select policies_are('public', 'reminders',
  array['reminders_select_own', 'reminders_insert_own', 'reminders_update_own', 'reminders_delete_own'],
  'reminders has exactly the four owner policies');
select policies_are('public', 'reminder_completions',
  array['reminder_completions_select_own', 'reminder_completions_insert_own',
    'reminder_completions_update_own', 'reminder_completions_delete_own'],
  'reminder_completions has exactly the four owner policies');
select has_index('public', 'reminders', 'reminders_user_id_next_due_at_idx', array['user_id', 'next_due_at'],
  'reminders is indexed by user and next_due_at');
select is(
  (select pg_get_indexdef(i.indexrelid) from pg_catalog.pg_index i
   where i.indexrelid = 'public.reminders_next_notify_at_idx'::regclass),
  'CREATE INDEX reminders_next_notify_at_idx ON public.reminders USING btree (next_notify_at) WHERE ((next_notify_at IS NOT NULL) AND (NOT notifications_muted))',
  'reminders has a partial index on next_notify_at for unmuted reminders'
);
select has_trigger('public', 'reminders', 'reminders_guard', 'reminders has the reminders_guard trigger');

-- ---------------------------------------------------------------------------
-- The owner (the kid, 02) does everything with their own reminders
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(2);

select is(pg_temp.visible(), array[1], 'the owner sees only their own reminder');
select is(
  pg_temp.attempt(format($q$insert into public.reminders (id, user_id, title, starts_on, lead_minutes)
    values (%L, %L, 'Water plants', '2026-11-01', '{0, 1440, 10080}')$q$, pg_temp.rid(11), pg_temp.uid(2))),
  'rows:1',
  'the owner adds a reminder with three lead times'
);
select is(
  pg_temp.attempt(format($q$insert into public.reminders (user_id, title, starts_on)
    values (%L, 'For my parent', '2026-11-01')$q$, pg_temp.uid(1))),
  'error:42501',
  'the owner can''t add a reminder for someone else'
);
select is(
  pg_temp.attempt(format($q$update public.reminders set title = 'Feed the goldfish', notifications_muted = true
    where id = %L$q$, pg_temp.rid(1))),
  'rows:1',
  'the owner edits their reminder'
);
select ok(
  (select r.updated_at > '2021-01-01' from public.reminders r where r.id = pg_temp.rid(1)),
  'an edit bumps updated_at'
);
select is(
  pg_temp.attempt(format('update public.reminders set user_id = %L where id = %L', pg_temp.uid(1), pg_temp.rid(1))),
  'error:42501',
  'a reminder can''t be handed to another user'
);
select is(
  (select r.user_id from public.reminders r where r.id = pg_temp.rid(1)),
  pg_temp.uid(2),
  'the reminder keeps its owner'
);
select is(
  pg_temp.attempt(format($q$insert into public.reminder_completions (reminder_id, occurrence_on, expense_id)
    values (%L, '2026-10-08', %L)$q$, pg_temp.rid(1), pg_temp.eid(1))),
  'rows:1',
  'the owner marks an occurrence done, linking their own expense'
);
select is(pg_temp.completions(1), 2, 'the owner sees both completions');
select is(
  pg_temp.attempt(format($q$insert into public.reminder_completions (reminder_id, occurrence_on)
    values (%L, '2026-10-08')$q$, pg_temp.rid(1))),
  'error:23505',
  'an occurrence can''t be marked done twice'
);
select is(
  pg_temp.attempt(format($q$insert into public.reminder_completions (reminder_id, occurrence_on, expense_id)
    values (%L, '2026-10-15', %L)$q$, pg_temp.rid(1), pg_temp.eid(2))),
  'error:42501',
  'a completion can''t link someone else''s expense'
);
select is(
  pg_temp.attempt(format($q$update public.reminder_completions set done_at = now()
    where reminder_id = %L and occurrence_on = '2026-10-01'$q$, pg_temp.rid(1))),
  'rows:1',
  'the owner edits a completion'
);
select is(
  pg_temp.attempt(format($q$delete from public.reminder_completions
    where reminder_id = %L and occurrence_on = '2026-10-01'$q$, pg_temp.rid(1))),
  'rows:1',
  'the owner deletes a completion'
);
select is(
  pg_temp.attempt(format($q$insert into public.reminders (user_id, title, starts_on, lead_minutes)
    values (%L, 'Four leads', '2026-11-01', '{0, 60, 1440, 4320}')$q$, pg_temp.uid(2))),
  'error:23514',
  'a reminder can''t have four lead times'
);
select is(
  pg_temp.attempt(format($q$insert into public.reminders (user_id, title, starts_on, lead_minutes)
    values (%L, 'Duplicate leads', '2026-11-01', '{60, 60}')$q$, pg_temp.uid(2))),
  'error:23514',
  'a reminder can''t repeat a lead time'
);
select is(
  pg_temp.attempt(format($q$insert into public.reminders (user_id, title, starts_on, lead_minutes)
    values (%L, 'Odd lead', '2026-11-01', '{30}')$q$, pg_temp.uid(2))),
  'error:23514',
  'a lead time must be one of the presets'
);
select is(
  pg_temp.attempt(format($q$insert into public.reminders (user_id, title, starts_on, repeat_unit, repeat_interval)
    values (%L, 'Too sparse', '2026-11-01', 'month', 13)$q$, pg_temp.uid(2))),
  'error:23514',
  'the repeat interval is at most 12'
);
select is(
  pg_temp.attempt(format($q$insert into public.reminders (user_id, title, starts_on)
    values (%L, '   ', '2026-11-01')$q$, pg_temp.uid(2))),
  'error:23514',
  'a blank title is refused'
);
select is(
  pg_temp.attempt(format('delete from public.reminders where id = %L', pg_temp.rid(11))),
  'rows:1',
  'the owner deletes their reminder'
);

-- ---------------------------------------------------------------------------
-- The owner's parent (01) sees and changes nothing
-- ---------------------------------------------------------------------------

select pg_temp.act_as(1);

select is(pg_temp.visible(), array[2], 'the kid''s parent sees only their own reminder');
select is(
  pg_temp.attempt(format($q$update public.reminders set title = 'Changed' where id = %L$q$, pg_temp.rid(1))),
  'rows:0',
  'the parent can''t edit the kid''s reminder'
);
select is(
  pg_temp.attempt(format('delete from public.reminders where id = %L', pg_temp.rid(1))),
  'rows:0',
  'the parent can''t delete the kid''s reminder'
);
select is(pg_temp.completions(1), 0, 'the parent can''t see the kid''s completions');
select is(
  pg_temp.attempt(format($q$insert into public.reminder_completions (reminder_id, occurrence_on)
    values (%L, '2026-10-22')$q$, pg_temp.rid(1))),
  'error:42501',
  'the parent can''t mark the kid''s reminder done'
);
select is(
  pg_temp.attempt(format('update public.reminder_completions set done_at = now() where reminder_id = %L', pg_temp.rid(1))),
  'rows:0',
  'the parent can''t edit the kid''s completions'
);
select is(
  pg_temp.attempt(format('delete from public.reminder_completions where reminder_id = %L', pg_temp.rid(1))),
  'rows:0',
  'the parent can''t delete the kid''s completions'
);
select is(
  pg_temp.attempt(format($q$insert into public.reminders (user_id, title, starts_on)
    values (%L, 'For my kid', '2026-11-01')$q$, pg_temp.uid(2))),
  'error:42501',
  'the parent can''t add a reminder for the kid'
);

-- ---------------------------------------------------------------------------
-- Another family's member, a user with no family, no user, and anon
-- ---------------------------------------------------------------------------

select pg_temp.act_as(3);

select is(pg_temp.visible(), array[3], 'family B''s parent sees only their own reminder');
select is(
  pg_temp.attempt(format($q$update public.reminders set title = 'Changed' where id = %L$q$, pg_temp.rid(1))),
  'rows:0',
  'family B''s parent can''t edit family A''s reminders'
);
select is(
  pg_temp.attempt(format('delete from public.reminders where id = %L', pg_temp.rid(2))),
  'rows:0',
  'family B''s parent can''t delete family A''s reminders'
);

select pg_temp.act_as(4);

select is(pg_temp.visible(), array[4], 'a user with no family sees only their own reminder');
select is(
  pg_temp.attempt(format($q$update public.reminders set title = 'Changed' where id = %L$q$, pg_temp.rid(1))),
  'rows:0',
  'a user with no family can''t edit someone else''s reminder'
);
select is(pg_temp.completions(1), 0, 'a user with no family can''t see someone else''s completions');
select is(
  pg_temp.attempt(format($q$insert into public.reminders (id, user_id, title, starts_on)
    values (%L, %L, 'Solo', '2026-11-01')$q$, pg_temp.rid(12), pg_temp.uid(4))),
  'rows:1',
  'a user with no family adds their own reminder'
);

select pg_temp.act_as(null);
select is(pg_temp.visible(), '{}'::integer[], 'a session without a user sees no reminders');
select is(
  pg_temp.attempt($q$insert into public.reminders (user_id, title, starts_on)
    values ('d8100000-0000-4000-8000-000000000002', 'Planted', '2026-11-01')$q$),
  'error:42501',
  'a session without a user can''t add a reminder'
);

reset role;
set local role anon;
select is(pg_temp.attempt('select * from public.reminders'), 'error:42501', 'anon can''t read reminders');
select is(pg_temp.attempt('select * from public.reminder_completions'), 'error:42501',
  'anon can''t read reminder_completions');
reset role;

-- ---------------------------------------------------------------------------
-- Completions follow their reminder; reminders follow their user
-- ---------------------------------------------------------------------------

delete from public.expenses where id = pg_temp.eid(1);
select is(
  (select c.expense_id from public.reminder_completions c
   where c.reminder_id = pg_temp.rid(1) and c.occurrence_on = '2026-10-08'),
  null::uuid,
  'deleting the linked expense keeps the completion, unlinked'
);

delete from public.reminders where id = pg_temp.rid(1);
select is(pg_temp.completions(1), 0, 'deleting a reminder deletes its completions');

delete from auth.users where id = pg_temp.uid(4);
select is(
  (select count(*)::integer from public.reminders r where r.id in (pg_temp.rid(4), pg_temp.rid(12))),
  0,
  'deleting a user deletes their reminders'
);

select * from finish();
rollback;
