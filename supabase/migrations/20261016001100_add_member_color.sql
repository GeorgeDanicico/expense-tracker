begin;

-- Parents choose member colours (docs/bug-fixes-plan.md, 6d).
--
-- family_members.color is the palette slot (1..8, matching MEMBER_COLORS in
-- src/components/ui/theme/member-tokens.ts) a parent picked for a member, or
-- null for "automatic": the app gives automatic members the lowest slots nobody
-- picked. A slot can be used once per family.
--
-- set_member_color(p_member_id, p_color) lets a parent set or (with null) reset
-- any member's colour in their own family, and get_family() sends each member's
-- colour. Same conventions as 20261016000300_add_member_update_functions.sql.

alter table public.family_members
  add column color smallint,
  add constraint family_members_color_in_palette check (color between 1 and 8);

create unique index family_members_family_color_key
  on public.family_members (family_id, color)
  where color is not null;

comment on column public.family_members.color is
  'Palette slot 1..8 a parent chose for this member, unique within the family. Null means automatic.';

-- Errors, checked in this order:
-- * 42501 when the caller isn't a parent (a kid, or no family), before looking
--   at the target, so a kid learns nothing about member ids.
-- * P0002 when the member doesn't exist or is in another family (same error, so
--   a parent can't probe other families).
-- * 23514 when p_color is outside 1..8.
-- * 23505 when another member of the family already has that colour.
create function public.set_member_color(p_member_id uuid, p_color smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_family_id uuid;
begin
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = app_private.current_user_id()
    and m.role = 'parent';

  if not found then
    raise exception 'Only parents can choose member colours.'
      using errcode = '42501';
  end if;

  perform 1
  from public.family_members m
  where m.id = p_member_id
    and m.family_id = caller_family_id
  for no key update;

  if not found then
    raise exception 'That family member wasn''t found.'
      using errcode = 'P0002';
  end if;

  if p_color is not null and p_color not between 1 and 8 then
    raise exception 'Choose one of the eight colours.'
      using errcode = '23514';
  end if;

  begin
    update public.family_members m
    set color = p_color
    where m.id = p_member_id;
  exception when unique_violation then
    raise exception 'Another family member already has that colour.'
      using errcode = '23505';
  end;
end;
$$;

revoke all on function public.set_member_color(uuid, smallint) from public, anon;
grant execute on function public.set_member_color(uuid, smallint) to authenticated;

comment on function public.set_member_color(uuid, smallint) is
  'A parent sets a member''s palette colour (1..8), or null for automatic, in their own family. 42501 for a non-parent caller, P0002 for an unknown or other-family member, 23514 for a colour outside 1..8, 23505 when another member has that colour.';

-- get_family(): identical to 20261016001000 plus each member's color.
create or replace function public.get_family()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'family', jsonb_build_object(
      'id', f.id,
      'name', f.name,
      'createdAt', f.created_at
    ),
    'members', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'memberId', m.id,
          'userId', m.user_id,
          'role', m.role,
          'isCreator', m.user_id = f.creator_id,
          'displayName', coalesce(
            p.display_name,
            p.username,
            nullif(split_part(u.email, '@', 1), '')
          ),
          'username', p.username,
          'currency', coalesce(p.currency, 'EUR'),
          'color', m.color,
          'joinedAt', m.joined_at
        )
        || case
          when caller.role = 'parent' or m.id = caller.id then jsonb_build_object(
            'lastActiveAt', m.last_active_at,
            'permissions', family_private.member_permissions_json(m.id)
          )
          else '{}'::jsonb
        end
        order by m.user_id = f.creator_id desc, m.role = 'parent' desc, m.joined_at, m.id
      ), '[]'::jsonb)
      from public.family_members m
      left join public.profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.family_id = f.id
    )
  )
  from public.family_members caller
  join public.families f on f.id = caller.family_id
  where caller.user_id = app_private.current_user_id()
$$;

-- create or replace keeps the owner and the grants, but say them again so this
-- file shows the access on its own.
revoke all on function public.get_family() from public, anon;
grant execute on function public.get_family() to authenticated;

comment on function public.get_family() is
  'The caller''s family and members as camelCase JSON, or null without a family. Every member entry has its currency (EUR without a profile row) and its chosen color (null for automatic). lastActiveAt and permissions appear for every member to parents, and only on their own entry to kids.';

commit;
