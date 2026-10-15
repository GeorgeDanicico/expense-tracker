begin;
create extension if not exists pgtap;
select plan(9);

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a3000000-0000-4000-8000-000000000001', 'caller-a@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('a3000000-0000-4000-8000-000000000002', 'caller-b@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

select has_schema('app_private', 'app_private schema exists');
select function_returns('app_private', 'current_user_id', array[]::name[], 'uuid', 'current_user_id returns uuid');
select volatility_is('app_private', 'current_user_id', array[]::name[], 'stable', 'current_user_id is stable');
select is(
  (select proconfig from pg_catalog.pg_proc where oid = 'app_private.current_user_id()'::regprocedure),
  array['search_path=""'],
  'current_user_id pins an empty search_path'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(app_private.current_user_id(), 'a3000000-0000-4000-8000-000000000001'::uuid, 'returns the JWT sub');

select set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(app_private.current_user_id(), 'a3000000-0000-4000-8000-000000000002'::uuid, 'follows a change of caller');

select set_config('request.jwt.claims', '', true);
select is(app_private.current_user_id(), null::uuid, 'returns null when there are no claims');

reset role;
select ok(
  not has_function_privilege('anon', 'app_private.current_user_id()', 'execute'),
  'anon cannot execute current_user_id'
);
select ok(
  not has_schema_privilege('anon', 'app_private', 'usage'),
  'anon has no usage on app_private'
);

select * from finish();
rollback;
