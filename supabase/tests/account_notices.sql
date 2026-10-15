begin;
create extension if not exists pgtap;
select plan(39);

-- Users: 01 and 02 have notices, 03 has none.
insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f1100000-0000-4000-8000-000000000001', 'notices-one@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1100000-0000-4000-8000-000000000002', 'notices-two@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f1100000-0000-4000-8000-000000000003', 'notices-none@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

-- Structure
select has_table('public', 'account_notices', 'account_notices exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.account_notices'::regclass),
  'RLS is enabled on account_notices'
);
select has_index('public', 'account_notices', 'account_notices_user_id_created_at_idx',
  array['user_id', 'created_at'], 'account_notices is indexed by user and age');
select is(
  (select array_agg(cmd::text order by cmd) from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'account_notices'),
  array['SELECT'],
  'account_notices has only a select policy'
);
select ok(
  has_table_privilege('authenticated', 'public.account_notices', 'select')
  and not has_table_privilege('authenticated', 'public.account_notices', 'insert')
  and not has_table_privilege('authenticated', 'public.account_notices', 'update')
  and not has_table_privilege('authenticated', 'public.account_notices', 'delete'),
  'authenticated may only select account_notices'
);
select ok(
  not has_table_privilege('anon', 'public.account_notices', 'select'),
  'anon cannot select account_notices'
);
select function_returns('public', 'dismiss_notice', array['uuid'], 'void', 'dismiss_notice returns void');
select ok(
  (select bool_and(prosecdef) from pg_catalog.pg_proc
   where oid in ('public.get_my_notices()'::regprocedure, 'public.dismiss_notice(uuid)'::regprocedure)),
  'both RPCs are security definer'
);
select ok(
  (select bool_and(proconfig = array['search_path=""']) from pg_catalog.pg_proc
   where oid in ('public.get_my_notices()'::regprocedure, 'public.dismiss_notice(uuid)'::regprocedure)),
  'both RPCs pin an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.get_my_notices()', 'execute')
  and has_function_privilege('authenticated', 'public.dismiss_notice(uuid)', 'execute'),
  'authenticated can execute both RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.get_my_notices()', 'execute')
  and not has_function_privilege('anon', 'public.dismiss_notice(uuid)', 'execute'),
  'anon cannot execute either RPC'
);

-- Setup as the table owner
select lives_ok($$
  insert into public.account_notices (id, user_id, kind, family_name, created_at, seen_at) values
    ('f1100000-0000-4000-8000-0000000000a2', 'f1100000-0000-4000-8000-000000000001', 'removed_from_family', 'Second', now() - interval '1 hour', null),
    ('f1100000-0000-4000-8000-0000000000a1', 'f1100000-0000-4000-8000-000000000001', 'family_deleted', 'First', now() - interval '2 hours', null),
    ('f1100000-0000-4000-8000-0000000000a3', 'f1100000-0000-4000-8000-000000000001', 'family_deleted', 'Seen', now() - interval '3 hours', '2026-01-01 00:00:00+00'),
    ('f1100000-0000-4000-8000-0000000000b1', 'f1100000-0000-4000-8000-000000000002', 'removed_from_family', 'Other', now() - interval '4 hours', null)
$$, 'notices can be written by the owner');
select throws_ok($$
  insert into public.account_notices (user_id, kind, family_name)
  values ('f1100000-0000-4000-8000-000000000003', 'promoted', 'Family')
$$, '23514', null, 'an unknown kind is rejected');
select throws_ok($$
  insert into public.account_notices (user_id, kind)
  values ('f1100000-0000-4000-8000-000000000003', 'family_deleted')
$$, '23502', null, 'a family name is required');
with inserted as (
  insert into public.account_notices (user_id, kind, family_name)
  values ('f1100000-0000-4000-8000-000000000003', 'family_deleted', 'Defaults')
  returning *
)
select is(
  (select created_at is not null and seen_at is null and id is not null from inserted),
  true,
  'id and created_at default, and a notice starts unseen'
);
delete from public.account_notices where user_id = 'f1100000-0000-4000-8000-000000000003';

-- Reading, as user 01
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.account_notices),
  3,
  'a user can select all of their own notices'
);
select is(
  (select count(*)::integer from public.account_notices where user_id = 'f1100000-0000-4000-8000-000000000002'),
  0,
  'a user cannot select another user''s notices'
);
select results_eq(
  $$ select id, kind, family_name from public.get_my_notices() $$,
  $$ values
    ('f1100000-0000-4000-8000-0000000000a1'::uuid, 'family_deleted'::text, 'First'::text),
    ('f1100000-0000-4000-8000-0000000000a2'::uuid, 'removed_from_family'::text, 'Second'::text)
  $$,
  'get_my_notices returns the caller''s unseen notices, oldest first'
);

-- No direct writes
select throws_ok($$
  insert into public.account_notices (user_id, kind, family_name)
  values ('f1100000-0000-4000-8000-000000000001', 'family_deleted', 'Fake')
$$, '42501', null, 'authenticated cannot insert notices');
select throws_ok($$
  update public.account_notices set seen_at = now() where id = 'f1100000-0000-4000-8000-0000000000a1'
$$, '42501', null, 'authenticated cannot update notices directly');
select throws_ok($$
  delete from public.account_notices where id = 'f1100000-0000-4000-8000-0000000000a1'
$$, '42501', null, 'authenticated cannot delete notices');

-- Dismissing, as user 01
select throws_ok($$
  select public.dismiss_notice('f1100000-0000-4000-8000-0000000000b1')
$$, 'P0002', 'Notice not found.', 'dismissing another user''s notice is not found');
select throws_ok($$
  select public.dismiss_notice('f1100000-0000-4000-8000-0000000000ff')
$$, 'P0002', 'Notice not found.', 'dismissing an unknown notice is not found');
select throws_ok($$
  select public.dismiss_notice(null)
$$, 'P0002', 'Notice not found.', 'dismissing a null id is not found');
select lives_ok($$
  select public.dismiss_notice('f1100000-0000-4000-8000-0000000000a1')
$$, 'a user can dismiss their own notice');
select isnt(
  (select seen_at from public.account_notices where id = 'f1100000-0000-4000-8000-0000000000a1'),
  null,
  'dismissing sets seen_at'
);
select results_eq(
  $$ select id from public.get_my_notices() $$,
  $$ values ('f1100000-0000-4000-8000-0000000000a2'::uuid) $$,
  'a dismissed notice is no longer returned'
);
select lives_ok($$
  select public.dismiss_notice('f1100000-0000-4000-8000-0000000000a3')
$$, 'dismissing an already seen notice succeeds');
select is(
  (select seen_at from public.account_notices where id = 'f1100000-0000-4000-8000-0000000000a3'),
  '2026-01-01 00:00:00+00'::timestamptz,
  'dismissing again keeps the first seen_at'
);

-- As user 02
select set_config('request.jwt.claims', '{"sub":"f1100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select results_eq(
  $$ select id from public.account_notices $$,
  $$ values ('f1100000-0000-4000-8000-0000000000b1'::uuid) $$,
  'the other user selects only their own notice'
);
select results_eq(
  $$ select id from public.get_my_notices() $$,
  $$ values ('f1100000-0000-4000-8000-0000000000b1'::uuid) $$,
  'the other user''s notice is still unseen'
);
select throws_ok($$
  select public.dismiss_notice('f1100000-0000-4000-8000-0000000000a2')
$$, 'P0002', 'Notice not found.', 'the other user cannot dismiss user 01''s notice');

-- As user 03, who has no notices
select set_config('request.jwt.claims', '{"sub":"f1100000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.get_my_notices()), 0, 'a user without notices gets none');

-- Without claims
select set_config('request.jwt.claims', '', true);
select is((select count(*)::integer from public.get_my_notices()), 0, 'a caller without claims gets no notices');
select throws_ok($$
  select public.dismiss_notice('f1100000-0000-4000-8000-0000000000a2')
$$, 'P0002', 'Notice not found.', 'a caller without claims cannot dismiss');

-- anon
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from public.account_notices $$, '42501', null, 'anon cannot read notices');
select throws_ok($$ select * from public.get_my_notices() $$, '42501', null, 'anon cannot call get_my_notices');

-- Back as the table owner
reset role;
select is(
  (select seen_at from public.account_notices where id = 'f1100000-0000-4000-8000-0000000000a2'),
  null,
  'user 01''s other notice was not dismissed by anyone else'
);
delete from auth.users where id = 'f1100000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.account_notices where user_id = 'f1100000-0000-4000-8000-000000000001'),
  0,
  'deleting a user deletes their notices'
);

select * from finish();
rollback;
