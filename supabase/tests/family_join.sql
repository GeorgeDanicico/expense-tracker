begin;
create extension if not exists pgtap;
select plan(67);

-- F09: preview_family_invite(), redeem_family_invite(), and F08's
-- list_family_invites() hiding invites whose creator is no longer a parent.
--
-- Users (prefix f0900000):
--   family A: 01 creator (display name Ana), 02 second parent (username only),
--             03 kid, 06 parent (display name Dana) who is removed later
--   family B: 04 creator (no profile, so the email's local part)
--   05, 07, 08 and 09 have no family. 05 joins as a kid, 07 as a parent.
-- Member ids: a2 (01), a3 (02), a4 (03), a6 (06), b2 (04).
-- Seeded invites: see below. s1 is created by 06 through the RPC.

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f0900000-0000-4000-8000-000000000001', 'f09-a-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0900000-0000-4000-8000-000000000002', 'f09-a-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0900000-0000-4000-8000-000000000003', 'f09-a-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0900000-0000-4000-8000-000000000004', 'f09-b-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0900000-0000-4000-8000-000000000005', 'f09-joiner-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0900000-0000-4000-8000-000000000006', 'f09-a-leaving@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0900000-0000-4000-8000-000000000007', 'f09-joiner-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0900000-0000-4000-8000-000000000008', 'f09-latecomer@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0900000-0000-4000-8000-000000000009', 'f09-outsider@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

-- Setup as the table owner (usernames can only be set by trusted roles).
insert into public.profiles (id, email, username, display_name)
values
  ('f0900000-0000-4000-8000-000000000001', 'f09-a-creator@example.test', null, 'Ana'),
  ('f0900000-0000-4000-8000-000000000002', 'f09-a-parent@example.test', 'bogdan.f09', null),
  ('f0900000-0000-4000-8000-000000000006', 'f09-a-leaving@example.test', null, 'Dana');

insert into public.families (id, name, creator_id) values
  ('f0900000-0000-4000-8000-0000000000a1', 'Family A', 'f0900000-0000-4000-8000-000000000001'),
  ('f0900000-0000-4000-8000-0000000000b1', 'Family B', 'f0900000-0000-4000-8000-000000000004');

insert into public.family_members (id, family_id, user_id, role) values
  ('f0900000-0000-4000-8000-0000000000a2', 'f0900000-0000-4000-8000-0000000000a1', 'f0900000-0000-4000-8000-000000000001', 'parent'),
  ('f0900000-0000-4000-8000-0000000000a3', 'f0900000-0000-4000-8000-0000000000a1', 'f0900000-0000-4000-8000-000000000002', 'parent'),
  ('f0900000-0000-4000-8000-0000000000a4', 'f0900000-0000-4000-8000-0000000000a1', 'f0900000-0000-4000-8000-000000000003', 'kid'),
  ('f0900000-0000-4000-8000-0000000000a6', 'f0900000-0000-4000-8000-0000000000a1', 'f0900000-0000-4000-8000-000000000006', 'parent'),
  ('f0900000-0000-4000-8000-0000000000b2', 'f0900000-0000-4000-8000-0000000000b1', 'f0900000-0000-4000-8000-000000000004', 'parent');

-- sha256 of a label as lowercase hex, the format F22 sends.
create function pg_temp.h(p_label text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(p_label, 'UTF8')), 'hex')
$$;

-- Seeded invites, relative to now() (the transaction's start time, the same
-- clock the functions use). All in family A unless noted.
--   e1 kid, expired a day ago, by 01
--   x0 parent, expires exactly now(), by 01
--   r1 parent, revoked an hour ago, by 01
--   u1 parent, used an hour ago by 03, by 01
--   o1 parent, created_by null (the creator's account was deleted)
--   w1 parent, created by 04, a parent of family B
--   y1 parent, created by 03, a kid of family A
--   v1 kid, permissions no longer valid (a module missing), by 01
--   k1 kid, pending, by 01
--   k3 kid, pending, by 02
--   p1 parent, pending, by 02
--   b1 family B parent, pending, by 04
insert into public.family_invites
  (id, family_id, code_hash, role, permissions, created_by, created_at, expires_at, used_at, used_by, revoked_at)
values
  ('f0900000-0000-4000-8000-0000000000e1', 'f0900000-0000-4000-8000-0000000000a1', pg_temp.h('e1'), 'kid',
   '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}',
   'f0900000-0000-4000-8000-000000000001', now() - interval '8 days', now() - interval '1 day', null, null, null),
  ('f0900000-0000-4000-8000-0000000000e2', 'f0900000-0000-4000-8000-0000000000a1', pg_temp.h('x0'), 'parent', null,
   'f0900000-0000-4000-8000-000000000001', now() - interval '48 hours', now(), null, null, null),
  ('f0900000-0000-4000-8000-0000000000e3', 'f0900000-0000-4000-8000-0000000000a1', pg_temp.h('r1'), 'parent', null,
   'f0900000-0000-4000-8000-000000000001', now() - interval '2 hours', now() + interval '46 hours',
   null, null, now() - interval '1 hour'),
  ('f0900000-0000-4000-8000-0000000000e4', 'f0900000-0000-4000-8000-0000000000a1', pg_temp.h('u1'), 'parent', null,
   'f0900000-0000-4000-8000-000000000001', now() - interval '2 hours', now() + interval '46 hours',
   now() - interval '1 hour', 'f0900000-0000-4000-8000-000000000003', null),
  ('f0900000-0000-4000-8000-0000000000e5', 'f0900000-0000-4000-8000-0000000000a1', pg_temp.h('o1'), 'parent', null,
   null, now() - interval '1 hour', now() + interval '47 hours', null, null, null),
  ('f0900000-0000-4000-8000-0000000000e6', 'f0900000-0000-4000-8000-0000000000a1', pg_temp.h('w1'), 'parent', null,
   'f0900000-0000-4000-8000-000000000004', now() - interval '1 hour', now() + interval '47 hours', null, null, null),
  ('f0900000-0000-4000-8000-0000000000e7', 'f0900000-0000-4000-8000-0000000000a1', pg_temp.h('y1'), 'parent', null,
   'f0900000-0000-4000-8000-000000000003', now() - interval '1 hour', now() + interval '47 hours', null, null, null),
  ('f0900000-0000-4000-8000-0000000000e8', 'f0900000-0000-4000-8000-0000000000a1', pg_temp.h('v1'), 'kid',
   '{"expenses":"edit","investments":"off","net_worth":"off"}',
   'f0900000-0000-4000-8000-000000000001', now() - interval '1 hour', now() + interval '167 hours', null, null, null),
  ('f0900000-0000-4000-8000-0000000000c1', 'f0900000-0000-4000-8000-0000000000a1', pg_temp.h('k1'), 'kid',
   '{"expenses":"edit","investments":"off","net_worth":"edit","family_finance":"view","mcp":"off","ai":"off"}',
   'f0900000-0000-4000-8000-000000000001', now() - interval '1 hour', now() + interval '167 hours', null, null, null),
  ('f0900000-0000-4000-8000-0000000000c3', 'f0900000-0000-4000-8000-0000000000a1', pg_temp.h('k3'), 'kid',
   '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}',
   'f0900000-0000-4000-8000-000000000002', now() - interval '2 hours', now() + interval '166 hours', null, null, null),
  ('f0900000-0000-4000-8000-0000000000c2', 'f0900000-0000-4000-8000-0000000000a1', pg_temp.h('p1'), 'parent', null,
   'f0900000-0000-4000-8000-000000000002', now() - interval '1 hour', now() + interval '47 hours', null, null, null),
  ('f0900000-0000-4000-8000-0000000000d1', 'f0900000-0000-4000-8000-0000000000b1', pg_temp.h('b1'), 'parent', null,
   'f0900000-0000-4000-8000-000000000004', now() - interval '1 hour', now() + interval '47 hours', null, null, null);

-- Labels for every invite in this file, so assertions can name them. Tests
-- insert what create_family_invite and redeem_family_invite return, so
-- authenticated may write.
create temp table invite_labels (
  label text primary key,
  invite_id uuid not null unique
);
create temp table redeemed (
  label text primary key,
  member_id uuid not null
);
grant select, insert on invite_labels, redeemed to authenticated;
insert into invite_labels (label, invite_id)
select l.label, i.id
from public.family_invites i
join (values
  ('e1', pg_temp.h('e1')), ('x0', pg_temp.h('x0')), ('r1', pg_temp.h('r1')),
  ('u1', pg_temp.h('u1')), ('o1', pg_temp.h('o1')), ('w1', pg_temp.h('w1')),
  ('y1', pg_temp.h('y1')), ('v1', pg_temp.h('v1')), ('k1', pg_temp.h('k1')),
  ('k3', pg_temp.h('k3')), ('p1', pg_temp.h('p1')), ('b1', pg_temp.h('b1'))
) as l(label, code_hash) on l.code_hash = i.code_hash;

-- Every invite in this file as 'label:used_by', where used_by is the last two
-- characters of the user id or '-', read as the table owner.
create function pg_temp.used_states()
returns text[]
language sql
security definer
as $$
  select array_agg(
    l.label || ':' || coalesce(right(i.used_by::text, 2), '-')
    order by l.label
  )
  from invite_labels l
  join public.family_invites i on i.id = l.invite_id
$$;

-- The number of memberships of this file's users, read as the table owner.
create function pg_temp.member_count()
returns integer
language sql
security definer
as $$
  select count(*)::integer
  from public.family_members m
  where m.user_id::text like 'f0900000-%'
$$;

-- The number of rows preview_family_invite returns for a label's code.
create function pg_temp.previewed(p_label text)
returns integer
language sql
as $$
  select count(*)::integer from public.preview_family_invite(pg_temp.h(p_label))
$$;

-- The pending invites the caller sees, as 'label:role:name' (label '?' for an
-- invite this file doesn't know), sorted.
create function pg_temp.listed()
returns text[]
language sql
as $$
  select coalesce(array_agg(
    coalesce(l.label, '?') || ':' || r.role || ':' || coalesce(r.created_by_name, '-')
    order by coalesce(l.label, '?')
  ), '{}')
  from public.list_family_invites() r
  left join invite_labels l on l.invite_id = r.invite_id
$$;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from pg_catalog.pg_proc p
   where p.oid in (
       'public.preview_family_invite(text)'::regprocedure,
       'public.redeem_family_invite(text)'::regprocedure,
       'public.list_family_invites()'::regprocedure
     )
     and p.prosecdef
     and p.proconfig = array['search_path=""']),
  3,
  'preview, redeem and the recreated list are security definer and pin an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.preview_family_invite(text)', 'execute')
  and has_function_privilege('authenticated', 'public.redeem_family_invite(text)', 'execute')
  and has_function_privilege('authenticated', 'public.list_family_invites()', 'execute'),
  'authenticated can execute preview, redeem and list'
);
select ok(
  not has_function_privilege('anon', 'public.preview_family_invite(text)', 'execute')
  and not has_function_privilege('anon', 'public.redeem_family_invite(text)', 'execute')
  and not has_function_privilege('anon', 'public.list_family_invites()', 'execute'),
  'anon can execute none of preview, redeem and list'
);
select ok(
  not has_function_privilege('authenticated', 'family_private.is_invite_redeemable(public.family_invites)', 'execute')
  and not has_function_privilege('anon', 'family_private.is_invite_redeemable(public.family_invites)', 'execute')
  and not has_function_privilege('service_role', 'family_private.is_invite_redeemable(public.family_invites)', 'execute'),
  'nobody can call is_invite_redeemable directly'
);

-- ---------------------------------------------------------------------------
-- No caller, and malformed code hashes
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

select throws_ok(
  $$ select * from public.preview_family_invite(pg_temp.h('k1')) $$,
  '42501', 'Sign in to use an invite code.',
  'a caller without a user id cannot preview'
);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('k1')) $$,
  '42501', 'Sign in to use an invite code.',
  'a caller without a user id cannot redeem'
);

select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000008","role":"authenticated"}', true);

select throws_ok(
  $$ select * from public.preview_family_invite(upper(pg_temp.h('k1'))) $$,
  '23514', 'The invite code is not valid.',
  'preview refuses an uppercase code hash'
);
select throws_ok(
  $$ select * from public.preview_family_invite('ABCD2345') $$,
  '23514', 'The invite code is not valid.',
  'preview refuses a plain code instead of its hash'
);
select throws_ok(
  $$ select * from public.preview_family_invite(null) $$,
  '23514', 'The invite code is not valid.',
  'preview refuses a null code hash'
);
select throws_ok(
  $$ select public.redeem_family_invite(upper(pg_temp.h('k1'))) $$,
  '23514', 'The invite code is not valid.',
  'redeem refuses an uppercase code hash'
);
select throws_ok(
  $$ select public.redeem_family_invite(left(pg_temp.h('k1'), 63)) $$,
  '23514', 'The invite code is not valid.',
  'redeem refuses a code hash shorter than 64 characters'
);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('k1') || '0') $$,
  '23514', 'The invite code is not valid.',
  'redeem refuses a code hash longer than 64 characters'
);
select throws_ok(
  $$ select public.redeem_family_invite(null) $$,
  '23514', 'The invite code is not valid.',
  'redeem refuses a null code hash'
);

-- ---------------------------------------------------------------------------
-- Preview
-- ---------------------------------------------------------------------------

select is(
  (select to_jsonb(r) from public.preview_family_invite(pg_temp.h('k1')) r),
  jsonb_build_object(
    'family_name', 'Family A',
    'inviter_name', 'Ana',
    'role', 'kid',
    'permissions', '{"expenses":"edit","investments":"off","net_worth":"edit","family_finance":"view","mcp":"off","ai":"off"}'::jsonb,
    'expires_at', now() + interval '167 hours'
  ),
  'a kid invite previews the family, the inviter''s display name, the role, the permissions and the expiry'
);
select is(
  (select to_jsonb(r) from public.preview_family_invite(pg_temp.h('p1')) r),
  jsonb_build_object(
    'family_name', 'Family A',
    'inviter_name', 'bogdan.f09',
    'role', 'parent',
    'permissions', null,
    'expires_at', now() + interval '47 hours'
  ),
  'a parent invite previews with null permissions and the inviter''s username'
);
select is(
  (select r.family_name || ':' || r.inviter_name from public.preview_family_invite(pg_temp.h('b1')) r),
  'Family B:f09-b-creator',
  'an inviter without a profile is named by their email'
);

select is(pg_temp.previewed('unknown'), 0, 'an unknown code previews nothing');
select is(pg_temp.previewed('e1'), 0, 'an expired code previews nothing');
select is(pg_temp.previewed('x0'), 0, 'a code that expires right now previews nothing');
select is(pg_temp.previewed('r1'), 0, 'a revoked code previews nothing');
select is(pg_temp.previewed('u1'), 0, 'a used code previews nothing');
select is(pg_temp.previewed('o1'), 0, 'a code whose creator''s account was deleted previews nothing');
select is(pg_temp.previewed('w1'), 0, 'a code whose creator is not in the family previews nothing');
select is(pg_temp.previewed('y1'), 0, 'a code whose creator is a kid previews nothing');
select is(pg_temp.previewed('v1'), 0, 'a kid code with permissions that are no longer valid previews nothing');

select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(pg_temp.previewed('b1'), 1, 'a member of a family can still preview another family''s code');

-- ---------------------------------------------------------------------------
-- Redeem: refusals
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('b1')) $$,
  '23505', 'You''re already in a family.',
  'a kid in a family cannot redeem another family''s code'
);

select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('p1')) $$,
  '23505', 'You''re already in a family.',
  'a parent cannot redeem their own family''s code'
);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('unknown')) $$,
  '23505', 'You''re already in a family.',
  'a member gets 23505 for an unknown code too, so they learn nothing about it'
);

select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000008","role":"authenticated"}', true);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('unknown')) $$,
  'P0002', 'This code isn''t valid anymore.',
  'an unknown code cannot be redeemed'
);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('e1')) $$,
  'P0002', 'This code isn''t valid anymore.',
  'an expired code cannot be redeemed'
);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('x0')) $$,
  'P0002', 'This code isn''t valid anymore.',
  'a code that expires right now cannot be redeemed'
);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('r1')) $$,
  'P0002', 'This code isn''t valid anymore.',
  'a revoked code cannot be redeemed'
);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('u1')) $$,
  'P0002', 'This code isn''t valid anymore.',
  'a used code cannot be redeemed'
);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('o1')) $$,
  'P0002', 'This code isn''t valid anymore.',
  'a code whose creator''s account was deleted cannot be redeemed'
);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('w1')) $$,
  'P0002', 'This code isn''t valid anymore.',
  'a code whose creator is not in the family cannot be redeemed'
);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('y1')) $$,
  'P0002', 'This code isn''t valid anymore.',
  'a code whose creator is a kid cannot be redeemed'
);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('v1')) $$,
  'P0002', 'This code isn''t valid anymore.',
  'a kid code with permissions that are no longer valid cannot be redeemed'
);

reset role;
select is(pg_temp.member_count(), 5, 'the refused calls created no memberships');
select is(
  pg_temp.used_states(),
  array['b1:-', 'e1:-', 'k1:-', 'k3:-', 'o1:-', 'p1:-', 'r1:-', 'u1:03', 'v1:-', 'w1:-', 'x0:-', 'y1:-'],
  'the refused calls marked no invite used'
);

-- ---------------------------------------------------------------------------
-- Redeem: a kid invite and a parent invite
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000005","role":"authenticated"}', true);
insert into redeemed (label, member_id)
select 'k1', public.redeem_family_invite(pg_temp.h('k1'));

select is(
  (select m.family_id::text || ':' || m.role from public.get_my_membership() m),
  'f0900000-0000-4000-8000-0000000000a1:kid',
  'redeeming a kid code makes the caller a kid in the invite''s family'
);
select is(
  (select m.member_id from public.get_my_membership() m),
  (select r.member_id from redeemed r where r.label = 'k1'),
  'redeem returns the new member id'
);
select is(
  (select m.permissions from public.get_my_membership() m),
  '{"expenses":"edit","investments":"off","net_worth":"edit","family_finance":"view","mcp":"off","ai":"off"}'::jsonb,
  'the new kid has the invite''s permissions'
);

select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000007","role":"authenticated"}', true);
insert into redeemed (label, member_id)
select 'p1', public.redeem_family_invite(pg_temp.h('p1'));

select is(
  (select m.family_id::text || ':' || m.role || ':' || coalesce(m.permissions::text, 'null')
   from public.get_my_membership() m),
  'f0900000-0000-4000-8000-0000000000a1:parent:null',
  'redeeming a parent code makes the caller a parent in the invite''s family'
);

reset role;
select is(
  (select array_agg(p.module || ':' || p.level order by p.module)
   from public.member_permissions p
   join redeemed r on r.member_id = p.member_id
   where r.label = 'k1'),
  array['ai:off', 'expenses:edit', 'family_finance:view', 'investments:off', 'mcp:off', 'net_worth:edit'],
  'a kid code writes one permission row per module'
);
select is(
  (select count(*)::integer
   from public.member_permissions p
   join redeemed r on r.member_id = p.member_id
   where r.label = 'p1'),
  0,
  'a parent code writes no permission rows'
);
select is(
  (select array_agg(r.label || ':' || right(m.user_id::text, 2) || ':' || (m.joined_at = now())::text order by r.label)
   from redeemed r join public.family_members m on m.id = r.member_id),
  array['k1:05:true', 'p1:07:true'],
  'each returned member id is the caller''s new membership, joined now'
);
select is(
  pg_temp.used_states(),
  array['b1:-', 'e1:-', 'k1:05', 'k3:-', 'o1:-', 'p1:07', 'r1:-', 'u1:03', 'v1:-', 'w1:-', 'x0:-', 'y1:-'],
  'the redeemed codes are marked used by their callers, and nothing else is'
);
select ok(
  (select bool_and(i.used_at = now() and i.revoked_at is null)
   from public.family_invites i
   where i.code_hash in (pg_temp.h('k1'), pg_temp.h('p1'))),
  'the redeemed codes are marked used now'
);

-- ---------------------------------------------------------------------------
-- A code works once; a member can't join a second family
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000008","role":"authenticated"}', true);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('k1')) $$,
  'P0002', 'This code isn''t valid anymore.',
  'a second user redeeming the same code gets the generic error'
);
select is(pg_temp.previewed('k1'), 0, 'a redeemed code previews nothing');
select is(
  (select count(*)::integer from public.get_my_membership()),
  0,
  'the second user did not join'
);

select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('b1')) $$,
  '23505', 'You''re already in a family.',
  'a user who just joined cannot redeem a second code'
);

reset role;
select is(pg_temp.member_count(), 7, 'only the two successful redeems created memberships');
select is(
  pg_temp.used_states(),
  array['b1:-', 'e1:-', 'k1:05', 'k3:-', 'o1:-', 'p1:07', 'r1:-', 'u1:03', 'v1:-', 'w1:-', 'x0:-', 'y1:-'],
  'the later refusals changed no invite'
);

-- ---------------------------------------------------------------------------
-- An invite stops working when its creator is removed from the family
-- ---------------------------------------------------------------------------

-- Dana (06), a parent, creates s1.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000006","role":"authenticated"}', true);
insert into invite_labels (label, invite_id)
select 's1', r.invite_id
from public.create_family_invite('parent', null, pg_temp.h('s1')) r;

select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000009","role":"authenticated"}', true);
select is(
  (select r.inviter_name || ':' || r.role from public.preview_family_invite(pg_temp.h('s1')) r),
  'Dana:parent',
  'while Dana is a parent, her invite previews'
);

select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  pg_temp.listed(),
  array['k3:kid:bogdan.f09', 's1:parent:Dana'],
  'the list shows only redeemable invites: not expired, revoked, used, orphaned or invalid ones'
);

-- The creator removes Dana.
select lives_ok(
  $$ select public.remove_family_member('f0900000-0000-4000-8000-0000000000a6') $$,
  'the creator removes the parent who created s1'
);

select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000009","role":"authenticated"}', true);
select is(pg_temp.previewed('s1'), 0, 'an invite whose creator was removed previews nothing');
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('s1')) $$,
  'P0002', 'This code isn''t valid anymore.',
  'an invite whose creator was removed cannot be redeemed'
);
select is(
  (select count(*)::integer from public.get_my_membership()),
  0,
  'the refused redeem did not add the caller'
);

select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  pg_temp.listed(),
  array['k3:kid:bogdan.f09'],
  'an invite whose creator was removed is no longer listed'
);

reset role;
select ok(
  (select i.used_at is null and i.used_by is null and i.revoked_at is null
     and i.created_by = 'f0900000-0000-4000-8000-000000000006'
   from public.family_invites i where i.code_hash = pg_temp.h('s1')),
  'the orphaned invite row itself is left as it was'
);

-- The last pending invite still works.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0900000-0000-4000-8000-000000000009","role":"authenticated"}', true);
select isnt(
  public.redeem_family_invite(pg_temp.h('k3')),
  null,
  'the remaining pending invite can still be redeemed'
);
select is(
  (select m.role || ':' || (m.permissions ->> 'expenses') from public.get_my_membership() m),
  'kid:edit',
  'and its redeemer joins as a kid'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select * from public.preview_family_invite(pg_temp.h('b1')) $$,
  '42501', null, 'anon cannot call preview_family_invite'
);
select throws_ok(
  $$ select public.redeem_family_invite(pg_temp.h('b1')) $$,
  '42501', null, 'anon cannot call redeem_family_invite'
);

reset role;
select * from finish();
rollback;
