begin;
create extension if not exists pgtap;
select plan(19);

-- Profile pictures: profiles.avatar_path, its guard, the private avatars bucket,
-- its read policy and get_family()'s avatarPath.
--
-- Users (prefix a7a00000):
--   family A: 01 creator, 02 second parent, 03 kid
--   family B: 04 creator
--   05 has no family.
-- Member ids: a2..a4 in family a1, b2 in family b1, in user order.

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a7a00000-0000-4000-8000-000000000001', 'av-a-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('a7a00000-0000-4000-8000-000000000002', 'av-a-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('a7a00000-0000-4000-8000-000000000003', 'av-a-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('a7a00000-0000-4000-8000-000000000004', 'av-b-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('a7a00000-0000-4000-8000-000000000005', 'av-no-family@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, display_name) values
  ('a7a00000-0000-4000-8000-000000000001', 'av-a-creator@example.test', 'A creator'),
  ('a7a00000-0000-4000-8000-000000000002', 'av-a-parent@example.test', 'A parent'),
  ('a7a00000-0000-4000-8000-000000000003', 'av-a-kid@example.test', 'A kid'),
  ('a7a00000-0000-4000-8000-000000000004', 'av-b-creator@example.test', 'B creator'),
  ('a7a00000-0000-4000-8000-000000000005', 'av-no-family@example.test', 'No family')
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('a7a00000-0000-4000-8000-0000000000a1', 'Family A', 'a7a00000-0000-4000-8000-000000000001'),
  ('a7a00000-0000-4000-8000-0000000000b1', 'Family B', 'a7a00000-0000-4000-8000-000000000004');

insert into public.family_members (id, family_id, user_id, role, joined_at) values
  ('a7a00000-0000-4000-8000-0000000000a2', 'a7a00000-0000-4000-8000-0000000000a1', 'a7a00000-0000-4000-8000-000000000001', 'parent', '2026-01-01 09:00:00+00'),
  ('a7a00000-0000-4000-8000-0000000000a3', 'a7a00000-0000-4000-8000-0000000000a1', 'a7a00000-0000-4000-8000-000000000002', 'parent', '2026-01-02 09:00:00+00'),
  ('a7a00000-0000-4000-8000-0000000000a4', 'a7a00000-0000-4000-8000-0000000000a1', 'a7a00000-0000-4000-8000-000000000003', 'kid', '2026-01-03 09:00:00+00'),
  ('a7a00000-0000-4000-8000-0000000000b2', 'a7a00000-0000-4000-8000-0000000000b1', 'a7a00000-0000-4000-8000-000000000004', 'parent', '2026-02-01 09:00:00+00');

-- One object per user except 02, written as the table owner (as the server's
-- secret key would).
insert into storage.objects (bucket_id, name) values
  ('avatars', 'a7a00000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp'),
  ('avatars', 'a7a00000-0000-4000-8000-000000000003/33333333-3333-4333-8333-333333333333.webp'),
  ('avatars', 'a7a00000-0000-4000-8000-000000000004/44444444-4444-4444-8444-444444444444.webp'),
  ('avatars', 'a7a00000-0000-4000-8000-000000000005/55555555-5555-4555-8555-555555555555.webp');

-- The owners (folder names) of the avatars the caller can see, sorted.
create function pg_temp.visible_avatar_owners()
returns text[]
language sql
as $$
  select coalesce(array_agg((storage.foldername(o.name))[1] order by o.name), '{}')
  from storage.objects o
  where o.bucket_id = 'avatars'
$$;

-- Structure
select ok(
  (select not b.public from storage.buckets b where b.id = 'avatars'),
  'the avatars bucket exists and is private'
);
select ok(
  (select not p.prosecdef and p.proconfig = array['search_path=""']
   from pg_catalog.pg_proc p
   where p.oid = 'public.guard_profile_avatar_path()'::regprocedure),
  'guard_profile_avatar_path is security invoker and pins an empty search_path'
);
select ok(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
   from pg_catalog.pg_proc p
   where p.oid = 'family_private.visible_avatar_owner_ids()'::regprocedure),
  'visible_avatar_owner_ids is security definer, stable and pins an empty search_path'
);
select is(
  (select count(*)::integer
   from pg_catalog.pg_policies
   where schemaname = 'storage'
     and cmd <> 'SELECT'
     and (coalesce(qual, '') like '%avatars%' or coalesce(with_check, '') like '%avatars%')),
  0,
  'no insert, update or delete policy mentions the avatars bucket'
);

-- The server (table owner) sets avatar_path; the key must sit in the owner's folder
select lives_ok(
  $$ update public.profiles
     set avatar_path = 'a7a00000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp'
     where id = 'a7a00000-0000-4000-8000-000000000001' $$,
  'the server sets a well-formed avatar path'
);
select throws_ok(
  $$ update public.profiles
     set avatar_path = 'a7a00000-0000-4000-8000-000000000002/11111111-1111-4111-8111-111111111111.webp'
     where id = 'a7a00000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a path in another user''s folder is refused'
);
select throws_ok(
  $$ update public.profiles
     set avatar_path = 'a7a00000-0000-4000-8000-000000000001/AAAAAAAA-1111-4111-8111-111111111111.webp'
     where id = 'a7a00000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an upper-case uuid is refused'
);
select throws_ok(
  $$ update public.profiles
     set avatar_path = 'a7a00000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.png'
     where id = 'a7a00000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a key that isn''t .webp is refused'
);
select throws_ok(
  $$ update public.profiles
     set avatar_path = '11111111-1111-4111-8111-111111111111.webp'
     where id = 'a7a00000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a key without a folder is refused'
);

-- Reading the bucket
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"a7a00000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  pg_temp.visible_avatar_owners(),
  array['a7a00000-0000-4000-8000-000000000001', 'a7a00000-0000-4000-8000-000000000003'],
  'a parent sees the pictures of their family, not of other families or strangers'
);

select set_config('request.jwt.claims', '{"sub":"a7a00000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(
  pg_temp.visible_avatar_owners(),
  array['a7a00000-0000-4000-8000-000000000001', 'a7a00000-0000-4000-8000-000000000003'],
  'a kid sees everyone in their family, themselves included'
);

select set_config('request.jwt.claims', '{"sub":"a7a00000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  pg_temp.visible_avatar_owners(),
  array['a7a00000-0000-4000-8000-000000000004'],
  'a member of another family sees only their own family'
);

select set_config('request.jwt.claims', '{"sub":"a7a00000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select is(
  pg_temp.visible_avatar_owners(),
  array['a7a00000-0000-4000-8000-000000000005'],
  'a user without a family sees only their own picture'
);

-- Signed-in users can't set avatar_path, not even their own
select set_config('request.jwt.claims', '{"sub":"a7a00000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ update public.profiles
     set avatar_path = 'a7a00000-0000-4000-8000-000000000002/22222222-2222-4222-8222-222222222222.webp'
     where id = 'a7a00000-0000-4000-8000-000000000002' $$,
  '42501', null, 'a user cannot set their own avatar path'
);
select throws_ok(
  $$ insert into public.profiles (id, email, avatar_path)
     values ('a7a00000-0000-4000-8000-000000000002', 'av-a-parent@example.test',
       'a7a00000-0000-4000-8000-000000000002/22222222-2222-4222-8222-222222222222.webp') $$,
  '42501', null, 'a user cannot insert a profile with an avatar path'
);

-- get_family()
select is(
  (select jsonb_object_agg(e ->> 'userId', e -> 'avatarPath')
   from jsonb_array_elements(public.get_family() -> 'members') as e),
  $json${
    "a7a00000-0000-4000-8000-000000000001": "a7a00000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp",
    "a7a00000-0000-4000-8000-000000000002": null,
    "a7a00000-0000-4000-8000-000000000003": null
  }$json$::jsonb,
  'get_family shows each member''s avatar path, null without a picture'
);
select is(
  (select array_agg(k order by k)
   from jsonb_object_keys(
     (select e from jsonb_array_elements(public.get_family() -> 'members') as e
      where e ->> 'userId' = 'a7a00000-0000-4000-8000-000000000001')
   ) as k),
  array['avatarPath', 'color', 'currency', 'displayName', 'isCreator', 'joinedAt',
    'lastActiveAt', 'memberId', 'permissions', 'role', 'userId', 'username'],
  'get_family''s member entries keep every earlier field and add only avatarPath'
);

-- The guard only fires on avatar_path
select lives_ok(
  $$ update public.profiles set currency = 'USD'
     where id = 'a7a00000-0000-4000-8000-000000000002' $$,
  'a user still updates other profile fields'
);
select is(
  (select e ->> 'currency'
   from jsonb_array_elements(public.get_family() -> 'members') as e
   where e ->> 'userId' = 'a7a00000-0000-4000-8000-000000000002'),
  'USD',
  'the profile update took effect'
);

reset role;
select * from finish();
rollback;
