begin;
create extension if not exists pgtap;
select plan(15);

-- M1: the mcp kid permission (off / edit) in the permission catalogue.
--
-- Users (prefix e1000000):
--   family A: 01 creator, 02 kid with stored rows but none for mcp
--   03 has no family and redeems an invite created before the migration.
-- Member ids: a2 (01), a3 (02).

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('e1000000-0000-4000-8000-000000000001', 'm1-a-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000002', 'm1-a-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000003', 'm1-joiner@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.families (id, name, creator_id) values
  ('e1000000-0000-4000-8000-0000000000a1', 'Family A', 'e1000000-0000-4000-8000-000000000001');

insert into public.family_members (id, family_id, user_id, role) values
  ('e1000000-0000-4000-8000-0000000000a2', 'e1000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-000000000001', 'parent'),
  ('e1000000-0000-4000-8000-0000000000a3', 'e1000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-000000000002', 'kid');

-- An existing kid: rows from before the migration, none for mcp.
insert into public.member_permissions (member_id, module, level) values
  ('e1000000-0000-4000-8000-0000000000a3', 'expenses', 'edit'),
  ('e1000000-0000-4000-8000-0000000000a3', 'investments', 'edit');

-- sha256 of a label as lowercase hex, the format the app sends.
create function pg_temp.h(p_label text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(p_label, 'UTF8')), 'hex')
$$;

-- Whether the member_permissions check accepts a (module, level) pair.
create function pg_temp.accepts_permission(p_module text, p_level text)
returns boolean
language plpgsql
as $$
begin
  insert into public.member_permissions (member_id, module, level)
  values ('e1000000-0000-4000-8000-0000000000a3', p_module, p_level);
  delete from public.member_permissions
  where member_id = 'e1000000-0000-4000-8000-0000000000a3' and module = p_module;
  return true;
exception when check_violation then
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Only off and edit are allowed for mcp
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(l order by l)
   from unnest(array['off', 'view', 'edit', 'admin']) as l
   where pg_temp.accepts_permission('mcp', l)),
  array['edit', 'off'],
  'the member_permissions check allows mcp at off and edit only'
);
select ok(
  family_private.is_valid_permissions(
    '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}'),
  'a permissions object with mcp off is valid'
);
select ok(
  family_private.is_valid_permissions(
    '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"edit","ai":"off"}'),
  'a permissions object with mcp edit is valid'
);
select ok(
  not family_private.is_valid_permissions(
    '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off","mcp":"view","ai":"off"}'),
  'view is not allowed for mcp'
);
select ok(
  not family_private.is_valid_permissions(
    '{"expenses":"edit","investments":"off","net_worth":"off","family_finance":"off"}'),
  'a permissions object without mcp is no longer complete'
);
select is(
  family_private.module_keys(),
  array['expenses', 'investments', 'net_worth', 'family_finance', 'mcp', 'ai'],
  'module_keys lists mcp after the four finance modules'
);

-- A pending kid invite from before the migration: the old four-module object.
-- The migration's backfill ran during replay, before this row existed, so it is
-- repeated below exactly as the migration has it.
insert into public.family_invites
  (id, family_id, code_hash, role, permissions, created_by, expires_at)
values
  ('e1000000-0000-4000-8000-0000000000c1', 'e1000000-0000-4000-8000-0000000000a1', pg_temp.h('old-kid'), 'kid',
   '{"expenses":"edit","investments":"off","net_worth":"edit","family_finance":"view"}',
   'e1000000-0000-4000-8000-000000000001', now() + interval '7 days');

select ok(
  not family_private.is_valid_permissions(
    (select i.permissions from public.family_invites i where i.id = 'e1000000-0000-4000-8000-0000000000c1')),
  'without the backfill, the old invite''s permissions would be refused'
);

update public.family_invites
set permissions = permissions || '{"mcp": "off", "ai": "off"}'::jsonb
where role = 'kid' and not permissions ? 'mcp';

select is(
  (select i.permissions from public.family_invites i where i.id = 'e1000000-0000-4000-8000-0000000000c1'),
  '{"expenses":"edit","investments":"off","net_worth":"edit","family_finance":"view","mcp":"off","ai":"off"}'::jsonb,
  'the backfill adds mcp off and keeps the other levels'
);

-- ---------------------------------------------------------------------------
-- As signed-in users
-- ---------------------------------------------------------------------------

set local role authenticated;

-- The old invite still redeems.
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.redeem_family_invite(pg_temp.h('old-kid')) $$,
  'a pending kid invite created before the migration still redeems'
);
select is(
  (select m.permissions from public.get_my_membership() m),
  '{"expenses":"edit","investments":"off","net_worth":"edit","family_finance":"view","mcp":"off","ai":"off"}'::jsonb,
  'the kid who redeemed it has mcp off'
);

-- The creator reads the existing kid and changes their permissions.
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select e -> 'permissions'
   from jsonb_array_elements(public.get_family() -> 'members') as e
   where e ->> 'memberId' = 'e1000000-0000-4000-8000-0000000000a3'),
  '{"expenses":"edit","investments":"edit","net_worth":"off","family_finance":"off","mcp":"off","ai":"off"}'::jsonb,
  'get_family reports mcp off for an existing kid without an mcp row'
);
select throws_ok(
  $$ select public.set_member_permissions('e1000000-0000-4000-8000-0000000000a3',
       '{"expenses":"edit","investments":"edit","net_worth":"off","family_finance":"off"}') $$,
  '23514', 'Choose an allowed level for every module.',
  'set_member_permissions refuses an object without mcp'
);
select throws_ok(
  $$ select public.set_member_permissions('e1000000-0000-4000-8000-0000000000a3',
       '{"expenses":"edit","investments":"edit","net_worth":"off","family_finance":"off","mcp":"view","ai":"off"}') $$,
  '23514', 'Choose an allowed level for every module.',
  'set_member_permissions refuses mcp at view'
);
select lives_ok(
  $$ select public.set_member_permissions('e1000000-0000-4000-8000-0000000000a3',
       '{"expenses":"edit","investments":"edit","net_worth":"off","family_finance":"off","mcp":"edit","ai":"off"}') $$,
  'set_member_permissions takes an object with mcp'
);
select is(
  (select e -> 'permissions' ->> 'mcp'
   from jsonb_array_elements(public.get_family() -> 'members') as e
   where e ->> 'memberId' = 'e1000000-0000-4000-8000-0000000000a3'),
  'edit',
  'get_family reports the kid''s new mcp level'
);

reset role;

select * from finish();
rollback;
