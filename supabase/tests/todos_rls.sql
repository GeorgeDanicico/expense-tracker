begin;
create extension if not exists pgtap;
select plan(71);

-- T1 (docs/todo-board-plan.md): the family to-do board.
--
-- Users (prefix d7100000), with user number NN:
--   family A ('Family A', ...00fa): 01 creator parent, 02 kid, 03 second parent
--   family B ('Family B', ...00fb): 04 creator parent, 05 kid
--   06 has no family.
-- Member id of user NN: ...0000000f00NN. Card ids: ...0000000c00NN, so
-- pg_temp.visible() can turn the cards a caller sees back into numbers.
--
-- Fixture cards (inserted as the table owner):
--   01 family A, created by the parent (01)
--   02 family A, created by the kid (02)
--   03 family B, created by its parent (04)
--   04 family A, created by the kid (02), for the parent to delete
--   05 family A, created by the parent (01), for the kid to delete

create function pg_temp.uid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d7100000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.mid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d7100000-0000-4000-8000-0000000f00' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.cid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d7100000-0000-4000-8000-0000000c00' || lpad(n::text, 2, '0'))::uuid
$$;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 't1-user-' || n || '@example.test', 'not-used', now(), '{}', '{}', now(), now()
from generate_series(1, 6) as n
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('d7100000-0000-4000-8000-0000000000fa', 'Family A', pg_temp.uid(1)),
  ('d7100000-0000-4000-8000-0000000000fb', 'Family B', pg_temp.uid(4));

insert into public.family_members (id, family_id, user_id, role) values
  (pg_temp.mid(1), 'd7100000-0000-4000-8000-0000000000fa', pg_temp.uid(1), 'parent'),
  (pg_temp.mid(2), 'd7100000-0000-4000-8000-0000000000fa', pg_temp.uid(2), 'kid'),
  (pg_temp.mid(3), 'd7100000-0000-4000-8000-0000000000fa', pg_temp.uid(3), 'parent'),
  (pg_temp.mid(4), 'd7100000-0000-4000-8000-0000000000fb', pg_temp.uid(4), 'parent'),
  (pg_temp.mid(5), 'd7100000-0000-4000-8000-0000000000fb', pg_temp.uid(5), 'kid');

insert into public.todos (id, family_id, title, position, created_by) values
  (pg_temp.cid(1), 'd7100000-0000-4000-8000-0000000000fa', 'Buy milk', 'a0', pg_temp.uid(1)),
  (pg_temp.cid(2), 'd7100000-0000-4000-8000-0000000000fa', 'Tidy room', 'a1', pg_temp.uid(2)),
  (pg_temp.cid(3), 'd7100000-0000-4000-8000-0000000000fb', 'Walk dog', 'a0', pg_temp.uid(4)),
  (pg_temp.cid(4), 'd7100000-0000-4000-8000-0000000000fa', 'Kid card to delete', 'a2', pg_temp.uid(2)),
  (pg_temp.cid(5), 'd7100000-0000-4000-8000-0000000000fa', 'Parent card to delete', 'a3', pg_temp.uid(1));

-- An old updated_at, so the trigger's bump is visible.
update public.todos set updated_at = '2020-01-01 00:00:00+00' where id = pg_temp.cid(1);

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

-- The card numbers the caller can read.
create function pg_temp.visible()
returns integer[]
language sql
as $$
  select coalesce(array_agg(right(t.id::text, 2)::integer order by t.id), '{}')
  from public.todos t
  where t.id::text like 'd7100000-%'
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

select has_table('public', 'todos', 'public.todos exists');
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.todos'::regclass),
  'RLS is enabled on todos'
);
select table_privs_are('public', 'todos', 'authenticated', array['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  'authenticated can select, insert, update and delete todos');
select table_privs_are('public', 'todos', 'anon', array[]::text[], 'anon has no privileges on todos');
select is(
  (select c.collation_name::text from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'todos' and c.column_name = 'position'),
  'C',
  'position uses the C collation'
);
select policies_are('public', 'todos',
  array['todos_select_family', 'todos_insert_family', 'todos_update_family', 'todos_delete_family'],
  'todos has exactly the four family policies');
select has_index('public', 'todos', 'todos_assignee_member_id_idx', array['assignee_member_id'],
  'todos is indexed by assignee');
select has_index('public', 'todos', 'todos_family_id_completed_at_idx', array['family_id', 'completed_at'],
  'todos is indexed by family and completed_at');
select has_trigger('public', 'todos', 'todos_guard', 'todos has the todos_guard trigger');

-- ---------------------------------------------------------------------------
-- The parent (01) uses the whole board, the kid's cards included
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(1);

select is(pg_temp.visible(), array[1, 2, 4, 5], 'the parent sees every card of family A');
select is(
  pg_temp.attempt(format($q$insert into public.todos (id, family_id, title, position, created_by, assignee_member_id)
    values (%L, 'd7100000-0000-4000-8000-0000000000fa', 'Feed the cat', 'Zz', %L, %L)$q$,
    pg_temp.cid(11), pg_temp.uid(1), pg_temp.mid(2))),
  'rows:1',
  'the parent adds a card assigned to the kid'
);
select is(
  pg_temp.attempt(format($q$update public.todos set title = 'Tidy your room' where id = %L$q$, pg_temp.cid(2))),
  'rows:1',
  'the parent edits the kid''s card'
);
select is(
  pg_temp.attempt(format('update public.todos set assignee_member_id = %L where id = %L', pg_temp.mid(3), pg_temp.cid(2))),
  'rows:1',
  'the parent assigns the kid''s card to the other parent'
);
select is(
  pg_temp.attempt(format($q$update public.todos set status = 'in_progress', position = 'a0' where id = %L$q$, pg_temp.cid(2))),
  'rows:1',
  'the parent moves the kid''s card to In progress'
);
select is(
  pg_temp.attempt(format('delete from public.todos where id = %L', pg_temp.cid(4))),
  'rows:1',
  'the parent deletes a card the kid created'
);
select is(
  pg_temp.attempt(format($q$insert into public.todos (family_id, title, position, created_by)
    values ('d7100000-0000-4000-8000-0000000000fa', 'Forged creator', 'Zy', %L)$q$, pg_temp.uid(2))),
  'error:42501',
  'the parent can''t add a card in the kid''s name'
);
select is(
  pg_temp.attempt($q$insert into public.todos (family_id, title, position)
    values ('d7100000-0000-4000-8000-0000000000fa', 'No creator', 'Zy')$q$),
  'error:42501',
  'a card can''t be added without a creator'
);
select is(
  pg_temp.attempt(format($q$insert into public.todos (family_id, title, position, created_by)
    values ('d7100000-0000-4000-8000-0000000000fa', 'Duplicate slot', 'Zz', %L)$q$, pg_temp.uid(1))),
  'error:23505',
  'two cards can''t share a position in one column'
);
select is(
  pg_temp.attempt(format($q$insert into public.todos (family_id, title, position, created_by)
    values ('d7100000-0000-4000-8000-0000000000fa', '   ', 'Zx', %L)$q$, pg_temp.uid(1))),
  'error:23514',
  'a blank title is refused'
);

-- ---------------------------------------------------------------------------
-- The kid (02) uses the whole board, the parent's cards included
-- ---------------------------------------------------------------------------

select pg_temp.act_as(2);

select is(pg_temp.visible(), array[1, 2, 5, 11], 'the kid sees every card of family A');
select is(
  pg_temp.attempt(format($q$insert into public.todos (id, family_id, title, status, position, created_by, assignee_member_id)
    values (%L, 'd7100000-0000-4000-8000-0000000000fa', 'Homework', 'done', 'a0', %L, %L)$q$,
    pg_temp.cid(12), pg_temp.uid(2), pg_temp.mid(1))),
  'rows:1',
  'the kid adds a card, straight into Done, assigned to the parent'
);
select is(
  (select row(t.completed_by, t.completed_at is not null)::text from public.todos t where t.id = pg_temp.cid(12)),
  row(pg_temp.uid(2), true)::text,
  'a card added in Done is completed by its creator'
);
select is(
  pg_temp.attempt(format($q$update public.todos set notes = 'Semi-skimmed' where id = %L$q$, pg_temp.cid(1))),
  'rows:1',
  'the kid edits the parent''s card'
);
select ok(
  (select t.updated_at > '2021-01-01' from public.todos t where t.id = pg_temp.cid(1)),
  'an edit bumps updated_at'
);
select is(
  pg_temp.attempt(format('update public.todos set assignee_member_id = %L where id = %L', pg_temp.mid(2), pg_temp.cid(1))),
  'rows:1',
  'the kid assigns the parent''s card to themselves'
);
select is(
  pg_temp.attempt(format($q$update public.todos set status = 'done', position = 'a1' where id = %L$q$, pg_temp.cid(1))),
  'rows:1',
  'the kid moves the parent''s card to Done'
);
select is(
  (select row(t.completed_by, t.completed_at is not null)::text from public.todos t where t.id = pg_temp.cid(1)),
  row(pg_temp.uid(2), true)::text,
  'entering Done records who completed the card and when'
);
select is(
  pg_temp.attempt(format('delete from public.todos where id = %L', pg_temp.cid(5))),
  'rows:1',
  'the kid deletes a card the parent created'
);

-- ---------------------------------------------------------------------------
-- family_id and created_by never change
-- ---------------------------------------------------------------------------

select pg_temp.act_as(1);

select is(
  pg_temp.attempt(format($q$update public.todos set family_id = 'd7100000-0000-4000-8000-0000000000fb' where id = %L$q$, pg_temp.cid(1))),
  'error:42501',
  'a card can''t move to another family'
);
select is(
  pg_temp.attempt(format('update public.todos set created_by = %L where id = %L', pg_temp.uid(2), pg_temp.cid(1))),
  'error:42501',
  'a card''s creator can''t be changed'
);
select is(
  pg_temp.attempt(format('update public.todos set created_by = null where id = %L', pg_temp.cid(2))),
  'error:42501',
  'a card''s creator can''t be cleared'
);
select is(
  (select row(t.family_id, t.created_by)::text from public.todos t where t.id = pg_temp.cid(1)),
  row('d7100000-0000-4000-8000-0000000000fa'::uuid, pg_temp.uid(1))::text,
  'the card keeps its family and creator'
);

-- ---------------------------------------------------------------------------
-- completed_at and completed_by
-- ---------------------------------------------------------------------------

select is(
  pg_temp.attempt(format($q$update public.todos set title = 'Buy oat milk', completed_by = %L,
    completed_at = '2000-01-01' where id = %L$q$, pg_temp.uid(1), pg_temp.cid(1))),
  'rows:1',
  'the parent edits a card in Done, trying to change who completed it'
);
select is(
  (select row(t.completed_by, t.completed_at > '2021-01-01')::text from public.todos t where t.id = pg_temp.cid(1)),
  row(pg_temp.uid(2), true)::text,
  'a card staying in Done keeps who completed it and when'
);
select is(
  pg_temp.attempt(format($q$update public.todos set status = 'todo', position = 'a5' where id = %L$q$, pg_temp.cid(1))),
  'rows:1',
  'the parent moves the card out of Done'
);
select is(
  (select row(t.completed_by, t.completed_at)::text from public.todos t where t.id = pg_temp.cid(1)),
  row(null::uuid, null::timestamptz)::text,
  'leaving Done clears completed_at and completed_by'
);
select is(
  pg_temp.attempt(format($q$insert into public.todos (id, family_id, title, position, created_by, completed_by, completed_at)
    values (%L, 'd7100000-0000-4000-8000-0000000000fa', 'Forged completion', 'a6', %L, %L, now())$q$,
    pg_temp.cid(13), pg_temp.uid(1), pg_temp.uid(1))),
  'rows:1',
  'the parent adds a To do card with a completion'
);
select is(
  (select row(t.completed_by, t.completed_at)::text from public.todos t where t.id = pg_temp.cid(13)),
  row(null::uuid, null::timestamptz)::text,
  'a card outside Done has no completion'
);
select is(
  pg_temp.attempt(format($q$update public.todos set status = 'done', position = 'a2' where id = %L$q$, pg_temp.cid(13))),
  'rows:1',
  'the parent moves their card to Done'
);
select is(
  (select row(t.completed_by, t.completed_at is not null)::text from public.todos t where t.id = pg_temp.cid(13)),
  row(pg_temp.uid(1), true)::text,
  'completed_by is whoever moved the card into Done'
);

-- ---------------------------------------------------------------------------
-- Assignees must be in the card's family
-- ---------------------------------------------------------------------------

select is(
  pg_temp.attempt(format('update public.todos set assignee_member_id = %L where id = %L', pg_temp.mid(4), pg_temp.cid(1))),
  'error:23514',
  'a card can''t be assigned to a member of another family'
);
select is(
  pg_temp.attempt(format($q$insert into public.todos (family_id, title, position, created_by, assignee_member_id)
    values ('d7100000-0000-4000-8000-0000000000fa', 'Foreign assignee', 'a7', %L, %L)$q$, pg_temp.uid(1), pg_temp.mid(5))),
  'error:23514',
  'a card can''t be added for a member of another family'
);
select is(
  pg_temp.attempt(format('update public.todos set assignee_member_id = null where id = %L', pg_temp.cid(11))),
  'rows:1',
  'a card can be unassigned'
);
select is(
  pg_temp.attempt(format('update public.todos set assignee_member_id = %L where id = %L', pg_temp.mid(2), pg_temp.cid(11))),
  'rows:1',
  'and assigned again'
);

-- ---------------------------------------------------------------------------
-- Another family's members see and change nothing
-- ---------------------------------------------------------------------------

select pg_temp.act_as(4);

select is(pg_temp.visible(), array[3], 'family B''s parent sees only family B''s card');
select is(
  pg_temp.attempt(format($q$update public.todos set title = 'Stolen' where id = %L$q$, pg_temp.cid(1))),
  'rows:0',
  'family B''s parent can''t edit family A''s card'
);
select is(
  pg_temp.attempt(format($q$update public.todos set status = 'done', position = 'b0' where id = %L$q$, pg_temp.cid(11))),
  'rows:0',
  'family B''s parent can''t move family A''s card'
);
select is(
  pg_temp.attempt(format('delete from public.todos where id = %L', pg_temp.cid(1))),
  'rows:0',
  'family B''s parent can''t delete family A''s card'
);
select is(
  pg_temp.attempt(format($q$insert into public.todos (family_id, title, position, created_by)
    values ('d7100000-0000-4000-8000-0000000000fa', 'Planted', 'b1', %L)$q$, pg_temp.uid(4))),
  'error:42501',
  'family B''s parent can''t add a card to family A''s board'
);
select is(
  pg_temp.attempt(format('update public.todos set assignee_member_id = %L where id = %L', pg_temp.mid(1), pg_temp.cid(3))),
  'error:23514',
  'family B''s parent can''t assign their card to a member of family A'
);
select is(
  pg_temp.attempt(format($q$insert into public.todos (family_id, title, position, created_by)
    values ('d7100000-0000-4000-8000-0000000000fb', 'Sorted', 'Zz', %L)$q$, pg_temp.uid(4))),
  'rows:1',
  'family B''s parent adds a card to their own board'
);
select is(
  (select array_agg(t.position order by t.position) from public.todos t
   where t.family_id = 'd7100000-0000-4000-8000-0000000000fb' and t.status = 'todo'),
  array['Zz', 'a0'],
  'positions sort byte by byte (upper case before lower case)'
);

select pg_temp.act_as(5);

select is(pg_temp.visible(), array[3], 'family B''s kid sees only family B''s card');
select is(
  pg_temp.attempt(format($q$update public.todos set title = 'Stolen' where id = %L$q$, pg_temp.cid(2))),
  'rows:0',
  'family B''s kid can''t edit family A''s card'
);
select is(
  pg_temp.attempt(format('delete from public.todos where id = %L', pg_temp.cid(2))),
  'rows:0',
  'family B''s kid can''t delete family A''s card'
);

-- ---------------------------------------------------------------------------
-- A user with no family, a session with no user, and anon
-- ---------------------------------------------------------------------------

select pg_temp.act_as(6);

select is(pg_temp.visible(), '{}'::integer[], 'a user with no family sees no cards');
select is(
  pg_temp.attempt(format($q$update public.todos set title = 'Stolen' where id = %L$q$, pg_temp.cid(1))),
  'rows:0',
  'a user with no family can''t edit a card'
);
select is(
  pg_temp.attempt(format('delete from public.todos where id = %L', pg_temp.cid(1))),
  'rows:0',
  'a user with no family can''t delete a card'
);
select is(
  pg_temp.attempt(format($q$insert into public.todos (family_id, title, position, created_by)
    values ('d7100000-0000-4000-8000-0000000000fa', 'Planted', 'b2', %L)$q$, pg_temp.uid(6))),
  'error:42501',
  'a user with no family can''t add a card to a family''s board'
);

select pg_temp.act_as(null);
select is(pg_temp.visible(), '{}'::integer[], 'a session without a user sees no cards');

reset role;
set local role anon;
select is(pg_temp.attempt('select * from public.todos'), 'error:42501', 'anon can''t read todos');
reset role;

-- ---------------------------------------------------------------------------
-- Removing a member
-- ---------------------------------------------------------------------------

-- Before: cards 01 and 11 are assigned to the kid; the kid created 02 and 12.
select is(
  (select array_agg(right(t.id::text, 2)::integer order by t.id) from public.todos t
   where t.assignee_member_id = pg_temp.mid(2)),
  array[1, 11],
  'before the removal, cards 01 and 11 are assigned to the kid'
);

set local role authenticated;
select pg_temp.act_as(1);
select lives_ok(
  format('select public.remove_family_member(%L)', pg_temp.mid(2)),
  'the creator removes the kid'
);
reset role;

select is(
  (select count(*)::integer from public.todos t
   where t.id in (pg_temp.cid(1), pg_temp.cid(11)) and t.assignee_member_id is null),
  2,
  'removing a member unassigns their cards'
);
select is(
  (select array_agg(right(t.id::text, 2)::integer order by t.id) from public.todos t
   where t.created_by = pg_temp.uid(2)),
  array[2, 12],
  'removing a member keeps the cards they created'
);

set local role authenticated;
select pg_temp.act_as(2);
select is(pg_temp.visible(), '{}'::integer[], 'the removed kid no longer sees the board');
select pg_temp.act_as(3);
select is(pg_temp.visible(), array[1, 2, 11, 12, 13], 'the board still shows every card to the family');
reset role;

-- Deleting the kid's user clears created_by and completed_by but keeps the cards.
delete from auth.users where id = pg_temp.uid(2);
select is(
  (select array_agg(row(right(t.id::text, 2)::integer, t.created_by, t.completed_by, t.status)::text order by t.id)
   from public.todos t where t.id in (pg_temp.cid(2), pg_temp.cid(12))),
  array[
    row(2, null::uuid, null::uuid, 'in_progress')::text,
    row(12, null::uuid, null::uuid, 'done')::text
  ],
  'deleting a user keeps their cards, without a creator or completer'
);

-- ---------------------------------------------------------------------------
-- Deleting the family
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(1);
select lives_ok($$ select public.delete_family('Family A') $$, 'the creator deletes family A');
reset role;

select is(
  (select count(*)::integer from public.todos t where t.family_id = 'd7100000-0000-4000-8000-0000000000fa'),
  0,
  'deleting the family deletes every card'
);
select is(
  (select count(*)::integer from public.todos t where t.family_id = 'd7100000-0000-4000-8000-0000000000fb'),
  2,
  'family B''s cards are untouched'
);

select * from finish();
rollback;
