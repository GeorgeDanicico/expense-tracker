begin;
create extension if not exists pgtap;
select plan(32);

-- Runs as the table owner, so RLS hides nothing.
-- Users: 01 creates family A, 02 is a second parent in A, 03 and 04 are kids
-- in A, 05 creates family B, 06 is a kid in B, 07 creates family C (deleted
-- whole), 08 is a kid in C, 09 and 10 have no family.
insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f0500000-0000-4000-8000-000000000001', 'inv-a-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0500000-0000-4000-8000-000000000002', 'inv-a-parent@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0500000-0000-4000-8000-000000000003', 'inv-a-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0500000-0000-4000-8000-000000000004', 'inv-a-kid-two@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0500000-0000-4000-8000-000000000005', 'inv-b-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0500000-0000-4000-8000-000000000006', 'inv-b-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0500000-0000-4000-8000-000000000007', 'inv-c-creator@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0500000-0000-4000-8000-000000000008', 'inv-c-kid@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0500000-0000-4000-8000-000000000009', 'inv-loner@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('f0500000-0000-4000-8000-000000000010', 'inv-loner-two@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

-- Runs a statement and then fires the deferred creator check right away, as a
-- commit would. Used inside lives_ok/throws_ok so a failure rolls back both.
create function pg_temp.run_and_check(p_sql text)
returns void
language plpgsql
as $$
begin
  execute p_sql;
  set constraints public.families_creator_is_parent immediate;
  set constraints public.families_creator_is_parent deferred;
end;
$$;

-- Setup: the family first, then the creator's membership, as create_family will.
select lives_ok($$
  select pg_temp.run_and_check($sql$
    insert into public.families (id, name, creator_id) values
      ('f0500000-0000-4000-8000-0000000000a1', 'Family A', 'f0500000-0000-4000-8000-000000000001'),
      ('f0500000-0000-4000-8000-0000000000b1', 'Family B', 'f0500000-0000-4000-8000-000000000005'),
      ('f0500000-0000-4000-8000-0000000000c1', 'Family C', 'f0500000-0000-4000-8000-000000000007');
    insert into public.family_members (id, family_id, user_id, role) values
      ('f0500000-0000-4000-8000-0000000000a2', 'f0500000-0000-4000-8000-0000000000a1', 'f0500000-0000-4000-8000-000000000001', 'parent'),
      ('f0500000-0000-4000-8000-0000000000a3', 'f0500000-0000-4000-8000-0000000000a1', 'f0500000-0000-4000-8000-000000000002', 'parent'),
      ('f0500000-0000-4000-8000-0000000000a4', 'f0500000-0000-4000-8000-0000000000a1', 'f0500000-0000-4000-8000-000000000003', 'kid'),
      ('f0500000-0000-4000-8000-0000000000a5', 'f0500000-0000-4000-8000-0000000000a1', 'f0500000-0000-4000-8000-000000000004', 'kid'),
      ('f0500000-0000-4000-8000-0000000000b2', 'f0500000-0000-4000-8000-0000000000b1', 'f0500000-0000-4000-8000-000000000005', 'parent'),
      ('f0500000-0000-4000-8000-0000000000b3', 'f0500000-0000-4000-8000-0000000000b1', 'f0500000-0000-4000-8000-000000000006', 'kid'),
      ('f0500000-0000-4000-8000-0000000000c2', 'f0500000-0000-4000-8000-0000000000c1', 'f0500000-0000-4000-8000-000000000007', 'parent'),
      ('f0500000-0000-4000-8000-0000000000c3', 'f0500000-0000-4000-8000-0000000000c1', 'f0500000-0000-4000-8000-000000000008', 'kid');
    insert into public.member_permissions (member_id, module, level) values
      ('f0500000-0000-4000-8000-0000000000a4', 'expenses', 'edit'),
      ('f0500000-0000-4000-8000-0000000000c3', 'expenses', 'edit')
  $sql$)
$$, 'a family and its creator''s parent membership can be inserted in one transaction');

-- 1. A membership never moves.
select throws_ok($$
  update public.family_members set family_id = 'f0500000-0000-4000-8000-0000000000b1'
  where id = 'f0500000-0000-4000-8000-0000000000a5'
$$, '23514', null, 'a membership cannot move to another family');
select throws_ok($$
  update public.family_members set user_id = 'f0500000-0000-4000-8000-000000000009'
  where id = 'f0500000-0000-4000-8000-0000000000a5'
$$, '23514', null, 'a membership cannot move to another user');
select lives_ok($$
  update public.family_members
  set family_id = family_id, user_id = user_id, last_active_at = now()
  where id = 'f0500000-0000-4000-8000-0000000000a5'
$$, 'other columns of a membership can still change');

-- 2. The creator must be a parent in the family (deferred).
select throws_ok($$
  select pg_temp.run_and_check($sql$
    insert into public.families (name, creator_id) values ('No members', 'f0500000-0000-4000-8000-000000000009')
  $sql$)
$$, '23514', null, 'a family whose creator has no membership is refused at commit');
select throws_ok($$
  select pg_temp.run_and_check($sql$
    insert into public.families (id, name, creator_id)
    values ('f0500000-0000-4000-8000-0000000000d1', 'Kid creator', 'f0500000-0000-4000-8000-000000000009');
    insert into public.family_members (family_id, user_id, role)
    values ('f0500000-0000-4000-8000-0000000000d1', 'f0500000-0000-4000-8000-000000000009', 'kid')
  $sql$)
$$, '23514', null, 'a family whose creator is a kid in it is refused at commit');
select throws_ok($$
  select pg_temp.run_and_check($sql$
    insert into public.families (name, creator_id) values ('Someone else''s', 'f0500000-0000-4000-8000-000000000006')
  $sql$)
$$, '23514', null, 'a family whose creator is a member of another family is refused at commit');
select lives_ok($$
  select pg_temp.run_and_check($sql$
    insert into public.families (id, name, creator_id)
    values ('f0500000-0000-4000-8000-0000000000e1', 'Short-lived', 'f0500000-0000-4000-8000-000000000010');
    delete from public.families where id = 'f0500000-0000-4000-8000-0000000000e1'
  $sql$)
$$, 'a family deleted before commit is not checked');
select throws_ok($$
  select pg_temp.run_and_check($sql$
    update public.families set creator_id = 'f0500000-0000-4000-8000-000000000006'
    where id = 'f0500000-0000-4000-8000-0000000000b1'
  $sql$)
$$, '23514', null, 'the creator cannot be handed to a kid');
select throws_ok($$
  select pg_temp.run_and_check($sql$
    update public.families set creator_id = 'f0500000-0000-4000-8000-000000000002'
    where id = 'f0500000-0000-4000-8000-0000000000b1'
  $sql$)
$$, '23514', null, 'the creator cannot be handed to a parent of another family');
select lives_ok($$
  select pg_temp.run_and_check($sql$
    update public.families set creator_id = 'f0500000-0000-4000-8000-000000000002'
    where id = 'f0500000-0000-4000-8000-0000000000a1';
    update public.families set creator_id = 'f0500000-0000-4000-8000-000000000001'
    where id = 'f0500000-0000-4000-8000-0000000000a1'
  $sql$)
$$, 'the creator can be handed to another parent of the family');

-- 3. The creator's membership can't be deleted or demoted.
select throws_ok($$
  delete from public.family_members where id = 'f0500000-0000-4000-8000-0000000000a2'
$$, '23514', null, 'the creator''s membership cannot be deleted');
select throws_ok($$
  update public.family_members set role = 'kid' where id = 'f0500000-0000-4000-8000-0000000000a2'
$$, '23514', null, 'the creator cannot be demoted to kid');
select throws_ok($$
  delete from public.family_members where family_id = 'f0500000-0000-4000-8000-0000000000a1'
$$, '23514', null, 'deleting every membership of a family is refused while the family exists');
select is(
  (select count(*)::integer from public.family_members where family_id = 'f0500000-0000-4000-8000-0000000000a1'),
  4,
  'a refused delete leaves every membership in place'
);
select throws_ok($$
  delete from auth.users where id = 'f0500000-0000-4000-8000-000000000001'
$$, '23503', null, 'deleting the creator''s user is still refused by the families foreign key');
select lives_ok($$
  select pg_temp.run_and_check($sql$
    update public.family_members set role = 'kid' where id = 'f0500000-0000-4000-8000-0000000000a3';
    update public.family_members set role = 'parent' where id = 'f0500000-0000-4000-8000-0000000000a3'
  $sql$)
$$, 'a parent who is not the creator can be demoted and promoted');
select lives_ok($$
  select pg_temp.run_and_check($sql$
    delete from public.family_members where id = 'f0500000-0000-4000-8000-0000000000a3'
  $sql$)
$$, 'a parent who is not the creator can be removed');
select lives_ok($$
  select pg_temp.run_and_check($sql$
    delete from auth.users where id = 'f0500000-0000-4000-8000-000000000004'
  $sql$)
$$, 'deleting a kid''s user still removes their membership');

-- 4. Permission rows only for kids.
select throws_ok($$
  insert into public.member_permissions (member_id, module, level)
  values ('f0500000-0000-4000-8000-0000000000a2', 'expenses', 'edit')
$$, '23514', null, 'a parent cannot get permission rows');
select throws_ok($$
  update public.member_permissions set member_id = 'f0500000-0000-4000-8000-0000000000b2'
  where member_id = 'f0500000-0000-4000-8000-0000000000a4'
$$, '23514', null, 'a permission row cannot be moved onto a parent');
select throws_ok($$
  insert into public.member_permissions (member_id, module, level)
  values ('f0500000-0000-4000-8000-0000000000ff', 'expenses', 'edit')
$$, '23503', null, 'a permission row for an unknown member is still refused by the foreign key');
select lives_ok($$
  insert into public.member_permissions (member_id, module, level)
  values ('f0500000-0000-4000-8000-0000000000b3', 'investments', 'off')
$$, 'a kid can get permission rows');
select lives_ok($$
  update public.member_permissions set level = 'off'
  where member_id = 'f0500000-0000-4000-8000-0000000000a4' and module = 'expenses'
$$, 'a kid''s permission level can change');
select throws_ok($$
  update public.family_members set role = 'parent' where id = 'f0500000-0000-4000-8000-0000000000a4'
$$, '23514', null, 'a kid with permission rows cannot become a parent');
select lives_ok($$
  delete from public.member_permissions where member_id = 'f0500000-0000-4000-8000-0000000000a4';
  update public.family_members set role = 'parent' where id = 'f0500000-0000-4000-8000-0000000000a4'
$$, 'a kid without permission rows can become a parent');

-- Deleting the whole family still works, creator included.
select lives_ok($$
  select pg_temp.run_and_check($sql$
    delete from public.families where id = 'f0500000-0000-4000-8000-0000000000c1'
  $sql$)
$$, 'the whole family can be deleted, creator''s membership included');
select is(
  (select count(*)::integer from public.family_members where family_id = 'f0500000-0000-4000-8000-0000000000c1'),
  0,
  'deleting the family removed every membership'
);
select is(
  (select count(*)::integer from public.member_permissions where member_id = 'f0500000-0000-4000-8000-0000000000c3'),
  0,
  'deleting the family removed its kids'' permissions'
);
select lives_ok($$
  delete from auth.users where id = 'f0500000-0000-4000-8000-000000000007'
$$, 'the former creator''s user can be deleted once the family is gone');
select is(
  (select count(*)::integer from public.family_members where family_id = 'f0500000-0000-4000-8000-0000000000b1'),
  2,
  'other families are untouched'
);
select lives_ok($$
  select pg_temp.run_and_check('select 1')
$$, 'every family left still passes the creator check');

select * from finish();
rollback;
