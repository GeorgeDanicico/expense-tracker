begin;

-- Profile pictures (docs/avatars-plan.md, A1).
--
-- profiles.avatar_path is the key of the member's picture in the private
-- `avatars` bucket: '<user id>/<uuid v4>.webp'. Only the server writes it (the
-- secret key), right after it uploads the re-encoded image; the API roles can't.
-- Only the server writes objects too: there is no insert, update or delete
-- policy on the bucket. Signed-in users may read their own pictures and those
-- of their family; the API reads them as the caller, so this policy decides.

alter table public.profiles
  add column avatar_path text,
  add constraint profiles_avatar_path_format check (
    avatar_path ~ (
      '^' || id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
    )
  );

comment on column public.profiles.avatar_path is
  'Key of the profile picture in the avatars bucket (<id>/<uuid>.webp), or null. Set only by the server.';

-- Same pattern as guard_profile_username (20261015182916): refuse the API roles,
-- let trusted writers (the service role, migrations, security definer
-- functions) through. Must stay security invoker: current_user is what tells
-- them apart.
create function public.guard_profile_avatar_path()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
    and new.avatar_path is distinct from (
      case when tg_op = 'UPDATE' then old.avatar_path else null end
    )
  then
    raise exception 'Profile pictures can only be set by the server.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_profile_avatar_path() from public, anon, authenticated;

create trigger profiles_guard_avatar_path
before insert or update of avatar_path on public.profiles
for each row execute function public.guard_profile_avatar_path();

-- The bucket. Private: objects are reachable only through policies or the
-- secret key. The size and type limits are a second line behind the server's
-- own checks; older storage schemas (the SQL test image) lack those columns.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    update storage.buckets
    set file_size_limit = 262144, allowed_mime_types = array['image/webp']
    where id = 'avatars';
  end if;
end;
$$;

-- The user ids (as text, matching storage.foldername()) whose pictures the
-- caller may see: their own, and everyone in their family. Text, not uuid, so a
-- malformed object name can never make the policy throw.
create function family_private.visible_avatar_owner_ids()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct owner_id::text), '{}')
  from (
    select app_private.current_user_id() as owner_id
    union
    select m.user_id
    from public.family_members m
    where m.family_id = family_private.my_family_id()
  ) owners
  where owner_id is not null
$$;

revoke all on function family_private.visible_avatar_owner_ids() from public, anon;
grant execute on function family_private.visible_avatar_owner_ids() to authenticated;

comment on function family_private.visible_avatar_owner_ids() is
  'User ids (text) whose avatars the caller may read: the caller and their family''s members.';

-- Read only. The (select ...) wrapper makes Postgres run the function once per
-- statement instead of once per row. The ::text[] cast matters: without it,
-- `= any ((select ...))` is read as ANY (subquery) and compares text to text[].
create policy avatars_select_self_or_family on storage.objects
for select to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = any ((select family_private.visible_avatar_owner_ids())::text[])
);

-- get_family(): identical to 20261016001100 plus each member's avatarPath.
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
          'avatarPath', p.avatar_path,
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

revoke all on function public.get_family() from public, anon;
grant execute on function public.get_family() to authenticated;

comment on function public.get_family() is
  'The caller''s family and members as camelCase JSON, or null without a family. Every member entry has its currency (EUR without a profile row), its chosen color (null for automatic) and its avatarPath (null without a picture). lastActiveAt and permissions appear for every member to parents, and only on their own entry to kids.';

commit;
