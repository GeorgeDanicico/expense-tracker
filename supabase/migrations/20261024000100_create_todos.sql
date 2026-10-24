begin;

-- The family to-do board (docs/todo-board-plan.md, T1).
--
-- 1. public.todos: one row per card. Every family has exactly one board, so a
--    card belongs to a family directly; there is no board table.
-- 2. RLS: every member of the family, parent or kid, sees and changes every
--    card of their family. That is the only rule; there are no role checks.
-- 3. todos_guard: bookkeeping that every write path agrees on (the assignee
--    is in the card's family, family_id and created_by stay put, updated_at,
--    completed_at and completed_by).
--
-- Same conventions as the family tables: the caller is
-- app_private.current_user_id(), policies wrap helpers in a sub-select so
-- they run once per query, set search_path = '' and fully qualified names.

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  -- "C" so Postgres sorts fractional-index keys byte by byte, the order the
  -- fractional-indexing library assumes.
  position text not null collate "C",
  assignee_member_id uuid references public.family_members(id) on delete set null,
  due_date date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  unique (family_id, status, position)
);

-- The unique constraint already indexes (family_id, status, position), which
-- serves the board query and the family cascade. These two serve the member
-- cascade (and the assignee filter) and the Done column's 30-day window.
create index todos_assignee_member_id_idx on public.todos (assignee_member_id);
create index todos_family_id_completed_at_idx on public.todos (family_id, completed_at);

comment on table public.todos is
  'Cards on the family to-do board. Every member of the family may read and change every card of their family.';
comment on column public.todos.position is
  'Fractional-index key ordering the card within its status column (collate "C"). Computed by the server from the card''s neighbours.';
comment on column public.todos.assignee_member_id is
  'The family member the card is assigned to, or null. Must be a member of the card''s family; cleared when that member leaves.';
comment on column public.todos.due_date is
  'Optional due date, a plain date in Europe/Bucharest.';
comment on column public.todos.created_by is
  'The user who added the card; null once that user is deleted. Never changes otherwise.';
comment on column public.todos.completed_at is
  'When the card entered Done; null while it isn''t in Done. Set by todos_guard.';
comment on column public.todos.completed_by is
  'Who moved the card into Done; null while it isn''t in Done. Set by todos_guard.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.todos enable row level security;

revoke all on table public.todos from public, anon, authenticated;
grant select, insert, update, delete on table public.todos to authenticated;

create policy todos_select_family on public.todos
for select to authenticated
using (family_id = (select family_private.my_family_id()));

create policy todos_insert_family on public.todos
for insert to authenticated
with check (
  family_id = (select family_private.my_family_id())
  and created_by = (select app_private.current_user_id())
);

create policy todos_update_family on public.todos
for update to authenticated
using (family_id = (select family_private.my_family_id()))
with check (family_id = (select family_private.my_family_id()));

create policy todos_delete_family on public.todos
for delete to authenticated
using (family_id = (select family_private.my_family_id()));

-- ---------------------------------------------------------------------------
-- Bookkeeping trigger
-- ---------------------------------------------------------------------------

-- Security invoker, for two reasons:
-- * The assignee check reads family_members under the caller's own policy,
--   which shows only the caller's family, so it can't be used to probe other
--   families' member ids.
-- * current_user tells the API roles apart from trusted writers (as in
--   guard_profile_avatar_path, 20261018000100). Foreign key actions run as the
--   table owner, so when a user is deleted, `on delete set null` may clear
--   created_by and completed_by; the API roles may not change either.
--
-- On every write:
-- * a non-null assignee must be a member of the card's family (23514);
-- * the card enters Done: completed_at = now(), completed_by = the caller;
--   it isn't in Done: both null; it stays in Done: the API roles keep the
--   stored values.
-- On update also: family_id never changes, created_by never changes for the
-- API roles (42501), and updated_at = now().
create function public.todos_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  api_role boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'UPDATE' then
    if new.family_id is distinct from old.family_id then
      raise exception 'A to-do can''t move to another family.'
        using errcode = '42501';
    end if;

    if api_role and new.created_by is distinct from old.created_by then
      raise exception 'A to-do''s creator can''t be changed.'
        using errcode = '42501';
    end if;

    new.updated_at := now();
  end if;

  if new.assignee_member_id is not null
    and (tg_op = 'INSERT' or new.assignee_member_id is distinct from old.assignee_member_id)
    and not exists (
      select 1
      from public.family_members m
      where m.id = new.assignee_member_id
        and m.family_id = new.family_id
    )
  then
    raise exception 'A to-do can only be assigned to a member of its family.'
      using errcode = '23514';
  end if;

  if new.status <> 'done' then
    new.completed_at := null;
    new.completed_by := null;
  elsif tg_op = 'INSERT' or old.status <> 'done' then
    new.completed_at := now();
    new.completed_by := app_private.current_user_id();
  elsif api_role then
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  end if;

  return new;
end;
$$;

revoke all on function public.todos_guard() from public, anon, authenticated;

comment on function public.todos_guard() is
  'Trigger: the assignee must be in the card''s family (23514); family_id never changes and created_by never changes for the API roles (42501); sets updated_at, and completed_at/completed_by when status enters or leaves done.';

create trigger todos_guard
before insert or update on public.todos
for each row execute function public.todos_guard();

commit;
