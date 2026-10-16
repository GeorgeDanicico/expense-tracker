begin;
create extension if not exists pgtap;
select plan(9);

-- F49: get_family() returns every member's currency.
--
-- Users (prefix f4900000):
--   family A: 01 creator (profile, RON), 02 kid (profile, USD), 03 kid (no profile row)
--   family B: 04 creator (profile, GBP)
--   05 has no family.
-- Member ids: a2..a4 in family a1, b2 in family b1, in user order.
set local timezone = 'UTC';

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f4900000-0000-4000-8000-000000000001', 'cur-a-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f4900000-0000-4000-8000-000000000002', 'cur-a-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f4900000-0000-4000-8000-000000000003', 'cur-a-kid-two@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f4900000-0000-4000-8000-000000000004', 'cur-b-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f4900000-0000-4000-8000-000000000005', 'cur-no-family@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

-- Kid 03 has no profile row at all.
insert into public.profiles (id, email, display_name, currency)
values
  ('f4900000-0000-4000-8000-000000000001', 'cur-a-creator@example.test', 'Ana', 'RON'),
  ('f4900000-0000-4000-8000-000000000002', 'cur-a-kid@example.test', 'Mihai', 'USD'),
  ('f4900000-0000-4000-8000-000000000004', 'cur-b-creator@example.test', 'Bianca', 'GBP');

insert into public.families (id, name, creator_id, created_at) values
  ('f4900000-0000-4000-8000-0000000000a1', 'Family A', 'f4900000-0000-4000-8000-000000000001', '2026-01-01 08:00:00+00'),
  ('f4900000-0000-4000-8000-0000000000b1', 'Family B', 'f4900000-0000-4000-8000-000000000004', '2026-02-01 08:00:00+00');

insert into public.family_members (id, family_id, user_id, role, joined_at) values
  ('f4900000-0000-4000-8000-0000000000a2', 'f4900000-0000-4000-8000-0000000000a1', 'f4900000-0000-4000-8000-000000000001', 'parent', '2026-01-01 09:00:00+00'),
  ('f4900000-0000-4000-8000-0000000000a3', 'f4900000-0000-4000-8000-0000000000a1', 'f4900000-0000-4000-8000-000000000002', 'kid', '2026-01-02 09:00:00+00'),
  ('f4900000-0000-4000-8000-0000000000a4', 'f4900000-0000-4000-8000-0000000000a1', 'f4900000-0000-4000-8000-000000000003', 'kid', '2026-01-03 09:00:00+00'),
  ('f4900000-0000-4000-8000-0000000000b2', 'f4900000-0000-4000-8000-0000000000b1', 'f4900000-0000-4000-8000-000000000004', 'parent', '2026-02-01 09:00:00+00');

-- A parent sees every member's currency; the fallback fills the missing row.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f4900000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select jsonb_object_agg(e ->> 'memberId', e ->> 'currency')
   from jsonb_array_elements(public.get_family() -> 'members') as e),
  $json${
    "f4900000-0000-4000-8000-0000000000a2": "RON",
    "f4900000-0000-4000-8000-0000000000a3": "USD",
    "f4900000-0000-4000-8000-0000000000a4": "EUR"
  }$json$::jsonb,
  'a parent sees each member''s currency'
);
select is(
  public.get_family() -> 'members' -> 2 ->> 'currency',
  'EUR',
  'a member without a profile row gets the default currency'
);
select is(
  (select count(*)::integer from jsonb_array_elements(public.get_family() -> 'members') as e
   where not (e ? 'currency')),
  0,
  'every member entry carries a currency'
);
select is(
  public.get_family() -> 'members' -> 1,
  $json${
    "memberId": "f4900000-0000-4000-8000-0000000000a3", "userId": "f4900000-0000-4000-8000-000000000002",
    "role": "kid", "isCreator": false, "displayName": "Mihai", "username": null, "currency": "USD",
    "joinedAt": "2026-01-02T09:00:00+00:00", "lastActiveAt": null,
    "permissions": {"expenses": "off", "investments": "off", "net_worth": "off", "family_finance": "off"}
  }$json$::jsonb,
  'a kid''s entry has nothing new but the currency'
);

-- profiles' policies are unchanged: the parent still can't read the kid's row.
select is(
  (select count(*)::integer from public.profiles where id = 'f4900000-0000-4000-8000-000000000002'),
  0,
  'a parent still cannot read a kid''s profile row'
);

-- A kid sees the same currencies, and still no one else's lastActiveAt or permissions.
select set_config('request.jwt.claims', '{"sub":"f4900000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select jsonb_object_agg(e ->> 'memberId', e ->> 'currency')
   from jsonb_array_elements(public.get_family() -> 'members') as e),
  $json${
    "f4900000-0000-4000-8000-0000000000a2": "RON",
    "f4900000-0000-4000-8000-0000000000a3": "USD",
    "f4900000-0000-4000-8000-0000000000a4": "EUR"
  }$json$::jsonb,
  'a kid sees every member''s currency too'
);
select is(
  (select count(*)::integer from jsonb_array_elements(public.get_family() -> 'members') as e
   where e ->> 'memberId' <> 'f4900000-0000-4000-8000-0000000000a3'
     and (e ? 'lastActiveAt' or e ? 'permissions')),
  0,
  'a kid still sees no one else''s lastActiveAt or permissions'
);

-- Another family sees only its own members.
select set_config('request.jwt.claims', '{"sub":"f4900000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  (select jsonb_agg(e ->> 'currency') from jsonb_array_elements(public.get_family() -> 'members') as e),
  '["GBP"]'::jsonb,
  'another family sees only its own members'' currencies'
);

select set_config('request.jwt.claims', '{"sub":"f4900000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select is(public.get_family(), null, 'get_family still returns null without a family');

select * from finish();
rollback;
