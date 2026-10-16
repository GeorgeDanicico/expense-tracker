begin;
create extension if not exists pgtap;
select plan(77);

-- F08: family_invites, create_family_invite(), list_family_invites() and
-- revoke_family_invite().
--
-- Users (prefix f0800000):
--   family A: 01 creator (display name Ana), 02 second parent (username only),
--             03 kid, 06 parent (display name Dana) whose account is deleted
--   family B: 04 creator (no profile, so the email's local part)
--   05 has no family.
-- Member ids: a2 (01), a3 (02), a4 (03), a5 (06), b2 (04).
-- Seeded invites: c1..c4 in family A, d1 in family B (see below).

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f0800000-0000-4000-8000-000000000001', 'f08-a-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0800000-0000-4000-8000-000000000002', 'f08-a-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0800000-0000-4000-8000-000000000003', 'f08-a-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0800000-0000-4000-8000-000000000004', 'f08-b-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0800000-0000-4000-8000-000000000005', 'f08-no-family@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0800000-0000-4000-8000-000000000006', 'f08-a-leaving@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

-- Setup as the table owner (usernames can only be set by trusted roles).
insert into public.profiles (id, email, username, display_name)
values
  ('f0800000-0000-4000-8000-000000000001', 'f08-a-creator@example.test', null, 'Ana'),
  ('f0800000-0000-4000-8000-000000000002', 'f08-a-parent@example.test', 'bogdan.f08', null),
  ('f0800000-0000-4000-8000-000000000006', 'f08-a-leaving@example.test', null, 'Dana');

insert into public.families (id, name, creator_id) values
  ('f0800000-0000-4000-8000-0000000000a1', 'Family A', 'f0800000-0000-4000-8000-000000000001'),
  ('f0800000-0000-4000-8000-0000000000b1', 'Family B', 'f0800000-0000-4000-8000-000000000004');

insert into public.family_members (id, family_id, user_id, role) values
  ('f0800000-0000-4000-8000-0000000000a2', 'f0800000-0000-4000-8000-0000000000a1', 'f0800000-0000-4000-8000-000000000001', 'parent'),
  ('f0800000-0000-4000-8000-0000000000a3', 'f0800000-0000-4000-8000-0000000000a1', 'f0800000-0000-4000-8000-000000000002', 'parent'),
  ('f0800000-0000-4000-8000-0000000000a4', 'f0800000-0000-4000-8000-0000000000a1', 'f0800000-0000-4000-8000-000000000003', 'kid'),
  ('f0800000-0000-4000-8000-0000000000a5', 'f0800000-0000-4000-8000-0000000000a1', 'f0800000-0000-4000-8000-000000000006', 'parent'),
  ('f0800000-0000-4000-8000-0000000000b2', 'f0800000-0000-4000-8000-0000000000b1', 'f0800000-0000-4000-8000-000000000004', 'parent');

-- sha256 of a label as lowercase hex, the format F21 sends.
create function pg_temp.h(p_label text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(p_label, 'UTF8')), 'hex')
$$;

-- Seeded invites, relative to now() (the transaction's start time, the same
-- clock the functions use):
--   c1 A kid, expired a day ago
--   c2 A parent, used an hour ago by 05
--   c3 A parent, revoked 2 hours ago
--   c4 A parent, pending, creator unknown (created_by null), 1 hour old
--   d1 B kid, pending, created by 04, 1 hour old
insert into public.family_invites
  (id, family_id, code_hash, role, permissions, created_by, created_at, expires_at, used_at, used_by, revoked_at)
values
  ('f0800000-0000-4000-8000-0000000000c1', 'f0800000-0000-4000-8000-0000000000a1', pg_temp.h('c1'), 'kid',
   '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off"}',
   'f0800000-0000-4000-8000-000000000001', now() - interval '8 days', now() - interval '1 day', null, null, null),
  ('f0800000-0000-4000-8000-0000000000c2', 'f0800000-0000-4000-8000-0000000000a1', pg_temp.h('c2'), 'parent', null,
   'f0800000-0000-4000-8000-000000000001', now() - interval '2 hours', now() + interval '46 hours',
   now() - interval '1 hour', 'f0800000-0000-4000-8000-000000000005', null),
  ('f0800000-0000-4000-8000-0000000000c3', 'f0800000-0000-4000-8000-0000000000a1', pg_temp.h('c3'), 'parent', null,
   'f0800000-0000-4000-8000-000000000001', now() - interval '3 hours', now() + interval '45 hours',
   null, null, now() - interval '2 hours'),
  ('f0800000-0000-4000-8000-0000000000c4', 'f0800000-0000-4000-8000-0000000000a1', pg_temp.h('c4'), 'parent', null,
   null, now() - interval '1 hour', now() + interval '47 hours', null, null, null),
  ('f0800000-0000-4000-8000-0000000000d1', 'f0800000-0000-4000-8000-0000000000b1', pg_temp.h('d1'), 'kid',
   '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"off"}',
   'f0800000-0000-4000-8000-000000000004', now() - interval '1 hour', now() + interval '167 hours', null, null, null);

-- Labels for every invite, seeded and created, so assertions can name them.
-- Tests insert what create_family_invite returns, so authenticated may write.
create temp table invite_labels (
  label text primary key,
  invite_id uuid not null unique,
  expires_at timestamptz
);
grant select, insert on invite_labels to authenticated;
insert into invite_labels (label, invite_id)
select right(i.id::text, 2), i.id
from public.family_invites i
where i.id::text like 'f0800000-%';

-- Every invite in this file as 'label:revoked', read as the table owner, where
-- revoked is 'no', 'now' (this transaction) or 'before'.
create function pg_temp.revoked_states()
returns text[]
language sql
security definer
as $$
  select array_agg(
    l.label || ':' || case
      when i.revoked_at is null then 'no'
      when i.revoked_at = now() then 'now'
      else 'before'
    end
    order by l.label
  )
  from invite_labels l
  join public.family_invites i on i.id = l.invite_id
$$;

-- The number of invite rows, read as the table owner.
create function pg_temp.invite_count()
returns integer
language sql
security definer
as $$
  select count(*)::integer from public.family_invites
$$;

-- The pending invites the caller sees, as 'label:role:name' (name '-' when
-- null, label '?' for an invite this file doesn't know), in list order.
create function pg_temp.listed()
returns text[]
language sql
as $$
  select coalesce(array_agg(
    coalesce(l.label, '?') || ':' || r.role || ':' || coalesce(r.created_by_name, '-')
    order by r.ordinality
  ), '{}')
  from public.list_family_invites() with ordinality as r
  left join invite_labels l on l.invite_id = r.invite_id
$$;
grant execute on function pg_temp.listed() to authenticated;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select has_table('public', 'family_invites', 'family_invites exists');
select col_is_unique('public', 'family_invites', array['code_hash'], 'code_hash is unique');
select has_index('public', 'family_invites', 'family_invites_family_id_idx', array['family_id'], 'family_invites is indexed by family_id');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.family_invites'::regclass),
  'RLS is enabled on family_invites'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'family_invites'),
  0,
  'family_invites has no policies'
);
select ok(
  not has_table_privilege('authenticated', 'public.family_invites',
    'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('anon', 'public.family_invites',
    'select, insert, update, delete, truncate, references, trigger'),
  'authenticated and anon have no privilege on family_invites'
);
select is(
  (select count(*)::integer from pg_catalog.pg_proc p
   where p.oid in (
       'public.create_family_invite(text, jsonb, text)'::regprocedure,
       'public.list_family_invites()'::regprocedure,
       'public.revoke_family_invite(uuid)'::regprocedure
     )
     and p.prosecdef
     and p.proconfig = array['search_path=""']),
  3,
  'the three RPCs are security definer and pin an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.create_family_invite(text, jsonb, text)', 'execute')
  and has_function_privilege('authenticated', 'public.list_family_invites()', 'execute')
  and has_function_privilege('authenticated', 'public.revoke_family_invite(uuid)', 'execute'),
  'authenticated can execute the three RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.create_family_invite(text, jsonb, text)', 'execute')
  and not has_function_privilege('anon', 'public.list_family_invites()', 'execute')
  and not has_function_privilege('anon', 'public.revoke_family_invite(uuid)', 'execute'),
  'anon can execute none of the three RPCs'
);

-- The table's own checks (as the owner).
select throws_ok(
  $$ insert into public.family_invites (family_id, code_hash, role, permissions, expires_at)
     values ('f0800000-0000-4000-8000-0000000000a1', pg_temp.h('t1'), 'kid', null, now()) $$,
  '23514', null, 'the table refuses a kid invite without permissions'
);
select throws_ok(
  $$ insert into public.family_invites (family_id, code_hash, role, permissions, expires_at)
     values ('f0800000-0000-4000-8000-0000000000a1', pg_temp.h('t2'), 'parent',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off"}', now()) $$,
  '23514', null, 'the table refuses a parent invite with permissions'
);
select throws_ok(
  $$ insert into public.family_invites (family_id, code_hash, role, expires_at)
     values ('f0800000-0000-4000-8000-0000000000a1', pg_temp.h('t3'), 'admin', now()) $$,
  '23514', null, 'the table refuses an unknown role'
);
select throws_ok(
  $$ insert into public.family_invites (family_id, code_hash, role, expires_at)
     values ('f0800000-0000-4000-8000-0000000000a1', upper(pg_temp.h('t4')), 'parent', now()) $$,
  '23514', null, 'the table refuses a code hash that is not lowercase hex'
);

-- ---------------------------------------------------------------------------
-- Kids, users without a family and callers without a user id are refused
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0800000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select throws_ok(
  $$ select * from public.create_family_invite('parent', null, pg_temp.h('kid-parent')) $$,
  '42501', 'Only parents can invite people to the family.',
  'a kid cannot create a parent invite'
);
select throws_ok(
  $$ select * from public.create_family_invite('kid',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off"}', pg_temp.h('kid-kid')) $$,
  '42501', 'Only parents can invite people to the family.',
  'a kid cannot create a kid invite'
);
select throws_ok(
  $$ select * from public.create_family_invite('admin', '[]', 'not-a-hash') $$,
  '42501', 'Only parents can invite people to the family.',
  'a kid gets 42501, not 422, for invalid input'
);
select throws_ok(
  $$ select * from public.list_family_invites() $$,
  '42501', 'Only parents can see the family''s invites.',
  'a kid cannot list invites'
);
select throws_ok(
  $$ select public.revoke_family_invite('f0800000-0000-4000-8000-0000000000c4') $$,
  '42501', 'Only parents can revoke invites.',
  'a kid cannot revoke their family''s invite'
);
select throws_ok(
  $$ select public.revoke_family_invite('f0800000-0000-4000-8000-00000000ffff') $$,
  '42501', 'Only parents can revoke invites.',
  'a kid gets 42501, not 404, for an unknown invite'
);
select throws_ok(
  $$ select * from public.family_invites $$,
  '42501', null,
  'a kid cannot read family_invites directly'
);

select set_config('request.jwt.claims', '{"sub":"f0800000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.create_family_invite('parent', null, pg_temp.h('no-family')) $$,
  '42501', 'Only parents can invite people to the family.',
  'a user without a family cannot create an invite'
);
select throws_ok(
  $$ select * from public.list_family_invites() $$,
  '42501', 'Only parents can see the family''s invites.',
  'a user without a family cannot list invites'
);
select throws_ok(
  $$ select public.revoke_family_invite('f0800000-0000-4000-8000-0000000000c4') $$,
  '42501', 'Only parents can revoke invites.',
  'a user without a family cannot revoke an invite'
);

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.create_family_invite('parent', null, pg_temp.h('no-user')) $$,
  '42501', 'Only parents can invite people to the family.',
  'a caller without a user id cannot create an invite'
);

select is(pg_temp.invite_count(), 5, 'the refused calls created no invites');
select is(
  pg_temp.revoked_states(),
  array['c1:no', 'c2:no', 'c3:before', 'c4:no', 'd1:no'],
  'the refused calls revoked nothing'
);

-- ---------------------------------------------------------------------------
-- A parent's invalid input
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"f0800000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select throws_ok(
  $$ select * from public.create_family_invite('admin', null, pg_temp.h('bad-role')) $$,
  '23514', 'Choose whether to invite a parent or a kid.',
  'an unknown role is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('Parent', null, pg_temp.h('bad-case')) $$,
  '23514', 'Choose whether to invite a parent or a kid.',
  'roles are case-sensitive'
);
select throws_ok(
  $$ select * from public.create_family_invite(null, null, pg_temp.h('null-role')) $$,
  '23514', 'Choose whether to invite a parent or a kid.',
  'a null role is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('parent',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off"}', pg_temp.h('parent-perms')) $$,
  '23514', 'Parents always have full access, so a parent invite can''t have permissions.',
  'a parent invite with permissions is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('parent', '{}', pg_temp.h('parent-empty')) $$,
  '23514', 'Parents always have full access, so a parent invite can''t have permissions.',
  'a parent invite with an empty object is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('kid', null, pg_temp.h('kid-null')) $$,
  '23514', 'Choose an allowed level for every module.',
  'a kid invite without permissions is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('kid', 'null', pg_temp.h('kid-json-null')) $$,
  '23514', 'Choose an allowed level for every module.',
  'a kid invite with JSON null permissions is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('kid',
       '{"expenses":"edit","investments":"off","net_worth":"off"}', pg_temp.h('kid-missing')) $$,
  '23514', 'Choose an allowed level for every module.',
  'a kid invite missing a module is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('kid',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"edit"}', pg_temp.h('kid-level')) $$,
  '23514', 'Choose an allowed level for every module.',
  'a kid invite with a level the module does not allow is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('kid',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","boats":"off"}', pg_temp.h('kid-extra')) $$,
  '23514', 'Choose an allowed level for every module.',
  'a kid invite with an unknown module is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('parent', null, upper(pg_temp.h('upper'))) $$,
  '23514', 'The invite code is not valid.',
  'an uppercase code hash is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('parent', null, left(pg_temp.h('short'), 63)) $$,
  '23514', 'The invite code is not valid.',
  'a code hash shorter than 64 characters is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('parent', null, pg_temp.h('long') || '0') $$,
  '23514', 'The invite code is not valid.',
  'a code hash longer than 64 characters is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('parent', null, 'ABCD2345') $$,
  '23514', 'The invite code is not valid.',
  'a plain code instead of its hash is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('parent', null, null) $$,
  '23514', 'The invite code is not valid.',
  'a null code hash is refused'
);
select throws_ok(
  $$ select * from public.create_family_invite('parent', null, pg_temp.h('c4')) $$,
  '23505', 'That invite code is already in use.',
  'a code hash already used in the family is refused with 23505'
);
select throws_ok(
  $$ select * from public.create_family_invite('kid',
       '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off"}', pg_temp.h('d1')) $$,
  '23505', 'That invite code is already in use.',
  'a code hash used by another family is refused with 23505'
);

select is(pg_temp.invite_count(), 5, 'the refused calls still created no invites');

-- ---------------------------------------------------------------------------
-- Parents create invites; the expiry is set by role
-- ---------------------------------------------------------------------------

-- The second parent (not the creator) creates p1, pj and k1.
insert into invite_labels (label, invite_id, expires_at)
select 'p1', r.invite_id, r.expires_at
from public.create_family_invite('parent', null, pg_temp.h('p1')) r;
insert into invite_labels (label, invite_id, expires_at)
select 'pj', r.invite_id, r.expires_at
from public.create_family_invite('parent', 'null', pg_temp.h('pj')) r;
insert into invite_labels (label, invite_id, expires_at)
select 'k1', r.invite_id, r.expires_at
from public.create_family_invite('kid',
  '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"off"}', pg_temp.h('k1')) r;

-- The creator creates k2, and Dana creates p2.
select set_config('request.jwt.claims', '{"sub":"f0800000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into invite_labels (label, invite_id, expires_at)
select 'k2', r.invite_id, r.expires_at
from public.create_family_invite('kid',
  '{"family_finance":"view","net_worth":"off","investments":"off","expenses":"edit"}', pg_temp.h('k2')) r;

select set_config('request.jwt.claims', '{"sub":"f0800000-0000-4000-8000-000000000006","role":"authenticated"}', true);
insert into invite_labels (label, invite_id, expires_at)
select 'p2', r.invite_id, r.expires_at
from public.create_family_invite('parent', null, pg_temp.h('p2')) r;

reset role;

select is(pg_temp.invite_count(), 10, 'each successful call created one invite');
select is(
  (select array_agg(l.label || ':' || (extract(epoch from l.expires_at - now()) / 3600)::integer || 'h' order by l.label)
   from invite_labels l where l.expires_at is not null),
  array['k1:168h', 'k2:168h', 'p1:48h', 'p2:48h', 'pj:48h'],
  'the returned expiry is 48 hours for parent invites and 7 days for kid invites'
);
select is(
  (select array_agg(
     l.label || ':' || right(i.family_id::text, 2) || ':' || i.role || ':'
     || right(i.created_by::text, 2) || ':' || (extract(epoch from i.expires_at - i.created_at) / 3600)::integer || 'h'
     order by l.label)
   from invite_labels l join public.family_invites i on i.id = l.invite_id
   where l.expires_at is not null),
  array[
    'k1:a1:kid:02:168h',
    'k2:a1:kid:01:168h',
    'p1:a1:parent:02:48h',
    'p2:a1:parent:06:48h',
    'pj:a1:parent:02:48h'
  ],
  'the stored rows match the returned ids, with the caller''s family, the role, the creator and the expiry'
);
select ok(
  (select bool_and(
     i.code_hash = pg_temp.h(l.label)
     and i.created_at = now()
     and i.used_at is null and i.used_by is null and i.revoked_at is null)
   from invite_labels l join public.family_invites i on i.id = l.invite_id
   where l.expires_at is not null),
  'new invites store the hash as given, start now, and are neither used nor revoked'
);
select is(
  (select array_agg(l.label || ':' || coalesce(i.permissions::text, 'null') order by l.label)
   from invite_labels l join public.family_invites i on i.id = l.invite_id
   where l.label in ('p1', 'pj', 'p2')),
  array['p1:null', 'p2:null', 'pj:null'],
  'parent invites store no permissions, even when given a JSON null'
);
select is(
  (select i.permissions from public.family_invites i
   join invite_labels l on l.invite_id = i.id where l.label = 'k1'),
  '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"off"}'::jsonb,
  'a kid invite stores its permissions'
);
select is(
  (select i.permissions from public.family_invites i
   join invite_labels l on l.invite_id = i.id where l.label = 'k2'),
  '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"view"}'::jsonb,
  'a kid invite stores permissions given in any key order'
);

-- ---------------------------------------------------------------------------
-- Listing pending invites
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0800000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select array_agg(x order by x) from unnest(pg_temp.listed()) as x),
  array[
    'c4:parent:-',
    'k1:kid:bogdan.f08',
    'k2:kid:Ana',
    'p1:parent:bogdan.f08',
    'p2:parent:Dana',
    'pj:parent:bogdan.f08'
  ],
  'the creator lists the family''s pending invites, with display name, then username, then nothing'
);
select is(
  (pg_temp.listed())[6],
  'c4:parent:-',
  'the oldest invite is listed last'
);
select is(
  (select array_agg(r.created_at order by r.ordinality)
   from public.list_family_invites() with ordinality as r),
  (select array_agg(r.created_at order by r.created_at desc)
   from public.list_family_invites() r),
  'invites are listed newest first'
);
select is(
  (select r.permissions from public.list_family_invites() r
   join invite_labels l on l.invite_id = r.invite_id where l.label = 'k1'),
  '{"expenses":"edit","investments":"edit","net_worth":"edit","family_finance":"off"}'::jsonb,
  'a listed kid invite shows its permissions'
);
select ok(
  (select bool_and(r.permissions is null) from public.list_family_invites() r where r.role = 'parent'),
  'listed parent invites have null permissions'
);
select is(
  (select r.expires_at - r.created_at from public.list_family_invites() r
   join invite_labels l on l.invite_id = r.invite_id where l.label = 'c4'),
  interval '48 hours',
  'listed invites carry created_at and expires_at'
);

select set_config('request.jwt.claims', '{"sub":"f0800000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select array_agg(x order by x) from unnest(pg_temp.listed()) as x),
  array[
    'c4:parent:-',
    'k1:kid:bogdan.f08',
    'k2:kid:Ana',
    'p1:parent:bogdan.f08',
    'p2:parent:Dana',
    'pj:parent:bogdan.f08'
  ],
  'a second parent sees the same invites'
);

select set_config('request.jwt.claims', '{"sub":"f0800000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  pg_temp.listed(),
  array['d1:kid:f08-b-creator'],
  'another family''s parent sees only their own invite, named by email without a profile'
);

-- Dana's account is deleted: the invite stays, without a creator.
reset role;
delete from auth.users where id = 'f0800000-0000-4000-8000-000000000006';
select is(
  (select i.created_by from public.family_invites i
   join invite_labels l on l.invite_id = i.id where l.label = 'p2'),
  null,
  'deleting the creator''s account keeps the invite and clears created_by'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0800000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select x from unnest(pg_temp.listed()) as x where x like 'p2:%'),
  'p2:parent:-',
  'an invite whose creator was deleted is listed without a name'
);

-- ---------------------------------------------------------------------------
-- Revoking
-- ---------------------------------------------------------------------------

-- Another family's parent can't revoke family A's invite, and can't tell it
-- apart from an unknown one.
select set_config('request.jwt.claims', '{"sub":"f0800000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.revoke_family_invite('f0800000-0000-4000-8000-0000000000c4') $$,
  'P0002', 'That invite wasn''t found.',
  'a parent cannot revoke another family''s invite'
);
select throws_ok(
  $$ select public.revoke_family_invite('f0800000-0000-4000-8000-00000000ffff') $$,
  'P0002', 'That invite wasn''t found.',
  'an unknown invite is not found'
);
select throws_ok(
  $$ select public.revoke_family_invite(null) $$,
  'P0002', 'That invite wasn''t found.',
  'a null invite id is not found'
);
select is(
  pg_temp.revoked_states(),
  array['c1:no', 'c2:no', 'c3:before', 'c4:no', 'd1:no', 'k1:no', 'k2:no', 'p1:no', 'p2:no', 'pj:no'],
  'the refused calls revoked nothing'
);

-- The second parent revokes c4 (pending), c3 (already revoked), c2 (used)
-- and c1 (expired).
select set_config('request.jwt.claims', '{"sub":"f0800000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.revoke_family_invite('f0800000-0000-4000-8000-0000000000c4') $$,
  'a parent can revoke a pending invite'
);
select lives_ok(
  $$ select public.revoke_family_invite('f0800000-0000-4000-8000-0000000000c3') $$,
  'revoking an already revoked invite succeeds'
);
select lives_ok(
  $$ select public.revoke_family_invite('f0800000-0000-4000-8000-0000000000c2') $$,
  'revoking a used invite succeeds'
);
select lives_ok(
  $$ select public.revoke_family_invite('f0800000-0000-4000-8000-0000000000c1') $$,
  'revoking an expired invite succeeds'
);
select is(
  pg_temp.revoked_states(),
  array['c1:now', 'c2:no', 'c3:before', 'c4:now', 'd1:no', 'k1:no', 'k2:no', 'p1:no', 'p2:no', 'pj:no'],
  'the pending and expired invites are revoked now; the earlier revoke and the used invite are unchanged'
);
select is(
  (select array_agg(x order by x) from unnest(pg_temp.listed()) as x),
  array[
    'k1:kid:bogdan.f08',
    'k2:kid:Ana',
    'p1:parent:bogdan.f08',
    'p2:parent:-',
    'pj:parent:bogdan.f08'
  ],
  'a revoked invite is no longer listed'
);

-- Family B's creator revokes their own invite.
select set_config('request.jwt.claims', '{"sub":"f0800000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select lives_ok(
  $$ select public.revoke_family_invite('f0800000-0000-4000-8000-0000000000d1') $$,
  'another family''s creator can revoke their own invite'
);
select is(pg_temp.listed(), '{}'::text[], 'after revoking its only invite, the other family lists none');

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select * from public.create_family_invite('parent', null, pg_temp.h('anon')) $$,
  '42501', null, 'anon cannot call create_family_invite'
);
select throws_ok($$ select * from public.list_family_invites() $$, '42501', null, 'anon cannot call list_family_invites');
select throws_ok(
  $$ select public.revoke_family_invite('f0800000-0000-4000-8000-0000000000c4') $$,
  '42501', null, 'anon cannot call revoke_family_invite'
);
select throws_ok($$ select * from public.family_invites $$, '42501', null, 'anon cannot read family_invites');

reset role;
select * from finish();
rollback;
