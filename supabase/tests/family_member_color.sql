begin;
create extension if not exists pgtap;
select plan(19);

-- Parents choose member colours: set_member_color() and get_family()'s color.
--
-- Users (prefix f6d00000):
--   family A: 01 creator, 02 second parent, 03 kid, 04 kid
--   family B: 05 creator
--   06 has no family.
-- Member ids: a2..a5 in family a1, b2 in family b1, in user order.

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f6d00000-0000-4000-8000-000000000001', 'col-a-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f6d00000-0000-4000-8000-000000000002', 'col-a-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f6d00000-0000-4000-8000-000000000003', 'col-a-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f6d00000-0000-4000-8000-000000000004', 'col-a-kid-two@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f6d00000-0000-4000-8000-000000000005', 'col-b-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f6d00000-0000-4000-8000-000000000006', 'col-no-family@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('f6d00000-0000-4000-8000-0000000000a1', 'Family A', 'f6d00000-0000-4000-8000-000000000001'),
  ('f6d00000-0000-4000-8000-0000000000b1', 'Family B', 'f6d00000-0000-4000-8000-000000000005');

insert into public.family_members (id, family_id, user_id, role, joined_at) values
  ('f6d00000-0000-4000-8000-0000000000a2', 'f6d00000-0000-4000-8000-0000000000a1', 'f6d00000-0000-4000-8000-000000000001', 'parent', '2026-01-01 09:00:00+00'),
  ('f6d00000-0000-4000-8000-0000000000a3', 'f6d00000-0000-4000-8000-0000000000a1', 'f6d00000-0000-4000-8000-000000000002', 'parent', '2026-01-02 09:00:00+00'),
  ('f6d00000-0000-4000-8000-0000000000a4', 'f6d00000-0000-4000-8000-0000000000a1', 'f6d00000-0000-4000-8000-000000000003', 'kid', '2026-01-03 09:00:00+00'),
  ('f6d00000-0000-4000-8000-0000000000a5', 'f6d00000-0000-4000-8000-0000000000a1', 'f6d00000-0000-4000-8000-000000000004', 'kid', '2026-01-04 09:00:00+00'),
  ('f6d00000-0000-4000-8000-0000000000b2', 'f6d00000-0000-4000-8000-0000000000b1', 'f6d00000-0000-4000-8000-000000000005', 'parent', '2026-02-01 09:00:00+00');

-- A member's colour, read as the table owner.
create function pg_temp.color_of(p_member_id uuid)
returns smallint
language sql
security definer
as $$
  select m.color from public.family_members m where m.id = p_member_id
$$;

-- Structure
select ok(
  (select p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=""']
   from pg_catalog.pg_proc p
   where p.oid = 'public.set_member_color(uuid, smallint)'::regprocedure),
  'set_member_color is security definer, volatile and pins an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.set_member_color(uuid, smallint)', 'execute')
  and not has_function_privilege('anon', 'public.set_member_color(uuid, smallint)', 'execute'),
  'authenticated can execute set_member_color and anon cannot'
);
select is(
  (select count(*)::integer from public.family_members where color is not null),
  0,
  'members start with automatic colours'
);

-- A parent
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f6d00000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000a4', 3::smallint) $$,
  'a parent picks a kid''s colour'
);
select lives_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000a3', 5::smallint) $$,
  'a parent picks another parent''s colour'
);
select lives_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000a2', 1::smallint) $$,
  'a parent picks their own colour'
);
select is(
  (select jsonb_object_agg(e ->> 'memberId', e -> 'color')
   from jsonb_array_elements(public.get_family() -> 'members') as e),
  $json${
    "f6d00000-0000-4000-8000-0000000000a2": 1,
    "f6d00000-0000-4000-8000-0000000000a3": 5,
    "f6d00000-0000-4000-8000-0000000000a4": 3,
    "f6d00000-0000-4000-8000-0000000000a5": null
  }$json$::jsonb,
  'get_family shows each member''s colour, null for automatic'
);
select throws_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000a5', 3::smallint) $$,
  '23505', null, 'a colour another member has is refused'
);
select lives_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000a4', 3::smallint) $$,
  'choosing the colour a member already has is fine'
);
select throws_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000a5', 9::smallint) $$,
  '23514', null, 'a colour above 8 is refused'
);
select throws_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000a5', 0::smallint) $$,
  '23514', null, 'a colour below 1 is refused'
);
select throws_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000b2', 2::smallint) $$,
  'P0002', null, 'a member of another family is not found'
);
select throws_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000ff', 2::smallint) $$,
  'P0002', null, 'an unknown member is not found'
);
select lives_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000a4', null) $$,
  'null resets a member to automatic'
);
select is(
  pg_temp.color_of('f6d00000-0000-4000-8000-0000000000a4'),
  null::smallint,
  'the reset clears the colour, freeing it'
);

-- Another family can use the same colour
select set_config('request.jwt.claims', '{"sub":"f6d00000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select lives_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000b2', 1::smallint) $$,
  'colours are unique per family, not globally'
);

-- A kid and a user without a family
select set_config('request.jwt.claims', '{"sub":"f6d00000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000a5', 2::smallint) $$,
  '42501', null, 'a kid cannot choose colours'
);
select set_config('request.jwt.claims', '{"sub":"f6d00000-0000-4000-8000-000000000006","role":"authenticated"}', true);
select throws_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000a5', 2::smallint) $$,
  '42501', null, 'a user without a family cannot choose colours'
);

-- anon
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select public.set_member_color('f6d00000-0000-4000-8000-0000000000a5', 2::smallint) $$,
  '42501', null, 'anon cannot call set_member_color'
);

reset role;
select * from finish();
rollback;
