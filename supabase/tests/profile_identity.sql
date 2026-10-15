begin;
create extension if not exists pgtap;
select plan(34);

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f0400000-0000-4000-8000-000000000001', 'identity-a@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0400000-0000-4000-8000-000000000002', 'identity-b@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0400000-0000-4000-8000-000000000003', 'identity-c@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email)
values
  ('f0400000-0000-4000-8000-000000000001', 'identity-a@example.test'),
  ('f0400000-0000-4000-8000-000000000002', 'identity-b@example.test');

-- The server (a trusted role) sets usernames; the format and uniqueness rules
-- still apply to it.
select lives_ok($$
  update public.profiles set username = 'kid.one', display_name = 'Kid One'
  where id = 'f0400000-0000-4000-8000-000000000001'
$$, 'the server can set a username and a display name');
select is((select username from public.profiles where id = 'f0400000-0000-4000-8000-000000000001'),
  'kid.one', 'the username is saved');
select lives_ok($$
  update public.profiles set username = 'abc' where id = 'f0400000-0000-4000-8000-000000000002'
$$, 'a three-character username is accepted');
select lives_ok($$
  update public.profiles set username = '0123456789_-.abcdefghijklmnop' || 'q'
  where id = 'f0400000-0000-4000-8000-000000000002'
$$, 'a thirty-character username with digits, dots, dashes and underscores is accepted');
select lives_ok($$
  update public.profiles set username = null where id = 'f0400000-0000-4000-8000-000000000002'
$$, 'the server can clear a username');

select throws_ok($$
  update public.profiles set username = 'Kid.one' where id = 'f0400000-0000-4000-8000-000000000002'
$$, '23514', null, 'uppercase usernames are rejected');
select throws_ok($$
  update public.profiles set username = 'ab' where id = 'f0400000-0000-4000-8000-000000000002'
$$, '23514', null, 'usernames shorter than three characters are rejected');
select throws_ok($$
  update public.profiles set username = repeat('a', 31) where id = 'f0400000-0000-4000-8000-000000000002'
$$, '23514', null, 'usernames longer than thirty characters are rejected');
select throws_ok($$
  update public.profiles set username = '.kid' where id = 'f0400000-0000-4000-8000-000000000002'
$$, '23514', null, 'usernames must start with a letter or digit');
select throws_ok($$
  update public.profiles set username = 'kid one' where id = 'f0400000-0000-4000-8000-000000000002'
$$, '23514', null, 'usernames with spaces are rejected');
select throws_ok($$
  update public.profiles set username = 'kid@one' where id = 'f0400000-0000-4000-8000-000000000002'
$$, '23514', null, 'usernames with other symbols are rejected');
select throws_ok($$
  update public.profiles set username = '' where id = 'f0400000-0000-4000-8000-000000000002'
$$, '23514', null, 'an empty username is rejected');
select throws_ok($$
  update public.profiles set username = 'kid.one' where id = 'f0400000-0000-4000-8000-000000000002'
$$, '23505', null, 'usernames are unique');
select is((select count(*)::integer from public.profiles
  where id in ('f0400000-0000-4000-8000-000000000001', 'f0400000-0000-4000-8000-000000000002')
    and username is null), 1, 'profiles without a username are allowed');

select throws_ok($$
  update public.profiles set display_name = '' where id = 'f0400000-0000-4000-8000-000000000002'
$$, '23514', null, 'an empty display name is rejected');
select throws_ok($$
  update public.profiles set display_name = '   ' where id = 'f0400000-0000-4000-8000-000000000002'
$$, '23514', null, 'a blank display name is rejected');
select throws_ok($$
  update public.profiles set display_name = ' Ann' where id = 'f0400000-0000-4000-8000-000000000002'
$$, '23514', null, 'an untrimmed display name is rejected');
select throws_ok($$
  update public.profiles set display_name = repeat('a', 41) where id = 'f0400000-0000-4000-8000-000000000002'
$$, '23514', null, 'display names longer than forty characters are rejected');
select lives_ok($$
  update public.profiles set display_name = repeat('a', 40) where id = 'f0400000-0000-4000-8000-000000000002'
$$, 'a forty-character display name is accepted');
select lives_ok($$
  update public.profiles set display_name = 'A' where id = 'f0400000-0000-4000-8000-000000000002'
$$, 'a one-character display name is accepted');

-- A signed-in user keeps their existing access but cannot touch the username.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0400000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select username from public.profiles), 'kid.one', 'the owner can read their own username');
select lives_ok($$
  update public.profiles set display_name = 'Kiddo' where id = 'f0400000-0000-4000-8000-000000000001'
$$, 'the owner can change their display name');
select is((select display_name from public.profiles), 'Kiddo', 'the new display name is saved');
select throws_ok($$
  update public.profiles set display_name = ' Kiddo' where id = 'f0400000-0000-4000-8000-000000000001'
$$, '23514', null, 'the owner is held to the display name format');
select throws_ok($$
  update public.profiles set username = 'kid.two' where id = 'f0400000-0000-4000-8000-000000000001'
$$, '42501', null, 'the owner cannot change their username');
select throws_ok($$
  update public.profiles set username = null where id = 'f0400000-0000-4000-8000-000000000001'
$$, '42501', null, 'the owner cannot clear their username');
select lives_ok($$
  update public.profiles set username = 'kid.one', display_name = 'Kid One'
  where id = 'f0400000-0000-4000-8000-000000000001'
$$, 'writing back the unchanged username is allowed');
select lives_ok($$
  insert into public.profiles (id, email, currency)
  values ('f0400000-0000-4000-8000-000000000001', 'identity-a@example.test', 'RON')
  on conflict (id) do update set email = excluded.email, currency = excluded.currency
$$, 'the account currency upsert still works');
select is((select username from public.profiles), 'kid.one', 'the username survives the upsert');

select set_config('request.jwt.claims', '{"sub":"f0400000-0000-4000-8000-000000000002","role":"authenticated"}', true);
with changed as (
  update public.profiles set display_name = 'Taken over'
  where id = 'f0400000-0000-4000-8000-000000000001' returning id
) select is((select count(*)::integer from changed), 0, 'another user cannot change someone else''s display name');
select throws_ok($$
  update public.profiles set username = 'my.name' where id = 'f0400000-0000-4000-8000-000000000002'
$$, '42501', null, 'a user without a username cannot give themselves one');

select set_config('request.jwt.claims', '{"sub":"f0400000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$
  insert into public.profiles (id, email, username)
  values ('f0400000-0000-4000-8000-000000000003', 'identity-c@example.test', 'chosen.name')
$$, '42501', null, 'a user cannot create their profile with a username');
select lives_ok($$
  insert into public.profiles (id, email, display_name)
  values ('f0400000-0000-4000-8000-000000000003', 'identity-c@example.test', 'Cee')
$$, 'a user can create their profile with a display name');

-- The service role, used by the server, may still set a username.
reset role;
set local role service_role;
select lives_ok($$
  update public.profiles set username = 'cee' where id = 'f0400000-0000-4000-8000-000000000003'
$$, 'the service role can set a username');

reset role;
select * from finish();
rollback;
