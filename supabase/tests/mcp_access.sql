begin;
create extension if not exists pgtap;
select plan(65);

-- M2: the MCP switch (profiles.mcp_enabled), the access rule, its guard,
-- personal tokens and authenticate_mcp_token.
--
-- Users (prefix e2000000):
--   01 has no family
--   family A: 02 creator (parent), 03 kid with mcp off and a real email,
--     04 kid with mcp on and the generated email, 05 kid with mcp on and a
--     real email
--   06 has no family, creates tokens, then joins family A as a kid
--   07 has no family and owns a token; deleted at the end
-- Member ids: a2..a5 in family a1, in user order; a6 for 06 later.

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('e2000000-0000-4000-8000-000000000001', 'm2-solo@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('e2000000-0000-4000-8000-000000000002', 'm2-a-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('e2000000-0000-4000-8000-000000000003', 'm2-a-kid-off@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('e2000000-0000-4000-8000-000000000004', 'm2-a-kid-gen@kids.ifam.invalid', 'not-used', now(), '{}', '{}', now(), now()),
  ('e2000000-0000-4000-8000-000000000005', 'm2-a-kid-real@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('e2000000-0000-4000-8000-000000000006', 'm2-joiner@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('e2000000-0000-4000-8000-000000000007', 'm2-other@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id)
select u.id from auth.users u where u.id::text like 'e2000000-%'
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('e2000000-0000-4000-8000-0000000000a1', 'Family A', 'e2000000-0000-4000-8000-000000000002');

insert into public.family_members (id, family_id, user_id, role) values
  ('e2000000-0000-4000-8000-0000000000a2', 'e2000000-0000-4000-8000-0000000000a1', 'e2000000-0000-4000-8000-000000000002', 'parent'),
  ('e2000000-0000-4000-8000-0000000000a3', 'e2000000-0000-4000-8000-0000000000a1', 'e2000000-0000-4000-8000-000000000003', 'kid'),
  ('e2000000-0000-4000-8000-0000000000a4', 'e2000000-0000-4000-8000-0000000000a1', 'e2000000-0000-4000-8000-000000000004', 'kid'),
  ('e2000000-0000-4000-8000-0000000000a5', 'e2000000-0000-4000-8000-0000000000a1', 'e2000000-0000-4000-8000-000000000005', 'kid');

-- 03 has no mcp row at all (off); 04 and 05 have it on.
insert into public.member_permissions (member_id, module, level) values
  ('e2000000-0000-4000-8000-0000000000a3', 'expenses', 'edit'),
  ('e2000000-0000-4000-8000-0000000000a4', 'mcp', 'edit'),
  ('e2000000-0000-4000-8000-0000000000a5', 'mcp', 'edit');

-- sha256 of a label as lowercase hex, the format the app sends.
create function pg_temp.h(p_label text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(p_label, 'UTF8')), 'hex')
$$;

create function pg_temp.status(p_user text)
returns text
language sql
as $$
  select mcp_private.access_status(('e2000000-0000-4000-8000-0000000000' || p_user)::uuid)
$$;

-- Turns a user's switch on or off as a trusted writer, past the guard.
create function pg_temp.set_switch(p_user text, p_enabled boolean)
returns void
language sql
as $$
  update public.profiles
  set mcp_enabled = p_enabled
  where id = ('e2000000-0000-4000-8000-0000000000' || p_user)::uuid
$$;

-- Signs in as a user for the rest of the transaction (or until the next call).
create function pg_temp.sign_in(p_user text)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    '{"sub":"e2000000-0000-4000-8000-0000000000' || p_user || '","role":"authenticated"}', true)
$$;

-- ---------------------------------------------------------------------------
-- The switch and access_status
-- ---------------------------------------------------------------------------

select col_default_is('public', 'profiles', 'mcp_enabled', 'false', 'the switch is off by default');
select col_not_null('public', 'profiles', 'mcp_enabled', 'the switch is never null');

select is(pg_temp.status('02'), 'mcp_off', 'an adult with the switch off: mcp_off');
select pg_temp.set_switch('02', true);
select is(pg_temp.status('02'), 'ok', 'an adult with the switch on: ok');

select pg_temp.set_switch('03', true);
select pg_temp.set_switch('04', true);
select pg_temp.set_switch('05', true);
select is(pg_temp.status('03'), 'not_permitted', 'a kid with the permission off: not_permitted');
select is(pg_temp.status('04'), 'email_required', 'a kid with the permission on and the generated email: email_required');
select is(pg_temp.status('05'), 'ok', 'a kid with the permission on and a real email: ok');

select pg_temp.set_switch('05', false);
select is(pg_temp.status('05'), 'mcp_off', 'a kid who passes both rules but has the switch off: mcp_off');

select is(pg_temp.status('01'), 'mcp_off', 'a user with no family and the switch off: mcp_off');
select pg_temp.set_switch('01', true);
select is(pg_temp.status('01'), 'ok', 'a user with no family and the switch on: ok');

select is(mcp_private.access_status('e2000000-0000-4000-8000-0000000000ff'), 'mcp_off',
  'a user without a profile row counts as switched off');

select is(mcp_private.kid_email_domain(), 'kids.ifam.invalid',
  'kid_email_domain matches KID_EMAIL_DOMAIN in src/lib/family/kid-account.ts');

select ok(
  not has_function_privilege('authenticated', 'mcp_private.access_status(uuid)', 'execute')
  and not has_function_privilege('service_role', 'mcp_private.access_status(uuid)', 'execute'),
  'access_status is ungranted'
);

-- Everyone starts the guard tests switched off.
select pg_temp.set_switch(u, false) from unnest(array['01', '02', '03', '04', '05']) as u;

-- ---------------------------------------------------------------------------
-- As signed-in users: the switch guard and my_mcp_access
-- ---------------------------------------------------------------------------

set local role authenticated;

select pg_temp.sign_in('02');
select lives_ok(
  $$ update public.profiles set mcp_enabled = true where id = 'e2000000-0000-4000-8000-000000000002' $$,
  'an adult in a family can turn the switch on'
);
select is(public.my_mcp_access(), '{"status":"ok","personalTokens":true}'::jsonb,
  'my_mcp_access for that adult: ok, with personal tokens');

select pg_temp.sign_in('01');
select lives_ok(
  $$ update public.profiles set mcp_enabled = true where id = 'e2000000-0000-4000-8000-000000000001' $$,
  'a user with no family can turn the switch on'
);

select pg_temp.sign_in('03');
select throws_ok(
  $$ update public.profiles set mcp_enabled = true where id = 'e2000000-0000-4000-8000-000000000003' $$,
  '42501', 'A parent needs to turn on AI assistants for you.',
  'a kid with the permission off cannot turn the switch on'
);
select is(public.my_mcp_access(), '{"status":"mcp_off","personalTokens":false}'::jsonb,
  'my_mcp_access for that kid: mcp_off, without personal tokens');

select pg_temp.sign_in('04');
select throws_ok(
  $$ update public.profiles set mcp_enabled = true where id = 'e2000000-0000-4000-8000-000000000004' $$,
  '42501', 'Add and confirm an email address in Settings to use AI assistants.',
  'a kid with the generated email cannot turn the switch on'
);

select pg_temp.sign_in('05');
select lives_ok(
  $$ update public.profiles set mcp_enabled = true where id = 'e2000000-0000-4000-8000-000000000005' $$,
  'a kid with the permission and a real email can turn the switch on'
);
select is(public.my_mcp_access(), '{"status":"ok","personalTokens":false}'::jsonb,
  'my_mcp_access for that kid: ok, still without personal tokens');

-- A kid can't get around the guard by inserting a fresh profile row.
select pg_temp.sign_in('03');
delete from public.profiles where id = 'e2000000-0000-4000-8000-000000000003';
select throws_ok(
  $$ insert into public.profiles (id, mcp_enabled) values ('e2000000-0000-4000-8000-000000000003', true) $$,
  '42501', 'A parent needs to turn on AI assistants for you.',
  'a kid with the permission off cannot insert a profile with the switch on'
);
insert into public.profiles (id) values ('e2000000-0000-4000-8000-000000000003');

reset role;
select pg_temp.set_switch('03', true);
select pg_temp.set_switch('04', true);
set local role authenticated;

select pg_temp.sign_in('03');
select lives_ok(
  $$ update public.profiles set mcp_enabled = false where id = 'e2000000-0000-4000-8000-000000000003' $$,
  'a kid with the permission off can still turn the switch off'
);
select pg_temp.sign_in('04');
select lives_ok(
  $$ update public.profiles set mcp_enabled = false where id = 'e2000000-0000-4000-8000-000000000004' $$,
  'a kid with the generated email can still turn the switch off'
);
select pg_temp.sign_in('02');
select lives_ok(
  $$ update public.profiles set mcp_enabled = false where id = 'e2000000-0000-4000-8000-000000000002' $$,
  'an adult can turn the switch off'
);

reset role;

select is(
  (select array_agg(p.mcp_enabled order by p.id) from public.profiles p
   where p.id in ('e2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002',
     'e2000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000004',
     'e2000000-0000-4000-8000-000000000005')),
  array[true, false, false, false, true],
  'the switches ended up as set'
);

-- ---------------------------------------------------------------------------
-- Personal tokens: create_mcp_token
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.sign_in('01');

select is(
  (select t.expires_at from public.create_mcp_token('one month', pg_temp.h('t1'), 'sl_mcp_tok001', '1m') t),
  now() + interval '1 month',
  'create_mcp_token takes 1m'
);
select is(
  (select t.expires_at from public.create_mcp_token('three months', pg_temp.h('t2'), 'sl_mcp_tok002', '3m') t),
  now() + interval '3 months',
  'create_mcp_token takes 3m'
);
select is(
  (select t.expires_at from public.create_mcp_token('six months', pg_temp.h('t3'), 'sl_mcp_tok003', '6m') t),
  now() + interval '6 months',
  'create_mcp_token takes 6m'
);
select is(
  (select t.expires_at from public.create_mcp_token('forever', pg_temp.h('t4'), 'sl_mcp_tok004', 'never') t),
  null,
  'create_mcp_token takes never, which never expires'
);
select throws_ok(
  $$ select * from public.create_mcp_token('bad', pg_temp.h('bad1'), 'sl_mcp_bad001', '2m') $$,
  '22023', 'Choose an expiry: 1 month, 3 months, 6 months or never.',
  'create_mcp_token refuses any other expiry'
);
select throws_ok(
  $$ select * from public.create_mcp_token('bad', pg_temp.h('bad2'), 'sl_mcp_bad002', null) $$,
  '22023', null,
  'create_mcp_token refuses a null expiry'
);
select throws_ok(
  $$ select * from public.create_mcp_token('bad', 'not-a-hash', 'sl_mcp_bad003', '3m') $$,
  '23514', null,
  'create_mcp_token refuses a malformed hash'
);
select is(
  (select to_jsonb(t) ? 'token_hash' from public.create_mcp_token('five', pg_temp.h('t5'), 'sl_mcp_tok005', '3m') t),
  false,
  'create_mcp_token returns the new row without the hash'
);

-- 5 live tokens so far; 5 more reach the cap.
select public.create_mcp_token('cap ' || n, pg_temp.h('t' || n), 'sl_mcp_tok' || lpad(n::text, 3, '0'), '3m')
from generate_series(6, 10) as n;
select throws_ok(
  $$ select * from public.create_mcp_token('eleven', pg_temp.h('t11'), 'sl_mcp_tok011', '3m') $$,
  'P0001', 'You can have at most 10 personal tokens. Revoke one to create another.',
  'create_mcp_token refuses an 11th live token'
);
select ok(
  public.revoke_mcp_token((select t.id from public.mcp_tokens t where t.prefix = 'sl_mcp_tok010')),
  'revoke_mcp_token revokes one of the caller''s tokens'
);
select lives_ok(
  $$ select * from public.create_mcp_token('eleven', pg_temp.h('t11'), 'sl_mcp_tok011', '3m') $$,
  'a revoked token no longer counts toward the cap'
);

select pg_temp.sign_in('05');
select throws_ok(
  $$ select * from public.create_mcp_token('kid', pg_temp.h('kid'), 'sl_mcp_kid001', '3m') $$,
  '42501', 'Kids connect AI assistants through the app''s sign-in page, not with tokens.',
  'create_mcp_token refuses kids, even one with access'
);

select pg_temp.sign_in('07');
select public.create_mcp_token('other', pg_temp.h('other'), 'sl_mcp_oth001', 'never');

select pg_temp.sign_in('06');
select public.create_mcp_token('joiner', pg_temp.h('joiner'), 'sl_mcp_joi001', '3m');

-- ---------------------------------------------------------------------------
-- Reading and writing mcp_tokens directly
-- ---------------------------------------------------------------------------

select pg_temp.sign_in('01');
select is(
  (select count(*)::int from public.mcp_tokens),
  11,
  'a user lists only their own tokens'
);
select ok(
  (select bool_and(t.user_id = 'e2000000-0000-4000-8000-000000000001') from public.mcp_tokens t),
  'every listed token is the caller''s'
);
select throws_ok(
  $$ select t.token_hash from public.mcp_tokens t $$,
  '42501', null,
  'a user cannot select token_hash, even on their own rows'
);
select throws_ok(
  $$ insert into public.mcp_tokens (user_id, name, token_hash, prefix)
     values ('e2000000-0000-4000-8000-000000000001', 'direct', pg_temp.h('direct'), 'sl_mcp_dir001') $$,
  '42501', null,
  'a user cannot insert tokens directly'
);
select throws_ok(
  $$ update public.mcp_tokens set revoked_at = null $$,
  '42501', null,
  'a user cannot update tokens directly'
);
select throws_ok(
  $$ delete from public.mcp_tokens $$,
  '42501', null,
  'a user cannot delete tokens directly'
);

-- ---------------------------------------------------------------------------
-- regenerate_mcp_token and revoke_mcp_token
-- ---------------------------------------------------------------------------

-- 07 goes after 01's token. RLS hides it from 07, so its id comes from a table
-- filled as the superuser.
reset role;
create temporary table owner_token as
  select t.id from public.mcp_tokens t where t.prefix = 'sl_mcp_tok001';
grant select on owner_token to authenticated;

set local role authenticated;
select pg_temp.sign_in('07');
select throws_ok(
  $$ select * from public.regenerate_mcp_token(
       (select o.id from owner_token o), pg_temp.h('stolen'), 'sl_mcp_stl001', 'never') $$,
  'P0002', 'Token not found.',
  'regenerate_mcp_token refuses another user''s token'
);
select ok(
  not public.revoke_mcp_token((select o.id from owner_token o)),
  'revoke_mcp_token on another user''s token returns false'
);
reset role;
select is(
  (select row(t.token_hash, t.prefix, t.revoked_at, t.regenerated_at, t.expires_at)::text
   from public.mcp_tokens t where t.prefix = 'sl_mcp_tok001'),
  row(pg_temp.h('t1'), 'sl_mcp_tok001', null::timestamptz, null::timestamptz, now() + interval '1 month')::text,
  'another user''s regenerate and revoke changed nothing'
);

-- 01 regenerates their own token, after it has been used and has expired.
update public.mcp_tokens
set last_used_at = now() - interval '1 day', expires_at = now() - interval '1 hour'
where prefix = 'sl_mcp_tok002';

set local role authenticated;
select pg_temp.sign_in('01');
select is(
  (select row(t.prefix, t.regenerated_at, t.last_used_at, t.expires_at)::text
   from public.regenerate_mcp_token(
     (select t.id from public.mcp_tokens t where t.prefix = 'sl_mcp_tok002'),
     pg_temp.h('t2-new'), 'sl_mcp_tok2nw', '6m') t),
  row('sl_mcp_tok2nw', now(), null::timestamptz, now() + interval '6 months')::text,
  'regenerating an expired token swaps the prefix, sets regenerated_at, clears last_used_at and resets the expiry'
);
select throws_ok(
  $$ select * from public.regenerate_mcp_token(
       (select t.id from public.mcp_tokens t where t.prefix = 'sl_mcp_tok010'),
       pg_temp.h('t10-new'), 'sl_mcp_tok0nw', '3m') $$,
  'P0002', 'Token not found.',
  'a revoked token cannot be regenerated'
);
select ok(
  not public.revoke_mcp_token((select t.id from public.mcp_tokens t where t.prefix = 'sl_mcp_tok010')),
  'revoking an already revoked token returns false'
);
reset role;

-- ---------------------------------------------------------------------------
-- authenticate_mcp_token
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.authenticate_mcp_token(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.authenticate_mcp_token(text)', 'execute')
  and not has_function_privilege('anon', 'public.authenticate_mcp_token(text)', 'execute'),
  'authenticate_mcp_token is granted to service_role only'
);

set local role authenticated;
select pg_temp.sign_in('01');
select throws_ok(
  $$ select * from public.authenticate_mcp_token(pg_temp.h('t1')) $$,
  '42501', null,
  'authenticated cannot execute authenticate_mcp_token'
);
reset role;
set local role anon;
select throws_ok(
  $$ select * from public.authenticate_mcp_token(pg_temp.h('t1')) $$,
  '42501', null,
  'anon cannot execute authenticate_mcp_token'
);
reset role;

-- 04 expires as the superuser.
update public.mcp_tokens set expires_at = now() - interval '1 second' where prefix = 'sl_mcp_tok003';

set local role service_role;

select is(
  (select row(a.status, a.token_id, a.user_id, a.email)::text
   from public.authenticate_mcp_token(pg_temp.h('nobody')) a),
  row('unknown', null::uuid, null::uuid, null::text)::text,
  'an unknown hash: unknown'
);
select is(
  (select a.status from public.authenticate_mcp_token(pg_temp.h('t2')) a),
  'unknown',
  'a regenerated token''s old hash: unknown'
);
select is(
  (select row(a.status, a.email)::text from public.authenticate_mcp_token(pg_temp.h('t10')) a),
  row('revoked', null::text)::text,
  'a revoked token: revoked, without an email'
);
select is(
  (select a.status from public.authenticate_mcp_token(pg_temp.h('t3')) a),
  'expired',
  'an expired token: expired'
);
select is(
  (select row(a.status, a.user_id, a.email)::text from public.authenticate_mcp_token(pg_temp.h('other')) a),
  row('mcp_off', 'e2000000-0000-4000-8000-000000000007'::uuid, null::text)::text,
  'a token whose owner has the switch off: mcp_off'
);
select is(
  (select row(a.status, a.user_id, a.email)::text from public.authenticate_mcp_token(pg_temp.h('t1')) a),
  row('ok', 'e2000000-0000-4000-8000-000000000001'::uuid, 'm2-solo@example.test')::text,
  'a live token whose owner has access: ok, with the owner''s email'
);

reset role;
select is(
  (select t.last_used_at from public.mcp_tokens t where t.prefix = 'sl_mcp_tok001'),
  now(),
  'the first ok call sets last_used_at'
);

-- A minute later: no write. More than 5 minutes later: a write.
update public.mcp_tokens set last_used_at = now() - interval '1 minute' where prefix = 'sl_mcp_tok001';
set local role service_role;
select public.authenticate_mcp_token(pg_temp.h('t1'));
reset role;
select is(
  (select t.last_used_at from public.mcp_tokens t where t.prefix = 'sl_mcp_tok001'),
  now() - interval '1 minute',
  'a second call a minute later leaves last_used_at alone'
);
update public.mcp_tokens set last_used_at = now() - interval '6 minutes' where prefix = 'sl_mcp_tok001';
set local role service_role;
select public.authenticate_mcp_token(pg_temp.h('t1'));
reset role;
select is(
  (select t.last_used_at from public.mcp_tokens t where t.prefix = 'sl_mcp_tok001'),
  now(),
  'a call more than 5 minutes later moves last_used_at'
);

-- 06 has a token and access, then joins family A as a kid (with mcp on, a
-- real email and the switch on, so only the token rule refuses).
select pg_temp.set_switch('06', true);
set local role service_role;
select is(
  (select a.status from public.authenticate_mcp_token(pg_temp.h('joiner')) a),
  'ok',
  'the joiner''s token works while they are an adult'
);
reset role;
insert into public.family_members (id, family_id, user_id, role) values
  ('e2000000-0000-4000-8000-0000000000a6', 'e2000000-0000-4000-8000-0000000000a1', 'e2000000-0000-4000-8000-000000000006', 'kid');
insert into public.member_permissions (member_id, module, level) values
  ('e2000000-0000-4000-8000-0000000000a6', 'mcp', 'edit');
set local role service_role;
select is(
  (select row(a.status, a.email)::text from public.authenticate_mcp_token(pg_temp.h('joiner')) a),
  row('kid_token', null::text)::text,
  'after an adult with tokens joins a family as a kid: kid_token'
);
reset role;

-- ---------------------------------------------------------------------------
-- Deleting the user
-- ---------------------------------------------------------------------------

delete from auth.users where id = 'e2000000-0000-4000-8000-000000000007';
select is(
  (select count(*)::int from public.mcp_tokens t where t.user_id = 'e2000000-0000-4000-8000-000000000007'),
  0,
  'deleting the user deletes their tokens'
);

select * from finish();
rollback;
