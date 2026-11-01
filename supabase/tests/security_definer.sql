begin;
create extension if not exists pgtap;
select plan(17);

-- S9 (docs/security-plan.md): the `security definer` review and the user-facing error marker.
--
-- The catalogue checks walk every function in our schemas (public, app_private, family_private,
-- and the other private ones: mcp_private, ai_private, expense_classification_private), so a new
-- function that breaks a rule fails here without anyone listing it:
--   - every `security definer` function sets `search_path = ''`;
--   - `anon` can execute none of them, except the ones on the allowlist below;
--   - no trigger function can be called directly by `public`, `anon` or `authenticated`;
--   - every `raise exception` carries the user-facing marker (`hint = 'user'`), except the ones
--     on the internal allowlist below.
-- Then a few real errors show what the app's translator (src/lib/supabase/errors.ts) sees: our
-- own raise carries the marker, Postgres' own RLS, check and unique errors never do.
--
-- Users (prefix e9000000): 01 and 02 have no family at first.

create function pg_temp.ours()
returns table (oid oid, name text, secdef boolean, is_trigger boolean, src text, config text[])
language sql
stable
as $$
  select p.oid,
    n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
    p.prosecdef,
    p.prorettype = 'trigger'::regtype,
    p.prosrc,
    p.proconfig
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private', 'family_private', 'mcp_private', 'ai_private',
      'expense_classification_private')
    and p.prokind = 'f'
    -- Not an extension's own functions (pgTAP installs into public).
    and not exists (
      select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
$$;

-- The `security definer` functions `anon` may call, each with the reason.
create function pg_temp.anon_allowlist()
returns text[]
language sql
immutable
as $$
  select array[
    -- GET /api/calendar/feed/[token]: a calendar app fetches the feed with no session, as `anon`;
    -- the token's hash is the only credential, and it returns only that token owner's events.
    'public.calendar_feed(p_token_hash text)'
  ]
$$;

-- Functions whose raises are not for users, each with the reason.
create function pg_temp.internal_raises()
returns text[]
language sql
immutable
as $$
  select array[
    -- "Unknown module: %" is a programming error, and it quotes its argument.
    'family_private.member_level(module text)',
    -- One-off maintenance functions (the merchant correction); their raises are invariant failures.
    'expense_classification_private.correct_historical_merchants()',
    'expense_classification_private.restore_historical_merchants()'
  ]
$$;

-- The SQLSTATE and hint of the error `p_sql` raises, as 'XXXXX hint:…' ('none' without a hint).
create function pg_temp.raised(p_sql text)
returns text
language plpgsql
as $$
declare
  v_state text;
  v_hint text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return v_state || ' hint:' || coalesce(nullif(v_hint, ''), 'none');
end;
$$;

create function pg_temp.act_as(p_user uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select null::void;
$$;

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------

select cmp_ok(
  (select count(*)::integer from pg_temp.ours() f where f.secdef),
  '>=', 30,
  'the review sees our security definer functions'
);

select is(
  (select coalesce(array_agg(f.name order by f.name), '{}') from pg_temp.ours() f
   where f.secdef and not coalesce('search_path=""' = any (f.config), false)),
  '{}'::text[],
  'every security definer function sets search_path to the empty string'
);

select is(
  (select coalesce(array_agg(f.name order by f.name), '{}') from pg_temp.ours() f
   where f.secdef and pg_catalog.has_function_privilege('anon', f.oid, 'execute')
     and not f.name = any (pg_temp.anon_allowlist())),
  '{}'::text[],
  'anon can execute no security definer function outside the allowlist'
);

select is(
  (select coalesce(array_agg(a.name order by a.name), '{}')
   from unnest(pg_temp.anon_allowlist()) a(name)
   where not exists (select 1 from pg_temp.ours() f where f.name = a.name and f.secdef)),
  '{}'::text[],
  'every allowlisted function exists and is security definer'
);

select ok(
  pg_catalog.has_function_privilege('anon', 'public.calendar_feed(text)', 'execute'),
  'anon can still read a calendar feed'
);

select is(
  (select coalesce(array_agg(f.name order by f.name), '{}') from pg_temp.ours() f
   where f.is_trigger and exists (
     select 1 from pg_catalog.pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
     where p.oid = f.oid and acl.grantee = 0 and acl.privilege_type = 'EXECUTE')),
  '{}'::text[],
  'no trigger function is executable by public'
);

select is(
  (select coalesce(array_agg(f.name order by f.name), '{}') from pg_temp.ours() f
   where f.is_trigger and (pg_catalog.has_function_privilege('anon', f.oid, 'execute')
     or pg_catalog.has_function_privilege('authenticated', f.oid, 'execute'))),
  '{}'::text[],
  'no trigger function is executable by anon or authenticated'
);

select cmp_ok(
  (select count(*)::integer from pg_temp.ours() f where f.src ~* 'raise\s+exception'),
  '>=', 40,
  'the marker check sees our raising functions'
);

select is(
  (select coalesce(array_agg(f.name order by f.name), '{}') from pg_temp.ours() f
   where not f.name = any (pg_temp.internal_raises())
     and (select count(*) from regexp_matches(f.src, 'raise\s+exception', 'gi'))
       <> (select count(*) from regexp_matches(f.src, 'raise\s+exception\s+''(?:[^'']|'''')*''[^;]*hint\s*=\s*''user''', 'gi'))),
  '{}'::text[],
  'every raise exception outside the internal allowlist is marked hint = ''user'''
);

select is(
  (select coalesce(array_agg(f.name order by f.name), '{}') from pg_temp.ours() f
   where f.name = any (pg_temp.internal_raises()) and f.src ~* 'hint\s*=\s*''user'''),
  '{}'::text[],
  'the internal raises stay unmarked'
);

-- ---------------------------------------------------------------------------
-- What the translator sees
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('e9000000-0000-4000-8000-000000000001', 's9-one@example.test', 'not-used', now(), '{}', '{}', now(), now()),
  ('e9000000-0000-4000-8000-000000000002', 's9-two@example.test', 'not-used', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id)
select u.id from auth.users u where u.id::text like 'e9000000-%'
on conflict (id) do nothing;

insert into public.reminders (id, user_id, title, starts_on) values
  ('e9000000-0000-4000-8000-0000000000a1', 'e9000000-0000-4000-8000-000000000001', 'Water plants', '2026-11-01');
insert into public.reminder_completions (reminder_id, occurrence_on) values
  ('e9000000-0000-4000-8000-0000000000a1', '2026-11-01');

set local role authenticated;
select pg_temp.act_as('e9000000-0000-4000-8000-000000000001');

select is(
  pg_temp.raised($q$select public.create_family('S9 family')$q$),
  'no error',
  'a user without a family creates one'
);
select is(
  pg_temp.raised($q$select public.create_family('Another family')$q$),
  '23505 hint:user',
  'our own "already in a family" is a unique violation marked for users'
);
select is(
  pg_temp.raised($q$select public.remove_family_member('e9000000-0000-4000-8000-0000000000ff')$q$),
  'P0002 hint:user',
  'our own "member not found" is marked for users'
);
select is(
  pg_temp.raised($q$insert into public.reminders (user_id, title, starts_on, lead_minutes)
    values ('e9000000-0000-4000-8000-000000000001', 'Same lead twice', '2026-11-01', '{60, 60}')$q$),
  '23514 hint:user',
  'a trigger guard''s message is marked for users'
);
select is(
  pg_temp.raised($q$insert into public.reminders (user_id, title, starts_on)
    values ('e9000000-0000-4000-8000-000000000002', 'For someone else', '2026-11-01')$q$),
  '42501 hint:none',
  'a row-level security violation carries no marker'
);
select is(
  pg_temp.raised($q$insert into public.reminders (user_id, title, starts_on, repeat_unit, repeat_interval)
    values ('e9000000-0000-4000-8000-000000000001', 'Too sparse', '2026-11-01', 'month', 13)$q$),
  '23514 hint:none',
  'a check constraint violation carries no marker'
);
select is(
  pg_temp.raised($q$insert into public.reminder_completions (reminder_id, occurrence_on)
    values ('e9000000-0000-4000-8000-0000000000a1', '2026-11-01')$q$),
  '23505 hint:none',
  'a unique constraint violation carries no marker'
);

select * from finish();
rollback;
