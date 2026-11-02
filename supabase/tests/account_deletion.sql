begin;
create extension if not exists pgtap;
select plan(65);

-- S13: app_private.delete_owned_rows(), delete_my_data(), delete_managed_kid_data() and
-- export_my_data().
--
-- Users (prefix e1300000):
--   01 no family: deletes their account
--   02 no family: an ordinary other user, never touched
--   family F ('Family F'): 03 creator, 04 second parent, 05 managed kid, 06 kid with their own account
--   family G ('Family G'): 07 creator, 08 managed kid
-- Members: f3..f6 in family f1 and g7, g8 in family g1, by user.
-- Users 01, 02, 05 and 08 each get one row in every table a user owns (pg_temp.seed). User 01 also
-- created, completed and used family F's rows before they left it.

create function pg_temp.uid(p_n integer)
returns uuid
language sql
immutable
as $$ select ('e1300000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 's13-' || n || '@example.test', 'not-used', now(), '{}', '{}', now(), now()
from generate_series(1, 8) n
on conflict (id) do nothing;

insert into public.profiles (id, email, display_name)
select pg_temp.uid(n), 's13-' || n || '@example.test', 'S13 user ' || n
from generate_series(1, 8) n
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('e1300000-0000-4000-8000-0000000000f1', 'Family F', pg_temp.uid(3)),
  ('e1300000-0000-4000-8000-0000000000a1', 'Family G', pg_temp.uid(7));

insert into public.family_members (id, family_id, user_id, role) values
  ('e1300000-0000-4000-8000-0000000000f3', 'e1300000-0000-4000-8000-0000000000f1', pg_temp.uid(3), 'parent'),
  ('e1300000-0000-4000-8000-0000000000f4', 'e1300000-0000-4000-8000-0000000000f1', pg_temp.uid(4), 'parent'),
  ('e1300000-0000-4000-8000-0000000000f5', 'e1300000-0000-4000-8000-0000000000f1', pg_temp.uid(5), 'kid'),
  ('e1300000-0000-4000-8000-0000000000f6', 'e1300000-0000-4000-8000-0000000000f1', pg_temp.uid(6), 'kid'),
  ('e1300000-0000-4000-8000-0000000000a7', 'e1300000-0000-4000-8000-0000000000a1', pg_temp.uid(7), 'parent'),
  ('e1300000-0000-4000-8000-0000000000a8', 'e1300000-0000-4000-8000-0000000000a1', pg_temp.uid(8), 'kid');

insert into public.member_permissions (member_id, module, level) values
  ('e1300000-0000-4000-8000-0000000000f5', 'expenses', 'edit'),
  ('e1300000-0000-4000-8000-0000000000f5', 'family_finance', 'view'),
  ('e1300000-0000-4000-8000-0000000000f6', 'expenses', 'edit'),
  ('e1300000-0000-4000-8000-0000000000a8', 'expenses', 'edit');

-- Kids 05 and 08 are accounts their parents made (F13); 06 joined with their own.
update public.profiles set managed_by_family = 'e1300000-0000-4000-8000-0000000000f1', username = 's13-kid-five'
where id = pg_temp.uid(5);
update public.profiles set managed_by_family = 'e1300000-0000-4000-8000-0000000000a1'
where id = pg_temp.uid(8);

-- A 64-character hex string unique to the tag.
create function pg_temp.hex(p_tag text)
returns text
language sql
immutable
as $$ select encode(sha256(convert_to(p_tag, 'UTF8')), 'hex') $$;

-- One row for p_user in every table a user owns, tagged with the user's number.
create function pg_temp.seed(p_n integer, p_family uuid)
returns void
language plpgsql
as $$
declare
  u uuid := pg_temp.uid(p_n);
  tag text := 's13-' || p_n;
  expense_id uuid := gen_random_uuid();
  account_id uuid := gen_random_uuid();
  item_id uuid := gen_random_uuid();
  reminder_id uuid := gen_random_uuid();
  batch_id uuid := gen_random_uuid();
  category_id uuid := gen_random_uuid();
begin
  insert into public.categories (id, user_id, name) values (category_id, u, tag || ' legacy');
  insert into public.expenses (id, user_id, description, amount, category, expense_date, category_id) values
    (expense_id, u, tag || ' lunch', 12.50, 'groceries', '2026-10-01', category_id),
    (gen_random_uuid(), u, tag || ' fuel', 40.00, 'transport', '2026-10-02', null);
  insert into expense_classification_private.expense_backups (migration_id, expense_id, original_row, corrected_row)
  values ('s13-test', expense_id, jsonb_build_object('id', expense_id, 'user_id', u, 'description', tag), '{}');
  insert into public.expense_tabs (user_id, name, category_keys) values (u, tag || ' tab', '{groceries}');
  insert into public.investment_accounts (id, user_id, broker_id) values (account_id, u, 'xtb');
  insert into public.investment_transactions (investment_account_id, instrument, currency, side, amount, quantity, unit_price, executed_at)
  values (account_id, 'VWCE', 'EUR', 'buy', 100, 1, 100, '2026-10-01 10:00+00');
  insert into public.net_worth_items (id, user_id, name, kind, category, currency) values (item_id, u, tag || ' flat', 'asset', 'property', 'EUR');
  insert into public.net_worth_valuations (item_id, value, valued_on) values (item_id, 1000, '2026-10-01');
  insert into public.reminders (id, user_id, title, starts_on) values (reminder_id, u, tag || ' rent', '2026-10-01');
  insert into public.reminder_completions (reminder_id, occurrence_on, expense_id) values (reminder_id, '2026-10-01', expense_id);
  insert into public.notification_settings (user_id) values (u);
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (u, 'https://push.example.test/' || tag, 'p256dh-' || tag, 'auth-' || tag, tag || ' phone');
  insert into public.notifications (user_id, kind, payload) values (u, 'test', jsonb_build_object('title', tag));
  insert into public.account_notices (user_id, kind, family_name) values (u, 'removed_from_family', tag || ' family');
  insert into public.mcp_tokens (user_id, name, token_hash, prefix)
  values (u, tag || ' token', pg_temp.hex(tag || ' token'), 'sl_mcp_' || substr(pg_temp.hex(tag), 1, 6));
  insert into public.calendar_feeds (user_id, token_hash) values (u, pg_temp.hex(tag || ' feed'));
  insert into public.import_batches (id, user_id, status, source_kind, parser_id, content_hash, currency, row_count, confirmed_at, confirmed_count)
  values (batch_id, u, 'confirmed', 'csv', 'generic', pg_temp.hex(tag || ' statement'), 'EUR', 1, now(), 1);
  insert into public.import_rows (batch_id, position, expense_date, description, amount, currency, category)
  values (batch_id, 1, '2026-10-01', tag || ' lunch', 12.50, 'EUR', 'groceries');
  insert into public.import_expenses (batch_id, expense_id) values (batch_id, expense_id);
  insert into public.ai_usage (user_id, family_id, feature, provider, model, cost_micros, outcome)
  values (u, p_family, 'statements', 'fake', 'fake-1', 250000, 'ok');
  update public.profiles set avatar_path = u::text || '/' || gen_random_uuid()::text || '.webp' where id = u;
end;
$$;

select pg_temp.seed(1, null);
select pg_temp.seed(2, null);
select pg_temp.seed(5, 'e1300000-0000-4000-8000-0000000000f1');
select pg_temp.seed(8, 'e1300000-0000-4000-8000-0000000000a1');

-- Family F's rows that user 01 made before leaving it, and one by the second parent.
insert into public.todos (id, family_id, title, position, status, created_by) values
  ('e1300000-0000-4000-8000-0000000000c1', 'e1300000-0000-4000-8000-0000000000f1', 'Buy milk', 'a0', 'todo', pg_temp.uid(1)),
  ('e1300000-0000-4000-8000-0000000000c2', 'e1300000-0000-4000-8000-0000000000f1', 'Kid''s chore', 'a1', 'todo', pg_temp.uid(4));
update public.todos set assignee_member_id = 'e1300000-0000-4000-8000-0000000000f5'
where id = 'e1300000-0000-4000-8000-0000000000c2';
insert into public.calendar_events (id, family_id, title, starts_at, ends_at, created_by) values
  ('e1300000-0000-4000-8000-0000000000e1', 'e1300000-0000-4000-8000-0000000000f1', 'Picnic', '2026-11-03 09:00+02', '2026-11-03 10:00+02', pg_temp.uid(1)),
  ('e1300000-0000-4000-8000-0000000000e2', 'e1300000-0000-4000-8000-0000000000f1', 'Swimming', '2026-11-04 09:00+02', '2026-11-04 10:00+02', pg_temp.uid(4));
insert into public.calendar_event_attendees (event_id, member_id) values
  ('e1300000-0000-4000-8000-0000000000e2', 'e1300000-0000-4000-8000-0000000000f5');
insert into public.family_invites (family_id, code_hash, role, expires_at, created_by, used_at, used_by) values
  ('e1300000-0000-4000-8000-0000000000f1', pg_temp.hex('s13 invite'), 'parent', now() + interval '1 day', pg_temp.uid(1), now(), pg_temp.uid(1));
insert into public.app_flags (key, value, updated_by) values ('s13_test_flag', 'true', pg_temp.uid(1));
-- The assignment and the invitation notified the kid; keep the one seeded notification per user.
delete from public.notifications where user_id = pg_temp.uid(5) and kind <> 'test';

-- How many rows each table holds for the user, read as the table owner.
create function pg_temp.owned(p_n integer)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'expenses', (select count(*) from public.expenses where user_id = pg_temp.uid(p_n)),
    'expense_backups', (select count(*) from expense_classification_private.expense_backups where original_row ->> 'user_id' = pg_temp.uid(p_n)::text),
    'categories', (select count(*) from public.categories where user_id = pg_temp.uid(p_n)),
    'expense_tabs', (select count(*) from public.expense_tabs where user_id = pg_temp.uid(p_n)),
    'investment_accounts', (select count(*) from public.investment_accounts where user_id = pg_temp.uid(p_n)),
    'investment_transactions', (select count(*) from public.investment_transactions t join public.investment_accounts a on a.id = t.investment_account_id where a.user_id = pg_temp.uid(p_n)),
    'net_worth_items', (select count(*) from public.net_worth_items where user_id = pg_temp.uid(p_n)),
    'reminders', (select count(*) from public.reminders where user_id = pg_temp.uid(p_n)),
    'notification_settings', (select count(*) from public.notification_settings where user_id = pg_temp.uid(p_n)),
    'push_subscriptions', (select count(*) from public.push_subscriptions where user_id = pg_temp.uid(p_n)),
    'notifications', (select count(*) from public.notifications where user_id = pg_temp.uid(p_n)),
    'account_notices', (select count(*) from public.account_notices where user_id = pg_temp.uid(p_n)),
    'mcp_tokens', (select count(*) from public.mcp_tokens where user_id = pg_temp.uid(p_n)),
    'calendar_feeds', (select count(*) from public.calendar_feeds where user_id = pg_temp.uid(p_n)),
    'import_batches', (select count(*) from public.import_batches where user_id = pg_temp.uid(p_n)),
    'ai_usage', (select count(*) from public.ai_usage where user_id = pg_temp.uid(p_n))
  )
$$;

create function pg_temp.seeded()
returns jsonb
language sql
immutable
as $$
  select '{"expenses": 2, "expense_backups": 1, "categories": 1, "expense_tabs": 1, "investment_accounts": 1,
    "investment_transactions": 1, "net_worth_items": 1, "reminders": 1, "notification_settings": 1,
    "push_subscriptions": 1, "notifications": 1, "account_notices": 1, "mcp_tokens": 1,
    "calendar_feeds": 1, "import_batches": 1, "ai_usage": 1}'::jsonb
$$;

create function pg_temp.nothing()
returns jsonb
language sql
immutable
as $$ select (select jsonb_object_agg(key, 0) from jsonb_object_keys(pg_temp.seeded()) key) $$;

-- The SQLSTATE and hint of the error p_sql raises ('ok' when none), as the caller.
create function pg_temp.attempt(p_sql text)
returns text
language plpgsql
as $$
declare
  v_state text;
  v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return v_state || ' hint:' || coalesce(nullif(v_hint, ''), 'none');
end;
$$;

create function pg_temp.act_as(p_n integer)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(p_n), 'role', 'authenticated')::text, true);
  select null::void;
$$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Grants and the catalogue
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.delete_my_data(text)', 'execute')
    and has_function_privilege('authenticated', 'public.delete_managed_kid_data(uuid, text)', 'execute')
    and has_function_privilege('authenticated', 'public.export_my_data(text)', 'execute'),
  'a signed-in user can call the three public functions'
);
select ok(
  not has_function_privilege('anon', 'public.delete_my_data(text)', 'execute')
    and not has_function_privilege('anon', 'public.delete_managed_kid_data(uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.export_my_data(text)', 'execute'),
  'anon can call none of them'
);
select ok(
  not has_function_privilege('authenticated', 'app_private.delete_owned_rows(uuid)', 'execute')
    and not has_function_privilege('anon', 'app_private.delete_owned_rows(uuid)', 'execute')
    and not has_function_privilege('service_role', 'app_private.delete_owned_rows(uuid)', 'execute'),
  'nobody can call the internal delete_owned_rows directly'
);
select is(
  (select array_agg(p.proname || ':' || p.prosecdef::text order by p.proname)
   from pg_proc p
   where p.oid in ('public.delete_my_data(text)'::regprocedure, 'public.delete_managed_kid_data(uuid, text)'::regprocedure,
     'public.export_my_data(text)'::regprocedure, 'app_private.delete_owned_rows(uuid)'::regprocedure)),
  array['delete_managed_kid_data:true', 'delete_my_data:true', 'delete_owned_rows:false', 'export_my_data:true'],
  'the three public functions are security definer and the helper is security invoker'
);
select is(
  (select count(*)::integer from pg_proc p
   where p.oid in ('public.delete_my_data(text)'::regprocedure, 'public.delete_managed_kid_data(uuid, text)'::regprocedure,
     'public.export_my_data(text)'::regprocedure, 'app_private.delete_owned_rows(uuid)'::regprocedure)
     and 'search_path=""' = any (p.proconfig)),
  4,
  'all four set search_path to the empty string'
);

-- A new table that references auth.users fails here until deletion and the export handle it.
select is(
  (select array_agg(c.conrelid::regclass::text || '.' || a.attname || ':' || c.confdeltype::text
     order by c.conrelid::regclass::text, a.attname)
   from pg_constraint c
   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
     and c.connamespace = 'public'::regnamespace),
  array[
    'account_notices.user_id:c', 'ai_usage.user_id:n', 'app_flags.updated_by:n',
    'calendar_events.created_by:n', 'calendar_feeds.user_id:c', 'categories.user_id:c',
    'expense_tabs.user_id:c', 'expenses.user_id:c', 'families.creator_id:r',
    'family_invites.created_by:n', 'family_invites.used_by:n', 'family_members.user_id:c',
    'import_batches.user_id:c', 'investment_accounts.user_id:c', 'mcp_tokens.user_id:c',
    'net_worth_items.user_id:c', 'notification_settings.user_id:c', 'notifications.user_id:c',
    'profiles.id:c', 'push_subscriptions.user_id:c', 'reminders.user_id:c',
    'todos.completed_by:n', 'todos.created_by:n'
  ],
  'the tables that reference auth.users are the ones account deletion and the export handle'
);

select is(pg_temp.owned(1), pg_temp.seeded(), 'user 01 starts with a row in every table');

-- ---------------------------------------------------------------------------
-- export_my_data
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(1);

select is(
  (select jsonb_object_agg(s, jsonb_array_length(public.export_my_data(s))) from unnest(array[
    'profile', 'family_membership', 'expenses', 'expense_tabs', 'categories', 'investment_accounts',
    'investment_transactions', 'net_worth_items', 'net_worth_valuations', 'reminders',
    'reminder_completions', 'notification_settings', 'push_subscriptions', 'notifications',
    'account_notices', 'mcp_tokens', 'calendar_feeds', 'import_batches', 'import_rows',
    'import_expenses', 'ai_usage', 'todos', 'calendar_events']) s),
  '{"profile": 1, "family_membership": 0, "expenses": 2, "expense_tabs": 1, "categories": 1,
    "investment_accounts": 1, "investment_transactions": 1, "net_worth_items": 1,
    "net_worth_valuations": 1, "reminders": 1, "reminder_completions": 1,
    "notification_settings": 1, "push_subscriptions": 1, "notifications": 1, "account_notices": 1,
    "mcp_tokens": 1, "calendar_feeds": 1, "import_batches": 1, "import_rows": 1,
    "import_expenses": 1, "ai_usage": 1, "todos": 1, "calendar_events": 1}'::jsonb,
  'every section holds the caller''s rows'
);
select is(
  (select array_agg(e ->> 'description' order by e ->> 'description') from jsonb_array_elements(public.export_my_data('expenses')) e),
  array['s13-1 fuel', 's13-1 lunch'],
  'the expenses are the caller''s own, not another user''s'
);
select is(
  (select count(*)::integer from unnest(array['expenses', 'expense_tabs', 'reminders', 'net_worth_items', 'notifications',
     'push_subscriptions', 'mcp_tokens', 'import_rows', 'account_notices']) s,
     jsonb_array_elements(public.export_my_data(s)) row
   where row::text like '%s13-2%'),
  0,
  'no section holds anything of user 02'
);
select is(
  public.export_my_data('profile') -> 0 ->> 'email',
  's13-1@example.test',
  'the profile is the caller''s'
);
select ok(
  not (public.export_my_data('mcp_tokens') -> 0 ? 'token_hash')
    and not (public.export_my_data('calendar_feeds') -> 0 ? 'token_hash')
    and not (public.export_my_data('push_subscriptions') -> 0 ?| array['endpoint', 'p256dh', 'auth'])
    and not (public.export_my_data('import_batches') -> 0 ? 'content_hash'),
  'no section holds a token hash, a push key or endpoint, or a statement hash'
);
select is(
  public.export_my_data('todos') -> 0 ->> 'created_by_me',
  'true',
  'a to-do the caller created in a family is theirs to export'
);
select is(
  pg_temp.attempt($q$select public.export_my_data('profiles; drop table x')$q$),
  '22023 hint:user',
  'an unknown section is refused with a message for users'
);

-- A parent's export holds their own finances, not their kid's, which RLS would let them read.
select pg_temp.act_as(4);
select is(
  (select count(*)::integer from public.expenses),
  2,
  'RLS shows the second parent the managed kid''s expenses'
);
select is(
  jsonb_array_length(public.export_my_data('expenses')),
  0,
  'but the parent''s export holds none of them'
);
select is(
  (select array_agg(t ->> 'id' order by t ->> 'id') from jsonb_array_elements(public.export_my_data('todos')) t),
  array['e1300000-0000-4000-8000-0000000000c2'],
  'the parent''s to-dos are the one they created'
);
select is(
  public.export_my_data('family_membership') -> 0 ->> 'family_name',
  'Family F',
  'the export says which family the caller is in'
);
select is(
  public.export_my_data('family_membership') -> 0 ->> 'is_creator',
  'false',
  'and whether they created it'
);

-- A managed kid's export: assigned to-dos and attended events are theirs too.
select pg_temp.act_as(5);
select is(
  (select array_agg(t ->> 'assigned_to_me') from jsonb_array_elements(public.export_my_data('todos')) t),
  array['true'],
  'a to-do assigned to the kid is in their export'
);
select is(
  (select array_agg(e ->> 'attending') from jsonb_array_elements(public.export_my_data('calendar_events')) e),
  array['true'],
  'an event the kid attends is in their export'
);
select is(
  (public.export_my_data('family_membership') -> 0 -> 'permissions' ->> 'expenses'),
  'edit',
  'a kid''s export holds their permissions'
);

-- ---------------------------------------------------------------------------
-- delete_my_data: the refusals
-- ---------------------------------------------------------------------------

select pg_temp.act_as(1);
select is(pg_temp.attempt($q$select public.delete_my_data('delete')$q$), '23514 hint:user', 'the wrong phrase is refused');
select is(pg_temp.attempt($q$select public.delete_my_data(null)$q$), '23514 hint:user', 'no phrase is refused');

select pg_temp.act_as(3);
select is(pg_temp.attempt($q$select public.delete_my_data('delete my account')$q$), '55000 hint:user', 'a family''s creator is refused');
select pg_temp.act_as(4);
select is(pg_temp.attempt($q$select public.delete_my_data('delete my account')$q$), '55000 hint:user', 'a second parent is refused');
select pg_temp.act_as(6);
select is(pg_temp.attempt($q$select public.delete_my_data('delete my account')$q$), '55000 hint:user', 'a kid with their own account is refused');
select pg_temp.act_as(5);
select is(pg_temp.attempt($q$select public.delete_my_data('delete my account')$q$), '42501 hint:user', 'a managed kid is refused');

select set_config('request.jwt.claims', '', true);
select is(pg_temp.attempt($q$select public.delete_my_data('delete my account')$q$), '42501 hint:user', 'no caller is refused');

reset role;
select is(pg_temp.owned(5), pg_temp.seeded(), 'the refused managed kid keeps everything');
select is(
  (select count(*)::integer from public.family_members where family_id = 'e1300000-0000-4000-8000-0000000000f1'),
  4,
  'the refusals leave family F as it was'
);

-- ---------------------------------------------------------------------------
-- delete_my_data: user 01
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as(1);
select is(pg_temp.attempt($q$select public.delete_my_data('  Delete My Account ')$q$), 'ok', 'a user with no family deletes their data (case and spaces ignored)');

reset role;
select is(pg_temp.owned(1), pg_temp.nothing(), 'every row user 01 owned is gone');
select is(
  (select count(*)::integer from public.net_worth_valuations v where not exists (select 1 from public.net_worth_items i where i.id = v.item_id))
  + (select count(*)::integer from public.import_rows r where not exists (select 1 from public.import_batches b where b.id = r.batch_id))
  + (select count(*)::integer from public.reminder_completions c where not exists (select 1 from public.reminders r where r.id = c.reminder_id)),
  0,
  'their valuations, statement rows and reminder completions went with them'
);
select is(pg_temp.owned(2), pg_temp.seeded(), 'user 02 keeps everything');
select is(pg_temp.owned(5), pg_temp.seeded(), 'the managed kid keeps everything');
select is(pg_temp.owned(8), pg_temp.seeded(), 'the other family''s kid keeps everything');
select is(
  (select count(*)::integer from public.ai_usage where user_id is null and cost_micros = 250000),
  1,
  'their AI usage stays in the ledger without them, so the month''s budgets still count it'
);
select is(
  (select array_agg(id::text || ':' || coalesce(created_by::text, 'none') order by id) from public.todos where family_id = 'e1300000-0000-4000-8000-0000000000f1'),
  array['e1300000-0000-4000-8000-0000000000c1:none', 'e1300000-0000-4000-8000-0000000000c2:' || pg_temp.uid(4)::text],
  'family F keeps the to-do they created, without them as its creator'
);
select is(
  (select array_agg(id::text || ':' || coalesce(created_by::text, 'none') order by id) from public.calendar_events where family_id = 'e1300000-0000-4000-8000-0000000000f1'),
  array['e1300000-0000-4000-8000-0000000000e1:none', 'e1300000-0000-4000-8000-0000000000e2:' || pg_temp.uid(4)::text],
  'and the event they created'
);
select is(
  (select count(*)::integer from public.family_invites where created_by = pg_temp.uid(1) or used_by = pg_temp.uid(1)),
  0,
  'invites no longer name them'
);
select is(
  (select updated_by from public.app_flags where key = 's13_test_flag'),
  null::uuid,
  'nor does the app flag they set'
);
select is(
  (select row(email, avatar_path)::text from public.profiles where id = pg_temp.uid(1)),
  row('s13-1@example.test', null::text)::text,
  'the profile stays for the auth user''s deletion, without its picture'
);

set local role authenticated;
select pg_temp.act_as(1);
select is(pg_temp.attempt($q$select public.delete_my_data('delete my account')$q$), 'ok', 'running it again does nothing and succeeds');
select is(
  (select jsonb_object_agg(s, jsonb_array_length(public.export_my_data(s))) from unnest(array['expenses', 'reminders', 'ai_usage', 'todos']) s),
  '{"expenses": 0, "reminders": 0, "ai_usage": 0, "todos": 0}'::jsonb,
  'their export is empty now'
);

-- ---------------------------------------------------------------------------
-- delete_managed_kid_data
-- ---------------------------------------------------------------------------

select pg_temp.act_as(6);
select is(
  pg_temp.attempt($q$select public.delete_managed_kid_data('e1300000-0000-4000-8000-0000000000f5', 'S13 user 5')$q$),
  '42501 hint:user',
  'a kid can''t delete another kid''s account'
);
select pg_temp.act_as(2);
select is(
  pg_temp.attempt($q$select public.delete_managed_kid_data('e1300000-0000-4000-8000-0000000000f5', 'S13 user 5')$q$),
  '42501 hint:user',
  'a user with no family can''t either'
);
select pg_temp.act_as(4);
select is(
  pg_temp.attempt($q$select public.delete_managed_kid_data('e1300000-0000-4000-8000-0000000000a8', 'S13 user 8')$q$),
  'P0002 hint:user',
  'a parent can''t delete another family''s kid'
);
select is(
  pg_temp.attempt($q$select public.delete_managed_kid_data('e1300000-0000-4000-8000-0000000000ff', 'Nobody')$q$),
  'P0002 hint:user',
  'an unknown member is not found'
);
select is(
  pg_temp.attempt($q$select public.delete_managed_kid_data('e1300000-0000-4000-8000-0000000000f6', 'S13 user 6')$q$),
  '42501 hint:user',
  'a kid who joined with their own account can''t be deleted by a parent'
);
select is(
  pg_temp.attempt($q$select public.delete_managed_kid_data('e1300000-0000-4000-8000-0000000000f3', 'S13 user 3')$q$),
  '42501 hint:user',
  'nor can the creator'
);
select is(
  pg_temp.attempt($q$select public.delete_managed_kid_data('e1300000-0000-4000-8000-0000000000f5', 'S13 user 6')$q$),
  '23514 hint:user',
  'the wrong name is refused'
);

reset role;
select is(pg_temp.owned(5), pg_temp.seeded(), 'the refusals leave the kid''s data alone');

set local role authenticated;
select pg_temp.act_as(4);
select is(
  public.delete_managed_kid_data('e1300000-0000-4000-8000-0000000000f5', ' s13 USER 5 '),
  pg_temp.uid(5),
  'the second parent deletes the kid''s data and gets the kid''s user id'
);

reset role;
select is(pg_temp.owned(5), pg_temp.nothing(), 'every row the kid owned is gone');
select is(
  (select row(m.role, p.managed_by_family)::text
   from public.family_members m join public.profiles p on p.id = m.user_id
   where m.id = 'e1300000-0000-4000-8000-0000000000f5'),
  row('kid', 'e1300000-0000-4000-8000-0000000000f1'::uuid)::text,
  'the membership and the profile stay until the auth user goes, so the parent can retry'
);
select is(
  (select count(*)::integer from public.ai_usage where user_id is null and family_id = 'e1300000-0000-4000-8000-0000000000f1'),
  1,
  'the kid''s AI usage still counts toward the family''s budget'
);
select is(pg_temp.owned(8), pg_temp.seeded(), 'the other family''s kid keeps everything');
select is(pg_temp.owned(2), pg_temp.seeded(), 'user 02 still keeps everything');

-- ---------------------------------------------------------------------------
-- The auth user's deletion (what the admin API does next)
-- ---------------------------------------------------------------------------

select is(pg_temp.attempt($q$delete from auth.users where id = pg_temp.uid(5)$q$), 'ok', 'the kid''s auth user can be deleted');
select is(
  (select count(*)::integer from public.family_members where user_id = pg_temp.uid(5))
    + (select count(*)::integer from public.profiles where id = pg_temp.uid(5))
    + (select count(*)::integer from public.calendar_event_attendees where member_id = 'e1300000-0000-4000-8000-0000000000f5'),
  0,
  'which takes the membership, the profile and the event attendance with it'
);
select is(
  (select assignee_member_id from public.todos where id = 'e1300000-0000-4000-8000-0000000000c2'),
  null::uuid,
  'the kid''s to-do stays with the family, unassigned'
);
select is(
  (select count(*)::integer from public.family_members where family_id = 'e1300000-0000-4000-8000-0000000000f1'),
  3,
  'family F keeps its other members'
);
select is(pg_temp.attempt($q$delete from auth.users where id = pg_temp.uid(1)$q$), 'ok', 'user 01''s auth user can be deleted');
select is(
  pg_temp.attempt($q$delete from auth.users where id = pg_temp.uid(3)$q$),
  '23503 hint:none',
  'a family''s creator can''t be deleted before the family (why the creator is refused first)'
);

select * from finish();
rollback;
