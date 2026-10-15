begin;

-- Phase 1 (F11): one-off notices shown to a user after something happened to
-- their account, such as their family being deleted or their removal from it.
-- Users can read their own notices and dismiss them through dismiss_notice().
-- Nobody writes them directly: only the F12 functions insert notices.

create table public.account_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  family_name text not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  constraint account_notices_kind_valid check (kind in ('family_deleted', 'removed_from_family'))
);

-- Serves the owner policy, the user_id cascade and get_my_notices() (oldest first).
create index account_notices_user_id_created_at_idx
  on public.account_notices (user_id, created_at);

alter table public.account_notices enable row level security;

revoke all on table public.account_notices from public, anon, authenticated;
grant select on table public.account_notices to authenticated;

create policy account_notices_select_own
on public.account_notices for select to authenticated
using (user_id = (select app_private.current_user_id()));

comment on table public.account_notices is
  'A notice for one user, shown once until dismissed. Written only by the family removal functions (F12).';
comment on column public.account_notices.family_name is
  'The family''s name when the notice was written; the family itself may be gone.';
comment on column public.account_notices.seen_at is
  'When the user dismissed the notice; null while it is still unseen.';

-- The caller's unseen notices, oldest first.
create function public.get_my_notices()
returns table (
  id uuid,
  kind text,
  family_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.kind, n.family_name, n.created_at
  from public.account_notices n
  where n.user_id = (select app_private.current_user_id())
    and n.seen_at is null
  order by n.created_at, n.id
$$;

-- Marks one of the caller's notices as seen. Dismissing it again keeps the
-- first seen_at. Another user's notice and an unknown id both raise P0002, so
-- this can't be used to probe which ids exist.
create function public.dismiss_notice(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_notices n
  set seen_at = coalesce(n.seen_at, now())
  where n.id = p_notice_id
    and n.user_id = (select app_private.current_user_id());

  if not found then
    raise exception 'Notice not found.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.get_my_notices() from public, anon;
revoke all on function public.dismiss_notice(uuid) from public, anon;
grant execute on function public.get_my_notices() to authenticated;
grant execute on function public.dismiss_notice(uuid) to authenticated;

comment on function public.get_my_notices() is
  'The caller''s unseen account notices, oldest first.';
comment on function public.dismiss_notice(uuid) is
  'Marks one of the caller''s notices as seen. Raises P0002 for an unknown id or another user''s notice.';

commit;
