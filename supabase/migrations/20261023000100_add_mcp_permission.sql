begin;

-- The `mcp` kid permission (docs/mcp-access-plan.md, M1): whether a kid may
-- connect AI assistants to their account. Levels: off (the default) and edit,
-- shown as "On". M2's access check reads it; nothing else changes here.
--
-- Three places list the permission catalogue and must change together with
-- MODULE_KEYS and MODULE_LEVELS in src/lib/permissions.ts:
-- 1. the member_permissions_level_allowed check (F03),
-- 2. family_private.module_keys() (F06),
-- 3. family_private.is_valid_permissions(jsonb) (F07).
-- Each is redefined below exactly as before, with mcp added.
--
-- Existing kids need no rows: a module without a row counts as off.

alter table public.member_permissions
  drop constraint member_permissions_level_allowed;

-- Must allow exactly the (module, level) pairs in MODULE_LEVELS in
-- src/lib/permissions.ts. Change both together.
alter table public.member_permissions
  add constraint member_permissions_level_allowed check (
    (module, level) in (
      ('expenses', 'off'),
      ('expenses', 'edit'),
      ('investments', 'off'),
      ('investments', 'edit'),
      ('net_worth', 'off'),
      ('net_worth', 'edit'),
      ('family_finance', 'off'),
      ('family_finance', 'view'),
      ('mcp', 'off'),
      ('mcp', 'edit')
    )
  );

-- The module keys of the permission catalogue, in catalogue order. Must match
-- MODULE_KEYS in src/lib/permissions.ts and the member_permissions_level_allowed
-- check from F03. Change all three together.
create or replace function family_private.module_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['expenses', 'investments', 'net_worth', 'family_finance', 'mcp']
$$;

-- Whether p_permissions is a complete permissions object from the catalogue:
-- a JSON object with exactly the keys of family_private.module_keys(), each a
-- string level that module allows. False for null and for anything that isn't
-- an object.
--
-- The (module, level) pairs must match MODULE_LEVELS in src/lib/permissions.ts
-- and the member_permissions_level_allowed check from F03, which stays the
-- backstop. Change all three together.
create or replace function family_private.is_valid_permissions(p_permissions jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then
    return false;
  end if;

  return (
    select coalesce(array_agg(k.key order by k.key), '{}')
    from jsonb_object_keys(p_permissions) as k(key)
  ) = (
    select array_agg(k.module order by k.module)
    from unnest(family_private.module_keys()) as k(module)
  )
  and not exists (
    select 1
    from jsonb_each(p_permissions) as e(module, level)
    where jsonb_typeof(e.level) <> 'string'
      or (e.module, e.level #>> '{}') not in (
        ('expenses', 'off'),
        ('expenses', 'edit'),
        ('investments', 'off'),
        ('investments', 'edit'),
        ('net_worth', 'off'),
        ('net_worth', 'edit'),
        ('family_finance', 'off'),
        ('family_finance', 'view'),
        ('mcp', 'off'),
        ('mcp', 'edit')
      )
  );
end;
$$;

-- Kid invites store a full catalogue object, and redemption refuses one that
-- isn't, so pending invites created before this migration get mcp off.
update public.family_invites
set permissions = permissions || '{"mcp": "off"}'::jsonb
where role = 'kid' and not permissions ? 'mcp';

commit;
