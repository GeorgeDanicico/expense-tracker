begin;
create extension if not exists pgtap;
select plan(97);

-- I14 (docs/statement-import-plan.md): the AI gate's tables and functions.
-- app_flags, ai_usage, profiles.ai_enabled and its guard, the `ai` kid
-- permission, my_ai_access(), ai_family_spend(), ai_global_spend(), the
-- 'ai_budget' notification kind and create_import_batch()'s optional category
-- fields.
--
-- Users (prefix d1400000, see pg_temp.uid):
--   01 solo        02 parent in family A      03 kid in A with ai at edit
--   04 kid in A, no ai row     05 solo, joins A later     06 parent in A, leaves later
--   07 solo, has spend         08 parent in family B       09 solo, deleted at the end
-- Families: a1 (A) and b1 (B).
-- Member ids: pg_temp.mid(n), the member row of user n.

create function pg_temp.uid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d1400000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.mid(n integer)
returns uuid
language sql
immutable
as $$
  select ('d1400000-0000-4000-8000-00000000a0' || lpad(n::text, 2, '0'))::uuid
$$;

create function pg_temp.h(p_label text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(p_label, 'UTF8')), 'hex')
$$;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'i14-' || n || '@example.test', 'not-used', now(), '{}', '{}', now(), now()
from generate_series(1, 9) as n
on conflict (id) do nothing;

insert into public.profiles (id)
select u.id from auth.users u where u.id::text like 'd1400000-%'
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('d1400000-0000-4000-8000-0000000000a1', 'Family A', pg_temp.uid(2)),
  ('d1400000-0000-4000-8000-0000000000b1', 'Family B', pg_temp.uid(8));

insert into public.family_members (id, family_id, user_id, role) values
  (pg_temp.mid(2), 'd1400000-0000-4000-8000-0000000000a1', pg_temp.uid(2), 'parent'),
  (pg_temp.mid(3), 'd1400000-0000-4000-8000-0000000000a1', pg_temp.uid(3), 'kid'),
  (pg_temp.mid(4), 'd1400000-0000-4000-8000-0000000000a1', pg_temp.uid(4), 'kid'),
  (pg_temp.mid(6), 'd1400000-0000-4000-8000-0000000000a1', pg_temp.uid(6), 'parent'),
  (pg_temp.mid(8), 'd1400000-0000-4000-8000-0000000000b1', pg_temp.uid(8), 'parent');

-- 03 may use AI; 04 has other permissions but none for ai.
insert into public.member_permissions (member_id, module, level) values
  (pg_temp.mid(3), 'expenses', 'edit'),
  (pg_temp.mid(3), 'ai', 'edit'),
  (pg_temp.mid(4), 'expenses', 'edit');

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

create function pg_temp.switch_of(n integer)
returns boolean
language sql
as $$
  select ai_enabled from public.profiles where id = pg_temp.uid(n)
$$;

-- Turns a user's switch on or off as a trusted writer, past the guard.
create function pg_temp.set_switch(n integer, p_enabled boolean)
returns void
language sql
as $$
  update public.profiles set ai_enabled = p_enabled where id = pg_temp.uid(n)
$$;

-- Whether the member_permissions check accepts a (module, level) pair.
create function pg_temp.accepts_permission(p_module text, p_level text)
returns boolean
language plpgsql
as $$
begin
  insert into public.member_permissions (member_id, module, level)
  values (pg_temp.mid(4), p_module, p_level);
  delete from public.member_permissions
  where member_id = pg_temp.mid(4) and module = p_module;
  return true;
exception when check_violation then
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Flags
-- ---------------------------------------------------------------------------

select is(
  (select value from public.app_flags where key = 'ai_enabled'),
  'true'::jsonb,
  'the ai_enabled flag starts on'
);
select ok(
  not has_table_privilege('anon', 'public.app_flags', 'select')
  and has_table_privilege('authenticated', 'public.app_flags', 'select')
  and not has_table_privilege('authenticated', 'public.app_flags', 'insert')
  and not has_table_privilege('authenticated', 'public.app_flags', 'update')
  and not has_table_privilege('authenticated', 'public.app_flags', 'delete')
  and has_table_privilege('service_role', 'public.app_flags', 'select')
  and not has_table_privilege('service_role', 'public.app_flags', 'update'),
  'signed-in users read the flags and nobody writes the table directly'
);

set local role authenticated;
select pg_temp.act_as(1);
select is(
  (select value from public.app_flags where key = 'ai_enabled'),
  'true'::jsonb,
  'a signed-in user reads the flag'
);
select is(
  pg_temp.attempt($$ update public.app_flags set value = 'false'::jsonb where key = 'ai_enabled' $$),
  'error:42501',
  'a signed-in user cannot write a flag'
);
select is(
  pg_temp.attempt($$ select public.set_app_flag('ai_enabled', 'false'::jsonb, null) $$),
  'error:42501',
  'a signed-in user cannot call set_app_flag'
);
reset role;

set local role service_role;
select lives_ok(
  format($$ select public.set_app_flag('ai_enabled', 'false'::jsonb, %L) $$, pg_temp.uid(2)),
  'service_role sets a flag'
);
reset role;
select is(
  (select row(f.value, f.updated_by)::text from public.app_flags f where f.key = 'ai_enabled'),
  format('(false,%s)', pg_temp.uid(2)),
  'the flag holds the new value and who set it'
);
select ok(
  (select f.updated_at >= now() - interval '1 minute' from public.app_flags f where f.key = 'ai_enabled'),
  'and when'
);
set local role service_role;
select lives_ok(
  $$ select public.set_app_flag('ai_enabled', 'true'::jsonb) $$,
  'the gate sets a flag without a user'
);
select is(
  pg_temp.attempt($$ select public.set_app_flag('no_such_flag', 'true'::jsonb) $$),
  'error:P0002',
  'an unknown flag is refused'
);
select is(
  pg_temp.attempt($$ select public.set_app_flag('ai_enabled', null) $$),
  'error:22023',
  'a null value is refused'
);
reset role;
select is(
  (select row(f.value, f.updated_by)::text from public.app_flags f where f.key = 'ai_enabled'),
  '(true,)',
  'the flag is back on with no user recorded'
);

-- ---------------------------------------------------------------------------
-- The permission catalogue
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(l order by l)
   from unnest(array['off', 'view', 'edit', 'admin']) as l
   where pg_temp.accepts_permission('ai', l)),
  array['edit', 'off'],
  'the member_permissions check allows ai at off and edit only'
);
select ok(
  family_private.is_valid_permissions(
    '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}')
  and family_private.is_valid_permissions(
    '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"edit"}'),
  'a permissions object with ai off or edit is valid'
);
select ok(
  not family_private.is_valid_permissions(
    '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"view"}'),
  'ai at view is not'
);
select ok(
  not family_private.is_valid_permissions(
    '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off"}'),
  'a permissions object without ai is no longer complete'
);
select is(
  family_private.module_keys(),
  array['expenses', 'investments', 'net_worth', 'family_finance', 'mcp', 'ai'],
  'module_keys ends with ai'
);

-- A pending kid invite from before the migration: the old five-module object.
-- The migration's backfill ran during replay, before this row existed, so it is
-- repeated below exactly as the migration has it.
insert into public.family_invites
  (id, family_id, code_hash, role, permissions, created_by, expires_at)
values
  ('d1400000-0000-4000-8000-0000000000c1', 'd1400000-0000-4000-8000-0000000000a1', pg_temp.h('old-kid'), 'kid',
   '{"expenses":"edit","investments":"off","net_worth":"edit","family_finance":"view","mcp":"off"}',
   pg_temp.uid(2), now() + interval '7 days');

select ok(
  not family_private.is_valid_permissions(
    (select i.permissions from public.family_invites i where i.id = 'd1400000-0000-4000-8000-0000000000c1')),
  'without the backfill, the old invite''s permissions would be refused'
);

update public.family_invites
set permissions = permissions || '{"ai": "off"}'::jsonb
where role = 'kid' and not permissions ? 'ai';

select is(
  (select i.permissions from public.family_invites i where i.id = 'd1400000-0000-4000-8000-0000000000c1'),
  '{"expenses":"edit","investments":"off","net_worth":"edit","family_finance":"view","mcp":"off","ai":"off"}'::jsonb,
  'the backfill adds ai off and keeps the other levels'
);

set local role authenticated;
select pg_temp.act_as(9);
select lives_ok(
  $$ select public.redeem_family_invite(pg_temp.h('old-kid')) $$,
  'a pending kid invite created before the migration still redeems'
);
select is(
  (select m.permissions ->> 'ai' from public.get_my_membership() m),
  'off',
  'and the kid who redeemed it has ai off'
);
reset role;
-- 09 was only here to redeem; make them solo again.
delete from public.family_members where user_id = pg_temp.uid(9);

select pg_temp.act_as(2);
set local role authenticated;
select is(
  (select e -> 'permissions' ->> 'ai'
   from jsonb_array_elements(public.get_family() -> 'members') as e
   where e ->> 'memberId' = pg_temp.mid(4)::text),
  'off',
  'get_family reports ai off for a kid without an ai row'
);
select is(
  (select e -> 'permissions' ->> 'ai'
   from jsonb_array_elements(public.get_family() -> 'members') as e
   where e ->> 'memberId' = pg_temp.mid(3)::text),
  'edit',
  'and edit for a kid with one'
);
select throws_ok(
  format($$ select public.set_member_permissions(%L,
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off"}') $$, pg_temp.mid(4)),
  '23514', 'Choose an allowed level for every module.',
  'set_member_permissions refuses an object without ai'
);
reset role;

-- ---------------------------------------------------------------------------
-- The opt-in switch, its guard and my_ai_access
-- ---------------------------------------------------------------------------

select col_default_is('public', 'profiles', 'ai_enabled', 'false', 'the switch is off by default');
select col_not_null('public', 'profiles', 'ai_enabled', 'the switch is never null');
select is(pg_temp.switch_of(1), false, 'a user starts with the switch off');

select ok(
  not has_function_privilege('authenticated', 'ai_private.kid_ai_permitted(uuid)', 'execute')
  and not has_function_privilege('service_role', 'ai_private.kid_ai_permitted(uuid)', 'execute'),
  'kid_ai_permitted is ungranted'
);
select ok(ai_private.kid_ai_permitted(pg_temp.uid(1)), 'a user without a family is permitted');
select ok(ai_private.kid_ai_permitted(pg_temp.uid(2)), 'a parent is permitted');
select ok(ai_private.kid_ai_permitted(pg_temp.uid(3)), 'a kid with ai at edit is permitted');
select ok(not ai_private.kid_ai_permitted(pg_temp.uid(4)), 'a kid without an ai row is not');

set local role authenticated;

select pg_temp.act_as(1);
select is(public.my_ai_access(), 'ai_off', 'my_ai_access: a user with the switch off');
select lives_ok(
  format($$ update public.profiles set ai_enabled = true where id = %L $$, pg_temp.uid(1)),
  'a user without a family can turn the switch on'
);
select is(public.my_ai_access(), 'ok', 'my_ai_access: the same user with it on');
select lives_ok(
  format($$ update public.profiles set ai_enabled = false where id = %L $$, pg_temp.uid(1)),
  'and off again'
);

select pg_temp.act_as(2);
select lives_ok(
  format($$ update public.profiles set ai_enabled = true where id = %L $$, pg_temp.uid(2)),
  'a parent can turn the switch on'
);
select is(public.my_ai_access(), 'ok', 'my_ai_access: a parent with it on');

select pg_temp.act_as(4);
select throws_ok(
  format($$ update public.profiles set ai_enabled = true where id = %L $$, pg_temp.uid(4)),
  '42501', 'A parent needs to turn on AI features for you.',
  'a kid without the ai permission cannot turn the switch on'
);
select is(public.my_ai_access(), 'not_permitted', 'my_ai_access: that kid is not_permitted');

select pg_temp.act_as(3);
select is(public.my_ai_access(), 'ai_off', 'my_ai_access: a permitted kid with the switch off');
select lives_ok(
  format($$ update public.profiles set ai_enabled = true where id = %L $$, pg_temp.uid(3)),
  'a kid with ai at edit can turn the switch on'
);
select is(public.my_ai_access(), 'ok', 'my_ai_access: that kid with it on');

reset role;

-- A kid whose switch is on while the permission is off (set directly, as an
-- older state could be) can always turn it off.
select pg_temp.set_switch(4, true);
set local role authenticated;
select pg_temp.act_as(4);
select is(public.my_ai_access(), 'not_permitted', 'a kid with the switch on and the permission off is not_permitted');
select lives_ok(
  format($$ update public.profiles set ai_enabled = false where id = %L $$, pg_temp.uid(4)),
  'and can still turn the switch off'
);
reset role;

-- Turning a kid's ai permission off turns their switch off, once the
-- permission rows are final at the end of the transaction. 03's switch is on.
select is(pg_temp.switch_of(3), true, '03 starts with the switch on');

set local role authenticated;
select pg_temp.act_as(2);
select lives_ok(
  format($$ select public.set_member_permissions(%L,
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"edit"}') $$, pg_temp.mid(3)),
  'a parent saves a kid''s permissions with ai still at edit'
);
reset role;
set constraints member_permissions_sync_ai_switch immediate;
set constraints member_permissions_sync_ai_switch deferred;
select is(pg_temp.switch_of(3), true, 'saving permissions with ai at edit leaves the kid''s switch on');

set local role authenticated;
select pg_temp.act_as(2);
select lives_ok(
  format($$ select public.set_member_permissions(%L,
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}') $$, pg_temp.mid(3)),
  'a parent turns the kid''s ai permission off'
);
reset role;
set constraints member_permissions_sync_ai_switch immediate;
set constraints member_permissions_sync_ai_switch deferred;
select is(pg_temp.switch_of(3), false, 'the kid''s switch is off');
select is(pg_temp.switch_of(2), true, 'a parent''s switch is untouched');

-- A kid who loses the permission by the row going away (not an update) too.
select pg_temp.set_switch(3, true);
update public.member_permissions set level = 'edit' where member_id = pg_temp.mid(3) and module = 'ai';
delete from public.member_permissions where member_id = pg_temp.mid(3) and module = 'ai';
set constraints member_permissions_sync_ai_switch immediate;
set constraints member_permissions_sync_ai_switch deferred;
select is(pg_temp.switch_of(3), false, 'deleting the permission row turns the switch off too');

-- Other modules do not matter.
select pg_temp.set_switch(3, true);
update public.member_permissions set level = 'off' where member_id = pg_temp.mid(3) and module = 'expenses';
set constraints member_permissions_sync_ai_switch immediate;
set constraints member_permissions_sync_ai_switch deferred;
select is(pg_temp.switch_of(3), true, 'changing another module leaves the switch alone');
select pg_temp.set_switch(3, false);

-- ---------------------------------------------------------------------------
-- The ledger: RLS and checks
-- ---------------------------------------------------------------------------

-- This month (month start 2026-10-01 for these tests) unless stated.
--   family A: 02 1,000,000   03 500,000   06 250,000   02 9,000,000 last month
--   05 solo: 300,000   07 solo: 400,000   family B (08): 2,000,000
insert into public.ai_usage (user_id, family_id, feature, provider, model,
  input_tokens, output_tokens, cached_input_tokens, cost_micros, outcome, created_at) values
  (pg_temp.uid(2), 'd1400000-0000-4000-8000-0000000000a1', 'statements', 'fake', 'fake-1', 6000, 5000, 0, 1000000, 'ok', '2026-10-10 10:00+00'),
  (pg_temp.uid(3), 'd1400000-0000-4000-8000-0000000000a1', 'statements', 'fake', 'fake-1', 3000, 2500, 0, 500000, 'ok', '2026-10-11 10:00+00'),
  (pg_temp.uid(6), 'd1400000-0000-4000-8000-0000000000a1', 'statements', 'fake', 'fake-1', 1500, 1200, 0, 250000, 'refusal', '2026-10-12 10:00+00'),
  (pg_temp.uid(2), 'd1400000-0000-4000-8000-0000000000a1', 'statements', 'fake', 'fake-1', 60000, 50000, 0, 9000000, 'ok', '2026-09-15 10:00+00'),
  (pg_temp.uid(5), null, 'statements', 'fake', 'fake-1', 1000, 1000, 0, 300000, 'ok', '2026-10-13 10:00+00'),
  (pg_temp.uid(7), null, 'statements', 'fake', 'fake-1', 1000, 1000, 0, 400000, 'ok', '2026-10-14 10:00+00'),
  (pg_temp.uid(8), 'd1400000-0000-4000-8000-0000000000b1', 'statements', 'fake', 'fake-1', 8000, 8000, 0, 2000000, 'ok', '2026-10-15 10:00+00');

select ok(
  has_table_privilege('authenticated', 'public.ai_usage', 'select')
  and not has_table_privilege('authenticated', 'public.ai_usage', 'insert')
  and not has_table_privilege('authenticated', 'public.ai_usage', 'update')
  and not has_table_privilege('authenticated', 'public.ai_usage', 'delete')
  and not has_table_privilege('anon', 'public.ai_usage', 'select')
  and has_table_privilege('service_role', 'public.ai_usage', 'insert')
  and has_table_privilege('service_role', 'public.ai_usage', 'select')
  and not has_table_privilege('service_role', 'public.ai_usage', 'update')
  and not has_table_privilege('service_role', 'public.ai_usage', 'delete'),
  'the ledger is read by owners, written by the server, and never updated or deleted'
);

set local role authenticated;
select pg_temp.act_as(2);
select is(
  (select array_agg(u.cost_micros order by u.cost_micros) from public.ai_usage u),
  array[1000000::bigint, 9000000],
  'a parent reads only their own rows'
);
select pg_temp.act_as(3);
select is(
  (select array_agg(u.cost_micros) from public.ai_usage u),
  array[500000::bigint],
  'a kid reads only their own rows'
);
select pg_temp.act_as(1);
select is((select count(*)::integer from public.ai_usage), 0, 'a user without calls reads none');
select is(
  pg_temp.attempt(format($$ insert into public.ai_usage (user_id, feature, provider, model, outcome)
    values (%L, 'statements', 'fake', 'fake-1', 'ok') $$, pg_temp.uid(1))),
  'error:42501',
  'a signed-in user cannot insert a ledger row'
);
select is(
  pg_temp.attempt($$ update public.ai_usage set cost_micros = 0 $$),
  'error:42501',
  'a signed-in user cannot update the ledger'
);
select is(
  pg_temp.attempt($$ delete from public.ai_usage $$),
  'error:42501',
  'a signed-in user cannot delete from the ledger'
);
reset role;

set local role service_role;
select is(
  pg_temp.attempt(format($$ insert into public.ai_usage (user_id, feature, provider, model, outcome)
    values (%L, 'statements', 'fake', 'fake-1', 'timeout') $$, pg_temp.uid(1))),
  'rows:1',
  'service_role inserts a ledger row; the counts default to zero'
);
select is(
  pg_temp.attempt($$ update public.ai_usage set cost_micros = 0 $$),
  'error:42501',
  'service_role cannot update the ledger'
);
select is(
  pg_temp.attempt($$ delete from public.ai_usage $$),
  'error:42501',
  'service_role cannot delete from the ledger'
);
select is(
  pg_temp.attempt(format($$ insert into public.ai_usage (user_id, feature, provider, model, outcome)
    values (%L, 'Statements', 'fake', 'fake-1', 'ok') $$, pg_temp.uid(1))),
  'error:23514',
  'a feature is a short lowercase key'
);
select is(
  pg_temp.attempt(format($$ insert into public.ai_usage (user_id, feature, provider, model, outcome, cost_micros)
    values (%L, 'statements', 'fake', 'fake-1', 'ok', -1) $$, pg_temp.uid(1))),
  'error:23514',
  'a cost cannot be negative'
);
select is(
  pg_temp.attempt(format($$ insert into public.ai_usage (user_id, feature, provider, model, outcome, input_tokens)
    values (%L, 'statements', 'fake', 'fake-1', 'ok', -1) $$, pg_temp.uid(1))),
  'error:23514',
  'token counts cannot be negative'
);
reset role;

-- The failed-call row 01 got above counts as theirs, at zero cost.
select is(
  (select count(*)::integer from public.ai_usage where user_id = pg_temp.uid(1) and outcome = 'timeout'),
  1,
  'the failed call is in the ledger'
);
delete from public.ai_usage where user_id = pg_temp.uid(1);

-- A deleted user's rows stay, for the global total; the family's too.
insert into public.ai_usage (user_id, family_id, feature, provider, model, cost_micros, outcome, created_at)
values (pg_temp.uid(9), null, 'statements', 'fake', 'fake-1', 100000, 'ok', '2026-10-16 10:00+00');
delete from auth.users where id = pg_temp.uid(9);
select is(
  (select row(count(*), min(user_id::text))::text from public.ai_usage where cost_micros = 100000),
  '(1,)',
  'deleting a user keeps their ledger rows, without the user'
);

-- ---------------------------------------------------------------------------
-- Spend
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.ai_family_spend(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.ai_family_spend(timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.ai_global_spend(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.ai_global_spend(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.ai_global_spend(timestamptz)', 'execute'),
  'ai_family_spend is for signed-in users and ai_global_spend for service_role only'
);

set local role authenticated;

select pg_temp.act_as(2);
select is(public.ai_family_spend('2026-10-01 00:00+00'), 1750000::bigint,
  'a parent sees the family''s month: every member''s rows, not last month''s');
select pg_temp.act_as(3);
select is(public.ai_family_spend('2026-10-01 00:00+00'), 1750000::bigint,
  'a kid sees the same total without reading the others'' rows');
select is(public.ai_family_spend('2026-09-01 00:00+00'), 10750000::bigint,
  'an earlier month start includes the earlier rows');
select is(public.ai_family_spend('2026-11-01 00:00+00'), 0::bigint,
  'a new month starts from zero');

select pg_temp.act_as(8);
select is(public.ai_family_spend('2026-10-01 00:00+00'), 2000000::bigint,
  'another family has its own total');

select pg_temp.act_as(7);
select is(public.ai_family_spend('2026-10-01 00:00+00'), 400000::bigint,
  'a user without a family counts only their own rows');

select pg_temp.act_as(1);
select is(public.ai_family_spend('2026-10-01 00:00+00'), 0::bigint,
  'a user without a family or rows is at zero');

select pg_temp.act_as(null);
select is(pg_temp.attempt($$ select public.ai_family_spend('2026-10-01 00:00+00') $$), 'error:42501',
  'a session without a user is refused');
select pg_temp.act_as(2);
select is(pg_temp.attempt($$ select public.ai_family_spend(null) $$), 'error:22023',
  'a missing month start is refused');
select is(pg_temp.attempt($$ select public.ai_global_spend('2026-10-01 00:00+00') $$), 'error:42501',
  'a signed-in user cannot read the global spend');
reset role;

-- 05 joins family A: their earlier solo spend stays theirs, and the family's
-- total doesn't change.
insert into public.family_members (id, family_id, user_id, role) values
  (pg_temp.mid(5), 'd1400000-0000-4000-8000-0000000000a1', pg_temp.uid(5), 'kid');
set local role authenticated;
select pg_temp.act_as(5);
select is(public.ai_family_spend('2026-10-01 00:00+00'), 1750000::bigint,
  'a member who joins sees the family''s total, without their earlier spend in it');
select pg_temp.act_as(2);
select is(public.ai_family_spend('2026-10-01 00:00+00'), 1750000::bigint,
  'and the family''s total did not grow');
reset role;

-- 06 leaves: the family keeps their past rows, and 06 starts again alone.
delete from public.family_members where id = pg_temp.mid(6);
set local role authenticated;
select pg_temp.act_as(2);
select is(public.ai_family_spend('2026-10-01 00:00+00'), 1750000::bigint,
  'a member who left keeps their spend in the family''s month');
select pg_temp.act_as(6);
select is(public.ai_family_spend('2026-10-01 00:00+00'), 0::bigint,
  'and the one who left starts alone from zero');
reset role;

set local role service_role;
select is(public.ai_global_spend('2026-10-01 00:00+00'), 4550000::bigint,
  'the global spend is everyone''s month, including a deleted user''s rows');
select is(public.ai_global_spend('2026-10-16 00:00+00'), 100000::bigint,
  'from a later start it only counts rows since');
select is(public.ai_global_spend('2026-10-17 00:00+00'), 0::bigint, 'and nothing after the last row');
select is(public.ai_global_spend('2026-11-01 00:00+00'), 0::bigint, 'a new month starts from zero');
select is(pg_temp.attempt($$ select public.ai_global_spend(null) $$), 'error:22023',
  'a missing month start is refused');
reset role;

-- ---------------------------------------------------------------------------
-- The notification kind
-- ---------------------------------------------------------------------------

select lives_ok(
  format($$ insert into public.notifications (user_id, kind, payload, dedupe_key)
    values (%L, 'ai_budget', '{"title":"t","body":"b","url":"/settings","tag":"ai-budget"}', 'ai_budget:test') $$, pg_temp.uid(2)),
  'the outbox takes an ai_budget notification'
);
select throws_ok(
  format($$ insert into public.notifications (user_id, kind, payload) values (%L, 'ai_unknown', '{}') $$, pg_temp.uid(2)),
  '23514', null,
  'and still refuses an unknown kind'
);

-- ---------------------------------------------------------------------------
-- create_import_batch with categories
-- ---------------------------------------------------------------------------

create function pg_temp.batch(p_hash_n integer)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'source_kind', 'pdf',
    'parser_id', 'ai:statement-reader-v1',
    'content_hash', lpad(to_hex(p_hash_n), 64, '0'),
    'currency', 'RON'
  )
$$;

create function pg_temp.draft_row(p_description text, p_extra jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'expense_date', '2026-10-05',
    'description', p_description,
    'amount', 12.5,
    'currency', 'RON'
  ) || p_extra
$$;

create function pg_temp.saved(p_batch uuid)
returns text[]
language sql
as $$
  select array_agg(row(r.position, r.description, r.category, r.subtype, r.rule_matched, r.category_source)::text order by r.position)
  from public.import_rows r
  where r.batch_id = p_batch
$$;

set local role authenticated;
select pg_temp.act_as(1);

create temp table saved_batch (id uuid) on commit drop;

insert into saved_batch
select public.create_import_batch(pg_temp.batch(1), jsonb_build_array(
  pg_temp.draft_row('Lidl Cluj', '{"category": "groceries", "category_source": "ai"}'),
  pg_temp.draft_row('Mega Image', '{"category": "groceries", "category_source": "history"}'),
  pg_temp.draft_row('Garage Popescu', '{"category": "car", "subtype": "car_repairs", "category_source": "ai"}'),
  pg_temp.draft_row('OMV 1642 Satu Mare', '{"category": "shopping", "subtype": null, "category_source": "ai"}'),
  pg_temp.draft_row('Unknown shop'),
  pg_temp.draft_row('Another shop', '{"category_source": "ai"}')
));

select is(
  pg_temp.saved((select id from saved_batch)),
  array[
    '(1,"Lidl Cluj",groceries,,f,ai)',
    '(2,"Mega Image",groceries,,f,history)',
    '(3,"Garage Popescu",car,car_repairs,f,ai)',
    '(4,"OMV 1642 Satu Mare",car,car_fuel,t,rule)',
    '(5,"Unknown shop",other,,f,)',
    '(6,"Another shop",other,,f,)'
  ],
  'a row keeps the category it was given and its source; a recognised merchant wins with source rule; a row without a category is other with no source'
);

select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(2),
    jsonb_build_array(pg_temp.draft_row('Shop', '{"category": "boats"}')))),
  'error:23514',
  'a category outside the list fails the call'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(3),
    jsonb_build_array(pg_temp.draft_row('Shop', '{"category": "groceries", "subtype": "car_fuel"}')))),
  'error:23514',
  'a subtype on a category other than car fails the call'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(4),
    jsonb_build_array(pg_temp.draft_row('Shop', '{"category": "groceries", "category_source": "guess"}')))),
  'error:23514',
  'a category source outside rule, history and ai fails the call'
);
select is(
  pg_temp.attempt(format('select public.create_import_batch(%L::jsonb, %L::jsonb)', pg_temp.batch(5),
    jsonb_build_array(pg_temp.draft_row('Shop', '{"subtype": "car_fuel"}')))),
  'error:23514',
  'a subtype without the car category fails the call'
);
select is(
  (select count(*)::integer from public.import_batches where content_hash in
    (lpad(to_hex(2), 64, '0'), lpad(to_hex(3), 64, '0'), lpad(to_hex(4), 64, '0'), lpad(to_hex(5), 64, '0'))),
  0,
  'the refused calls saved nothing'
);

reset role;

select is(
  (select data_type from information_schema.columns
   where table_schema = 'public' and table_name = 'import_rows' and column_name = 'category_source'),
  'text',
  'import_rows has a category_source column'
);
select * from finish();
rollback;
