begin;

-- Private reminders and the notification outbox (docs/reminders-plan.md, R1).
--
-- 1. public.reminders and public.reminder_completions: a user's own
--    reminders. Only the owner ever sees them, parents included.
-- 2. public.notification_settings and public.push_subscriptions: the owner's
--    switches and Web Push devices.
-- 3. public.notifications (the outbox) and public.worker_heartbeats: RLS on
--    with no policies, so only the worker (secret key) reads and writes them.
--    Users reach the outbox only through send_test_notification() and the
--    todos_notify_assignee trigger.
-- 4. claim_notifications() and claim_due_reminders(): the worker's claim
--    functions (FOR UPDATE SKIP LOCKED with a 2-minute lease), service_role
--    only.
--
-- Same conventions as the family and to-do tables: the caller is
-- app_private.current_user_id(), policies wrap helpers in a sub-select so
-- they run once per query, set search_path = '' and fully qualified names.

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  starts_on date not null,
  time_of_day time not null default '09:00',
  timezone text not null default 'Europe/Bucharest',
  repeat_unit text not null default 'none' check (repeat_unit in ('none', 'week', 'month', 'year')),
  repeat_interval smallint not null default 1 check (repeat_interval between 1 and 12),
  -- At most three of the presets in LEAD_TIME_PRESETS (src/lib/reminders/types.ts):
  -- at the time, 1 hour, 1 day, 3 days and 1 week before. Change both together.
  -- reminders_guard also refuses duplicates.
  lead_minutes integer[] not null default '{0}' check (
    cardinality(lead_minutes) <= 3
    and lead_minutes <@ '{0, 60, 1440, 4320, 10080}'::integer[]
  ),
  notifications_muted boolean not null default false,
  next_due_on date,
  next_due_at timestamptz,
  snoozed_until timestamptz,
  next_notify_at timestamptz,
  notify_locked_until timestamptz,
  expense_template jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Serves the owner's list (ordered by due time), the summary and the user
-- cascade.
create index reminders_user_id_next_due_at_idx on public.reminders (user_id, next_due_at);
-- Serves claim_due_reminders().
create index reminders_next_notify_at_idx on public.reminders (next_notify_at)
  where next_notify_at is not null and not notifications_muted;

comment on table public.reminders is
  'A user''s private reminders. Only the owner may read or change them; nobody else, parents included.';
comment on column public.reminders.starts_on is
  'The first occurrence. Every later occurrence is counted from this date (src/lib/reminders/schedule.ts).';
comment on column public.reminders.time_of_day is
  'Local wall-clock time of each occurrence, in timezone.';
comment on column public.reminders.timezone is
  'IANA time zone of starts_on and time_of_day. Only Europe/Bucharest is offered for now.';
comment on column public.reminders.repeat_unit is
  'none (a one-off), week, month or year. A month or year without the day uses its last day.';
comment on column public.reminders.repeat_interval is
  'Repeat every repeat_interval units (1-12). 1 for a one-off.';
comment on column public.reminders.lead_minutes is
  'When to notify, in minutes before each occurrence: up to three distinct presets (0, 60, 1440, 4320, 10080), subtracted in local wall-clock time.';
comment on column public.reminders.notifications_muted is
  'When true the reminder never notifies; it still shows as due and overdue.';
comment on column public.reminders.next_due_on is
  'The open occurrence''s date; null once a one-off reminder is done. Written by the server with schedule.ts.';
comment on column public.reminders.next_due_at is
  'next_due_on at time_of_day in timezone, as an instant; null when next_due_on is.';
comment on column public.reminders.snoozed_until is
  'While in the future the reminder leaves Overdue and notifies again at that time.';
comment on column public.reminders.next_notify_at is
  'The next time the worker notifies; null when nothing is left to notify for the open occurrence or the reminder is muted.';
comment on column public.reminders.notify_locked_until is
  'Lease set by claim_due_reminders(); another worker skips the reminder until then.';
comment on column public.reminders.expense_template is
  'Optional expense to log on mark done (reminders plan R12); null until then.';

create table public.reminder_completions (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  occurrence_on date not null,
  done_at timestamptz not null default now(),
  expense_id uuid references public.expenses(id) on delete set null,
  unique (reminder_id, occurrence_on)
);

-- The unique constraint serves the reminder cascade. This one serves the
-- expense cascade.
create index reminder_completions_expense_id_idx on public.reminder_completions (expense_id)
  where expense_id is not null;

comment on table public.reminder_completions is
  'One row per occurrence marked done. Readable and writable only by the reminder''s owner.';
comment on column public.reminder_completions.occurrence_on is
  'The date of the occurrence that was marked done.';
comment on column public.reminder_completions.expense_id is
  'The expense logged for this occurrence (R12), if any; must be the owner''s own. Cleared when the expense is deleted.';

alter table public.reminders enable row level security;
alter table public.reminder_completions enable row level security;

revoke all on table public.reminders, public.reminder_completions from public, anon, authenticated;
grant select, insert, update, delete on table public.reminders, public.reminder_completions
  to authenticated;

create policy reminders_select_own on public.reminders
for select to authenticated
using (user_id = (select app_private.current_user_id()));

create policy reminders_insert_own on public.reminders
for insert to authenticated
with check (user_id = (select app_private.current_user_id()));

create policy reminders_update_own on public.reminders
for update to authenticated
using (user_id = (select app_private.current_user_id()))
with check (user_id = (select app_private.current_user_id()));

create policy reminders_delete_own on public.reminders
for delete to authenticated
using (user_id = (select app_private.current_user_id()));

-- Through the parent reminder, which the caller's own reminders policy already
-- limits to the owner.
create policy reminder_completions_select_own on public.reminder_completions
for select to authenticated
using (exists (
  select 1 from public.reminders r
  where r.id = reminder_id
    and r.user_id = (select app_private.current_user_id())
));

create policy reminder_completions_insert_own on public.reminder_completions
for insert to authenticated
with check (
  exists (
    select 1 from public.reminders r
    where r.id = reminder_id
      and r.user_id = (select app_private.current_user_id())
  )
  and (
    expense_id is null
    or exists (
      select 1 from public.expenses e
      where e.id = expense_id
        and e.user_id = (select app_private.current_user_id())
    )
  )
);

create policy reminder_completions_update_own on public.reminder_completions
for update to authenticated
using (exists (
  select 1 from public.reminders r
  where r.id = reminder_id
    and r.user_id = (select app_private.current_user_id())
))
with check (
  exists (
    select 1 from public.reminders r
    where r.id = reminder_id
      and r.user_id = (select app_private.current_user_id())
  )
  and (
    expense_id is null
    or exists (
      select 1 from public.expenses e
      where e.id = expense_id
        and e.user_id = (select app_private.current_user_id())
    )
  )
);

create policy reminder_completions_delete_own on public.reminder_completions
for delete to authenticated
using (exists (
  select 1 from public.reminders r
  where r.id = reminder_id
    and r.user_id = (select app_private.current_user_id())
));

-- On every write: lead_minutes has no duplicates or nulls (23514). On update
-- also: user_id never changes (42501), and updated_at = now().
create function public.reminders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if array_position(new.lead_minutes, null) is not null
    or cardinality(new.lead_minutes) <> (
      select count(distinct m) from unnest(new.lead_minutes) as m
    )
  then
    raise exception 'A reminder''s lead times must be distinct.'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'A reminder can''t move to another user.'
        using errcode = '42501';
    end if;

    new.updated_at := now();
  end if;

  return new;
end;
$$;

revoke all on function public.reminders_guard() from public, anon, authenticated;

comment on function public.reminders_guard() is
  'Trigger: lead_minutes has no duplicates or nulls (23514); user_id never changes (42501); sets updated_at on update.';

create trigger reminders_guard
before insert or update on public.reminders
for each row execute function public.reminders_guard();

-- ---------------------------------------------------------------------------
-- Notification settings and push subscriptions
-- ---------------------------------------------------------------------------

create table public.notification_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  push_enabled boolean not null default true,
  reminders_enabled boolean not null default true,
  todos_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.notification_settings is
  'A user''s notification switches. A missing row means the defaults (everything on). Owner only.';
comment on column public.notification_settings.push_enabled is
  'The Browser notifications switch. Off: the worker marks the user''s rows skipped.';
comment on column public.notification_settings.reminders_enabled is
  'Whether reminder notifications are sent.';
comment on column public.notification_settings.todos_enabled is
  'Whether to-do notifications (todo_assigned, todo_due) are sent.';

alter table public.notification_settings enable row level security;

revoke all on table public.notification_settings from public, anon, authenticated;
grant select, insert, update on table public.notification_settings to authenticated;

create policy notification_settings_select_own on public.notification_settings
for select to authenticated
using (user_id = (select app_private.current_user_id()));

create policy notification_settings_insert_own on public.notification_settings
for insert to authenticated
with check (user_id = (select app_private.current_user_id()));

create policy notification_settings_update_own on public.notification_settings
for update to authenticated
using (user_id = (select app_private.current_user_id()))
with check (user_id = (select app_private.current_user_id()));

create trigger notification_settings_set_updated_at
before update on public.notification_settings
for each row execute function public.set_updated_at();

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%' and char_length(endpoint) <= 2048),
  p256dh text not null check (char_length(p256dh) between 1 and 200),
  auth text not null check (char_length(auth) between 1 and 100),
  user_agent text not null default '' check (char_length(user_agent) <= 500),
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);

-- Serves the owner policy, the user cascade and the worker's device lookup.
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

comment on table public.push_subscriptions is
  'Web Push subscriptions, one per browser. The owner reads and deletes their own; registration goes through register_push_subscription().';
comment on column public.push_subscriptions.endpoint is
  'The push service URL. Unique: a browser that switches accounts moves its subscription.';
comment on column public.push_subscriptions.p256dh is
  'The subscription''s public key (base64url), for payload encryption.';
comment on column public.push_subscriptions.auth is
  'The subscription''s auth secret (base64url), for payload encryption.';
comment on column public.push_subscriptions.last_success_at is
  'When the worker last delivered to this subscription.';

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, delete on table public.push_subscriptions to authenticated;

create policy push_subscriptions_select_own on public.push_subscriptions
for select to authenticated
using (user_id = (select app_private.current_user_id()));

create policy push_subscriptions_delete_own on public.push_subscriptions
for delete to authenticated
using (user_id = (select app_private.current_user_id()));

-- Registers this browser for the caller. Any row with the same endpoint is
-- deleted first, whoever owned it, so a browser that switches accounts moves
-- its subscription instead of failing on the unique endpoint. 42501 without a
-- user.
create function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default ''
)
returns public.push_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  registered public.push_subscriptions;
begin
  if caller_id is null then
    raise exception 'Sign in to enable notifications.'
      using errcode = '42501';
  end if;

  delete from public.push_subscriptions s where s.endpoint = p_endpoint;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (caller_id, p_endpoint, p_p256dh, p_auth, coalesce(p_user_agent, ''))
  returning * into registered;

  return registered;
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

comment on function public.register_push_subscription(text, text, text, text) is
  'Registers a Web Push subscription for the caller, moving it from whoever had that endpoint. 42501 without a user, 23514 for a bad endpoint or key.';

-- ---------------------------------------------------------------------------
-- The outbox and the worker heartbeat
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('reminder', 'todo_assigned', 'todo_due', 'test')),
  payload jsonb not null,
  dedupe_key text unique,
  send_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts smallint not null default 0,
  last_error text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Serves claim_notifications().
create index notifications_send_at_pending_idx on public.notifications (send_at)
  where status = 'pending';
-- Serves the worker's clean-up of old rows.
create index notifications_created_at_idx on public.notifications (created_at);
-- Serves the user cascade and send_test_notification()'s once-a-minute check.
create index notifications_user_id_created_at_idx on public.notifications (user_id, created_at);

comment on table public.notifications is
  'The notification outbox. Read and written only by the worker (secret key); users add rows only through send_test_notification() and the todos_notify_assignee trigger.';
comment on column public.notifications.payload is
  'What the push shows: { title, body, url, tag }, plus kind-specific fields.';
comment on column public.notifications.dedupe_key is
  'Optional key that makes a row at most once, e.g. reminder:<id>:<notify_at> or todo_due:<id>:<date>.';
comment on column public.notifications.send_at is
  'Not sent before this time; retries move it later.';
comment on column public.notifications.locked_until is
  'Lease set by claim_notifications(); another worker skips the row until then.';

create table public.worker_heartbeats (
  name text primary key,
  beat_at timestamptz not null,
  version text not null
);

comment on table public.worker_heartbeats is
  'The last tick of each worker, by name. Worker (secret key) only.';

alter table public.notifications enable row level security;
alter table public.worker_heartbeats enable row level security;

-- No policies: only the secret key (service_role, which bypasses RLS) reads
-- and writes these.
revoke all on table public.notifications, public.worker_heartbeats from public, anon, authenticated;
grant select, insert, update, delete on table public.notifications, public.worker_heartbeats
  to service_role;

-- Queues a test notification for the caller, at most one a minute: a second
-- call within the minute changes nothing and returns false. The advisory lock
-- serialises one user's calls, so two at once can't both pass the check.
-- 42501 without a user.
create function public.send_test_notification()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
begin
  if caller_id is null then
    raise exception 'Sign in to send a test notification.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('send_test_notification:' || caller_id::text, 0));

  if exists (
    select 1
    from public.notifications n
    where n.user_id = caller_id
      and n.kind = 'test'
      and n.created_at > now() - interval '1 minute'
  ) then
    return false;
  end if;

  insert into public.notifications (user_id, kind, payload)
  values (
    caller_id,
    'test',
    jsonb_build_object(
      'title', 'Test notification',
      'body', 'Notifications work on this device.',
      'url', '/settings/notifications',
      'tag', 'test'
    )
  );

  return true;
end;
$$;

revoke all on function public.send_test_notification() from public, anon;
grant execute on function public.send_test_notification() to authenticated;

comment on function public.send_test_notification() is
  'Queues a test notification for the caller. At most one a minute: false, inserting nothing, within the minute. 42501 without a user.';

-- Claims up to p_batch pending rows that are due and not leased by another
-- worker, leases them for 2 minutes and returns them, oldest send_at first.
create function public.claim_notifications(p_batch integer)
returns setof public.notifications
language sql
set search_path = ''
as $$
  update public.notifications n
  set locked_until = now() + interval '2 minutes'
  where n.id in (
    select c.id
    from public.notifications c
    where c.status = 'pending'
      and c.send_at <= now()
      and (c.locked_until is null or c.locked_until <= now())
    order by c.send_at
    limit greatest(p_batch, 0)
    for update skip locked
  )
  returning n.*
$$;

-- Claims up to p_batch reminders whose next_notify_at has passed, that aren't
-- muted and aren't leased by another worker, leases them for 2 minutes and
-- returns them, oldest next_notify_at first.
create function public.claim_due_reminders(p_batch integer)
returns setof public.reminders
language sql
set search_path = ''
as $$
  update public.reminders r
  set notify_locked_until = now() + interval '2 minutes'
  where r.id in (
    select c.id
    from public.reminders c
    where c.next_notify_at is not null
      and c.next_notify_at <= now()
      and not c.notifications_muted
      and (c.notify_locked_until is null or c.notify_locked_until <= now())
    order by c.next_notify_at
    limit greatest(p_batch, 0)
    for update skip locked
  )
  returning r.*
$$;

revoke all on function
  public.claim_notifications(integer),
  public.claim_due_reminders(integer)
from public, anon, authenticated;
grant execute on function
  public.claim_notifications(integer),
  public.claim_due_reminders(integer)
to service_role;

comment on function public.claim_notifications(integer) is
  'Worker: leases up to p_batch due pending outbox rows for 2 minutes (FOR UPDATE SKIP LOCKED) and returns them. service_role only.';
comment on function public.claim_due_reminders(integer) is
  'Worker: leases up to p_batch unmuted reminders whose next_notify_at has passed for 2 minutes (FOR UPDATE SKIP LOCKED) and returns them. service_role only.';

-- ---------------------------------------------------------------------------
-- To-do assignment notifications
-- ---------------------------------------------------------------------------

-- Security definer, because users can't write the outbox. When a card is
-- added with an assignee, or its assignee changes to another member, queues a
-- todo_assigned row for that member's user, unless that user is the caller
-- (assigning yourself). Unassigning queues nothing. The assigner's name is
-- worked out as get_family() does: display_name, else username, else the part
-- of the email before the '@'.
create function public.todos_notify_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  assignee_user_id uuid;
  assigner_name text;
begin
  if new.assignee_member_id is null
    or (tg_op = 'UPDATE' and new.assignee_member_id is not distinct from old.assignee_member_id)
  then
    return null;
  end if;

  select m.user_id into assignee_user_id
  from public.family_members m
  where m.id = new.assignee_member_id;

  if assignee_user_id is null or assignee_user_id is not distinct from caller_id then
    return null;
  end if;

  select coalesce(p.display_name, p.username, nullif(split_part(u.email, '@', 1), ''))
  into assigner_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = caller_id;

  insert into public.notifications (user_id, kind, payload)
  values (
    assignee_user_id,
    'todo_assigned',
    jsonb_build_object(
      'title', coalesce(assigner_name, 'Someone') || ' assigned you',
      'body', new.title,
      'url', '/todos?card=' || new.id::text,
      'tag', 'todo:' || new.id::text,
      'todoId', new.id,
      'todoTitle', new.title,
      'assignerName', assigner_name
    )
  );

  return null;
end;
$$;

revoke all on function public.todos_notify_assignee() from public, anon, authenticated;

comment on function public.todos_notify_assignee() is
  'Trigger: queues a todo_assigned notification for a card''s new assignee unless they assigned themselves. Nothing on unassign.';

create trigger todos_notify_assignee
after insert or update of assignee_member_id on public.todos
for each row execute function public.todos_notify_assignee();

commit;
