begin;

-- F49: every member's currency in get_family().
--
-- profiles' policies let each user read only their own row, so a parent viewing a
-- kid could not see the kid's currency. get_family() is security definer, so it
-- adds currency to every member entry for everyone in the family; the profiles
-- policies stay as they are. A member without a profile row gets the app default
-- (EUR), as AccountRepository.getCurrency does. Nothing else in the result changes.

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
  'The caller''s family and members as camelCase JSON, or null without a family. Every member entry has its currency (EUR without a profile row). lastActiveAt and permissions appear for every member to parents, and only on their own entry to kids.';

commit;
