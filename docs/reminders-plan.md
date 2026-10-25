# Reminders plan (family hub phase 5)

This plan covers private reminders and the browser notifications that deliver them: a background
worker, Web Push, a Settings → Notifications page, reminders that notify at chosen lead times, and
notifications for to-dos assigned to you. It replaces steps 5.1–5.9 in
[family-hub-roadmap.md](family-hub-roadmap.md). Email notifications are a later step.

## The design in one page

| Question | Answer |
| --- | --- |
| Who has reminders? | **Every user**, with or without a family, parents and kids alike. Reminders aren't a kid permission module. |
| Who sees a reminder? | **Only its owner.** You can only create reminders for yourself, and nobody else ever sees them, parents included. To ask someone else to do something, assign them a to-do. |
| What's on a reminder? | Title (≤ 200 chars), notes (≤ 2,000), a first date and a time of day (default 09:00, Europe/Bucharest), how it repeats, up to three lead times, a mute switch, and an optional expense template (R12). |
| How does it repeat? | Presets only: **once**, **every N weeks**, **every N months** and **every N years** (N from 1 to 12), counted from the first date. A monthly reminder on the 31st falls on the last day of shorter months and returns to the 31st after (see "Working out the dates"). |
| Due, overdue, done? | A reminder has one **open occurrence** (`next_due_on`). It's **due** on that day, **overdue** once its time has passed, and stays overdue until marked done; a missed rent reminder doesn't skip itself. **Mark done** records the occurrence and moves a repeating reminder to the next one; a one-off reminder moves to Done. |
| Snooze? | An hour, until tomorrow 09:00, or a chosen time. A snoozed reminder leaves Overdue until then and notifies again at that time. |
| How does it reach me? | **Browser notifications (Web Push) only.** No email; email notifications are a later step. Phones get native push in roadmap phase 9. |
| What do I set up? | **Settings → Notifications**: one **Browser notifications** switch, an **Enable on this device** button (pressed once per device), **Send a test**, and a switch per kind (**Reminders**, **To-dos**). No device list. |
| Which browsers? | Chrome, Edge and Firefox everywhere; Safari on macOS 13+; Safari on iOS 16.4+ **once the app is added to the home screen** (Apple's rule; on an iPhone the button explains the steps instead). |
| What if the app is open? | The system notification **always shows**, on every browser. Clicking it focuses an open tab, or opens one, on the reminder. |
| What else shows due reminders? | A **badge** on the Reminders nav item with the number of due and overdue reminders, so a dismissed notification never hides one. |
| Who sends? | A **worker**: a second container from the same Docker image, running `node worker.js`. It wakes every 30 seconds, delivers the outbox, notifies due reminders and, once a day, to-dos due today. |
| To-do notifications? | "*Ana assigned you* Buy milk" when someone else assigns you a card, and "Due today: Buy milk" at 09:00 for your open cards due that day. |
| How is access enforced? | **RLS**: reminders, notification settings and push subscriptions are owner-only. Users can't read or write the outbox; only the worker (secret key) and two SQL functions can. |
| Feature flag? | **None.** As with the to-do board, the page lands unlinked and the nav item lands last. Reminder routes don't need a family. |
| MCP | `list_reminders`, `add_reminder`, `complete_reminder`, on the caller's own reminders. Kids still need the `mcp` permission to use MCP at all. |

### How a reminder notifies

```
save (API, as the caller)
  └─ next_due_on, next_due_at, next_notify_at = schedule(reminder, now)        ← pure TS, R2

worker tick (every 30 s, secret key)
  ├─ claim_due_reminders(50): next_notify_at <= now(), not muted,
  │    FOR UPDATE SKIP LOCKED, lease 2 min
  │    └─ for each: insert outbox row (dedupe_key = reminder:<id>:<notify_at>)
  │                 next_notify_at = next notify time after this one, or null
  ├─ once a day after 09:00: insert "due today" rows for open to-dos (dedupe_key = todo_due:<id>:<date>)
  └─ claim_notifications(50): send_at <= now(), status pending, lease 2 min
       └─ for each: check the recipient's switches → Web Push to each of their devices
                    404/410 → delete that device; 429/5xx → retry with backoff; else sent
```

A reminder notifies at each lead time before its open occurrence ("3 days before", "on the
time"), and once more when a snooze ends. If the worker was down and several notify times passed,
it sends only the latest one, so a restart never brings a burst. After the last lead time,
`next_notify_at` is null until the reminder is marked done, snoozed or edited, which works it out
again.

### Working out the dates

All in `src/lib/reminders/schedule.ts`, pure and shared by the API, the worker and the MCP tools:

- Occurrence *k* is the first date plus *k* × interval units, **always counted from the first
  date**, never from the previous occurrence. A month or year whose day doesn't exist uses its last
  day, so 31 January monthly gives 28/29 February, 31 March, 30 April, 31 May. Counting from the
  previous occurrence would drift to the 28th for good.
- Lead times are subtracted in **local wall-clock time**: "1 day before 09:00" is 09:00 the day
  before, across a DST change too.
- Local date and time become a UTC instant through `zonedTimeToUtc(date, time, timeZone)`, built on
  `Intl.DateTimeFormat` (no date library). The clock skipped at the spring change (03:00–04:00 in
  Bucharest) moves forward to the first valid minute; the repeated hour in autumn uses the earlier
  instant.
- Only Europe/Bucharest is offered for now, but `timezone` is stored per reminder so others can
  come later without a migration.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Who sees reminders | The owner only | Decided 25 October 2026. To-dos are for asking others. |
| Channels | Web Push now, native push in phase 9; email later | Decided. Email is poor at "now". |
| Device setup | One switch, "Enable on this device", no device list | Decided. Every member can set it up without managing devices. |
| Notification while the app is open | Always the system notification | Decided. Same behaviour everywhere; Safari drops subscriptions that receive pushes without one. |
| Repeat format | Structured columns (`repeat_unit`, `repeat_interval`), not an RRULE string | The form only offers presets, the math is a few lines, and it's easy to test. An RRULE can be generated from these if the calendar ever needs one. Replaces the roadmap's `rrule` package. |
| Reminder scheduling | `next_notify_at` on the reminder, claimed by the worker | Saving a reminder never writes to the outbox, so users never need outbox access and editing a reminder needs no clean-up of queued rows. Replaces the roadmap's "outbox row per lead time". |
| Outbox writes | Only the worker, the to-do trigger and `send_test_notification()` | Users can't insert notifications for anyone, themselves included. |
| Worker lock | `FOR UPDATE SKIP LOCKED` with a lease, in SQL functions | Two workers never send the same row, and a crashed worker's rows are picked up after the lease. Replaces the roadmap's job lock table. |
| Worker bundle | esbuild, one `dist/worker.js` in the same image | Next's standalone output only traces the web app's files. |
| Duplicate pushes | `tag` per reminder or card, retries resend to all devices | A retried push replaces the earlier one on a device instead of stacking. Per-device delivery records aren't worth the extra table. |
| Overdue nagging | None; one notification per lead time | Keeps notifications rare. "Remind me again daily while overdue" can come later. |

## Tasks

The workflow is the same as phases 1–4: one task, one branch (`family/<id>-<slug>` from `main`),
one PR, one fresh agent per task, run one at a time. All SQL is in R1; George applies the
migration at the checkpoint.

| Task | What | Depends on |
| --- | --- | --- |
| R1 | Migration: reminders, notification settings, push subscriptions, the outbox, the worker functions, the to-do trigger | — |
| — | **Checkpoint:** George applies the R1 migration | R1 |
| R2 | Domain: types, Zod schemas, `schedule.ts` | — (can run alongside R1) |
| R3 | Repositories: reminders and notification settings, fakes, wiring | R1, R2 |
| R4 | Reminders API routes and the summary | R3 |
| R5 | Reminders page at `/reminders` (not linked yet) | R4 |
| R6 | Worker: entry point, bundle, Dockerfile, heartbeat, claim loop (logs only) | R1, R2 |
| — | **Checkpoint:** George adds the worker container in `vps-apps`, and the VAPID keys | R6 |
| R7 | Web Push: sender, service worker, subscription API, Settings → Notifications, test notification | R3, R6 |
| R8 | Reminder notifications: the worker notifies due reminders | R4, R7 |
| R9 | Nav item, badge and phone layout | R5, R8 |
| R10 | To-do notifications: assigned to you, due today | R7 |
| R11 | MCP tools | R4 |
| R12 | (Optional) Log as expense | R5 |
| — | **Checkpoint:** smoke test | R9, R10, R11 |

### R1: Migration

Migration `create_reminders_and_notifications`:

```sql
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
  lead_minutes integer[] not null default '{0}',         -- ≤ 3 distinct values from the presets
  notifications_muted boolean not null default false,
  next_due_on date,                                       -- null once a one-off reminder is done
  next_due_at timestamptz,                                -- next_due_on + time_of_day, as an instant
  snoozed_until timestamptz,
  next_notify_at timestamptz,
  notify_locked_until timestamptz,
  expense_template jsonb,                                 -- R12; null until then
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reminder_completions (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  occurrence_on date not null,
  done_at timestamptz not null default now(),
  expense_id uuid references public.expenses(id) on delete set null,
  unique (reminder_id, occurrence_on)
);

create table public.notification_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  push_enabled boolean not null default true,
  reminders_enabled boolean not null default true,
  todos_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('reminder', 'todo_assigned', 'todo_due', 'test')),
  payload jsonb not null,                                 -- { title, body, url, tag }
  dedupe_key text unique,
  send_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts smallint not null default 0,
  last_error text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table public.worker_heartbeats (
  name text primary key,
  beat_at timestamptz not null,
  version text not null
);
```

Indexes: `reminders (user_id, next_due_at)`, a partial index on `reminders (next_notify_at) where
next_notify_at is not null and not notifications_muted`, `notifications (send_at) where status =
'pending'`, and `notifications (created_at)` for clean-up.

Policies (all `to authenticated`):
- **reminders**: select, insert, update, delete where `user_id = app_private.current_user_id()`.
  A trigger sets `updated_at` and keeps `user_id` from changing.
- **reminder_completions**: through the parent reminder's owner.
- **notification_settings**: the owner selects, inserts and updates their own row. A missing row
  means the defaults.
- **push_subscriptions**: the owner selects and deletes their own rows. Registration goes through
  `register_push_subscription(endpoint, p256dh, auth, user_agent)` (security definer): it deletes
  any row with that endpoint, whoever owned it, and inserts one for the caller. A browser that
  switches accounts then moves its subscription instead of failing on the unique endpoint.
- **notifications, worker_heartbeats**: RLS on, **no policies**. Only the secret key reads them.

Functions:
- `send_test_notification()` (security definer, `authenticated`): inserts a `test` row for the
  caller, at most one a minute (a second call within the minute is a no-op).
- `claim_notifications(batch int)` and `claim_due_reminders(batch int)`: `update … set
  locked_until = now() + interval '2 minutes' where id in (select … for update skip locked limit
  batch) returning *`. Granted to `service_role` only; revoked from `public`, `anon` and
  `authenticated`.
- Trigger `todos_notify_assignee` (after insert, or update of `assignee_member_id`; security
  definer): when the new assignee's user isn't `app_private.current_user_id()`, inserts a
  `todo_assigned` row for them with the card title and the assigner's display name. Unassigning or
  assigning yourself inserts nothing.

SQL tests:
- `supabase/tests/reminders_rls.sql`: the owner can do everything; another member of the same
  family, **a parent included**, a member of another family and a user with no family see and
  change nothing; `user_id` can't change; completions follow their reminder.
- `supabase/tests/notifications_rls.sql`: users can't read or insert outbox rows or heartbeats;
  the claim functions refuse `authenticated`; `send_test_notification` inserts one row for the
  caller and no-ops within the minute; registering a known endpoint moves it to the caller; users
  see only their own settings and subscriptions.
- `todos_rls.sql` gains: assigning a card to another member queues one `todo_assigned` row for
  them; assigning yourself or unassigning queues none.

**Done when** `npm run test:db` passes and `database.types.ts` is regenerated.

### Checkpoint

George applies `create_reminders_and_notifications` to the live project (Supabase MCP
`apply_migration`, as in earlier checkpoints). Nothing in the app uses it yet.

### R2: Domain and validation

Pure code, no Supabase, so it can run alongside R1.

- `src/lib/reminders/types.ts`: `Reminder`, `RepeatUnit`, `LEAD_TIME_PRESETS` (at the time,
  1 hour, 1 day, 3 days, 1 week before), `ReminderState` (`upcoming`, `due`, `overdue`,
  `snoozed`, `done`).
- `src/lib/validation/reminder.ts`: `reminderSchema` (title, notes, startsOn, timeOfDay,
  repeatUnit, repeatInterval, leadMinutes, notificationsMuted), `snoozeSchema` (`hour`,
  `tomorrow`, or `until` with an instant in the future), trimming as the expense schemas do.
- `src/lib/time-zone.ts`: `zonedTimeToUtc` and `utcToZoned`, on `Intl.DateTimeFormat`.
- `src/lib/reminders/schedule.ts`: `occurrenceOn(reminder, k)`, `nextOccurrenceAfter(reminder,
  date)`, `dueAt(reminder, date)`, `notifyTimes(reminder)`, `nextNotifyAt(reminder, after)`
  (taking snoozes and the mute into account) and `stateOf(reminder, now)`.

Tests: monthly from 31 January through a leap February and back to 31 March; yearly from 29
February; every 2 weeks; one-off; lead times across the March and October DST changes in
Bucharest; a 03:30 time on the spring change day; `nextNotifyAt` after the worker missed several
notify times (only the latest); snoozes; mute.

**Done when** the unit tests pass and nothing imports the new code yet.

### R3: Repositories

Follow `TodoRepository` (`src/lib/todos/repository.ts`):

- `ReminderRepository` in `src/lib/reminders/repository.ts`: `list({ doneSince })`, `get(id)`,
  `create`, `update`, `delete`, `complete(id, occurrenceOn, next)`, `summary(now)` (due and
  overdue counts). Acts as the caller; the user comes from the session, never from the client.
- `NotificationSettingsRepository` in `src/lib/notifications/settings-repository.ts`:
  `get()` (defaults when there's no row, plus the caller's device count), `update`,
  `registerPushSubscription`, `deletePushSubscription(endpoint)`, `sendTest()`.
- Supabase implementations in `src/lib/supabase/repositories/reminders.ts` and
  `notification-settings.ts`, acting as the caller.
- Fakes in `src/test/fakes/` and both added to `Repositories` in `src/lib/repositories.ts`
  (shared files: rebase and re-check before merging).
- `src/lib/reminders/service.ts`: use cases shared by routes and MCP tools. Every write runs
  `schedule.ts` and saves `next_due_on`, `next_due_at` and `next_notify_at` with it.

**Done when** typecheck, lint and the repository and service tests pass.

### R4: API routes

Every route uses `withUser`. No family is needed.

| Route | What |
| --- | --- |
| `GET /api/reminders?doneSince=` | The caller's reminders with their state, and completions since `doneSince` (default 30 days) for the Done tab. |
| `POST /api/reminders` | Create. |
| `PATCH / DELETE /api/reminders/[id]` | Edit (works out the dates again); delete. |
| `POST /api/reminders/[id]/complete` | Mark the open occurrence done; returns the reminder with its next occurrence. A second call for the same occurrence is a 409. |
| `POST /api/reminders/[id]/snooze` | `hour`, `tomorrow` or `until`. |
| `GET /api/reminders/summary` | `{ due, overdue }` for the badge. |

Route tests: every action for the owner; another user, a parent of the owner included, gets 404
for every id route; validation errors (empty title, four lead times, interval 13, a snooze in the
past); completing a monthly reminder twice in a row moves it two months.

**Done when** the route tests pass and `protected-routes.test.ts` lists the new routes.

### R5: The reminders page

Page `src/app/(app)/reminders/page.tsx`, components in `src/components/reminders/`. Nothing links
to it yet.

- Tabs **Upcoming**, **Overdue** (with its count) and **Done**. Each row shows the title, the next
  due date and time ("Fri 31 Oct, 09:00"), how it repeats ("Monthly"), a muted icon when muted,
  and **Mark done** and **Snooze** actions. Overdue rows show how late they are.
- An `AppDialog` form to add and edit: title, notes, first date, time, repeat preset with
  interval, lead time chips (up to three), mute. Delete from the edit dialog, with a confirm.
- Optimistic mark done and snooze with SWR `mutate`, rolled back on error.
- Empty states per tab. Add the page to `/dev/preview` with fake data.

**Done when** screenshots at 390 and 1280 px (light and dark), and marking a monthly reminder done
moves it to the next month in the list.

### R6: The worker

- `src/worker/main.ts`: the entry point. It reads env, then runs `tick()` every 30 seconds until
  SIGTERM or SIGINT, finishing the current tick before it exits.
- `src/lib/notifications/worker.ts`: `tick({ store, push, clock, log })`, written against
  interfaces so it's tested with fakes. In this task a tick only writes the heartbeat and logs how
  many rows it would claim.
- `WorkerStore` in `src/lib/notifications/worker-store.ts`, implemented in
  `src/lib/supabase/worker-store.ts` with `createAdminClient()`. Add it to the list of allowed uses
  in `admin-client.ts`'s comment. The worker acts for every user, so it needs the secret key.
- `npm run build:worker`: `esbuild src/worker/main.ts --bundle --platform=node --target=node24
  --conditions=react-server --outfile=dist/worker.js`. `react-server` makes `server-only`
  resolve to its empty module; esbuild reads the `@/` paths from `tsconfig.json`. Add `esbuild` as
  a pinned dev dependency, and run `build:worker` in CI after `build`.
- Dockerfile: the builder also runs `npm run build:worker`; the runner copies `dist/worker.js` to
  `/app/worker.js`. The web container's command doesn't change.
- `scripts/deploy.sh` (the manual fallback) starts or replaces an `expense-tracker-worker`
  container from the same image with `node worker.js`, no port, the same env file.

**Done when** `docker run … node worker.js` against a local Supabase writes a heartbeat every 30
seconds and stops cleanly on `docker stop`, and the worker tests pass.

### Checkpoint: worker container and keys

George, in `GeorgeDanicico/vps-apps` (production deploys run from there): add the worker container
next to the web one, same image and env file, command `node worker.js`, restart `unless-stopped`.
Generate the VAPID keys once with `npx web-push generate-vapid-keys` and add `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:` your address) to
`/etc/expense-tracker/.env.production`. The app is already on HTTPS through Tailscale Serve.

### R7: Web Push and Settings → Notifications

- `PushSender` interface in `src/lib/notifications/push.ts`, implemented with the `web-push`
  package. Payload `{ title, body, url, tag }`, TTL 24 hours, urgency `high`. A 404 or 410 deletes
  that subscription; 429 and 5xx are retried at 1, 5 and 30 minutes, then the row is `failed`.
- The worker's tick now claims outbox rows and sends each to every device of its recipient, after
  checking `push_enabled` and the kind's switch (`skipped` when off). `sent` rows older than 30
  days are deleted once a day.
- `public/sw.js` (bump `CACHE_NAME`):
  - `push`: always `showNotification(title, { body, tag, data: { url }, icon: "/icon-192.png" })`,
    then `postMessage({ type: "notification" })` to open windows so the badge refreshes.
  - `notificationclick`: focus an open window and navigate it to `url`, or open one.
  - `pushsubscriptionchange`: subscribe again with the public key and re-register.
- `PwaRegistration` also registers the service worker in development when
  `NEXT_PUBLIC_SW_IN_DEV=true`, so push can be tested locally.
- Routes: `GET / PATCH /api/notifications/settings` (`{ pushEnabled, remindersEnabled,
  todosEnabled, deviceCount }`), `POST / DELETE /api/notifications/push-subscriptions`,
  `GET /api/notifications/push-key` (the public VAPID key), `POST /api/notifications/test`.
- **Settings → Notifications** (`src/app/(app)/settings/notifications/page.tsx`, next to AI
  assistants):
  - The **Browser notifications** switch.
  - **This device**: "Enable on this device" calls `Notification.requestPermission()` and
    `pushManager.subscribe()` inside the click handler, then registers the subscription; once on,
    the button becomes "Turn off on this device". States for an unsupported browser, an iPhone
    outside the home-screen app (with the Add to Home Screen steps), and permission denied (how to
    allow it again in the browser's settings).
  - **Send a test** ("arrives within half a minute").
  - **Reminders** and **To-dos** switches.
  - A warning "Reminders won't notify you" when the switch is off or `deviceCount` is 0.
- Signing out unsubscribes this device and deletes its subscription first.

**Done when** a test notification arrives in Chrome, Safari on macOS and the iPhone home-screen
app; the switch off makes the next test `skipped`; a dead subscription is deleted; and the worker
and route tests pass.

### R8: Reminder notifications

- The worker's tick also calls `claim_due_reminders`. For each reminder it inserts a `reminder`
  outbox row (`dedupe_key = reminder:<id>:<notify_at>`, payload "Pay rent", "Due today at 09:00"
  or "Due in 3 days, Fri 31 Oct", `url = /reminders?focus=<id>`, `tag = reminder:<id>`) and sets
  `next_notify_at` to the next notify time, or null.
- `/reminders?focus=<id>` scrolls to the reminder and highlights it.

Tests with a fake clock: a monthly reminder with "3 days before" and "at the time" notifies twice,
then nothing until marked done, then twice for the next month; a muted reminder never notifies; a
snoozed one notifies once when the snooze ends; a worker that was down for a week sends one
notification, not a burst; two ticks running at once send each notification once.

**Done when** the worker tests pass and a reminder set two minutes ahead notifies on a real
device.

### R9: Nav item, badge and phones

- `NAV_ITEMS.reminders` (`/reminders`, "Reminders", a `BellRing` icon), not family-only. The
  **Family** section becomes **Planning**, holding Reminders and To-dos (To-dos stay family-only).
- The badge on the nav item in the sidebar, the bottom bar and the More sheet: `due + overdue`
  from `/api/reminders/summary` through SWR, refreshed on focus, every 5 minutes, and on the
  service worker's `notification` message. Hidden at 0, "9+" above 9.
- Phones (< 768 px): the tabs become a `SegmentedControl`, rows stack their actions, and the form
  opens as a full-height sheet.

**Done when** screenshots at 390 and 1280 px, the badge updates when a reminder becomes due, and a
user without a family sees Reminders but not To-dos.

### R10: To-do notifications

- The worker formats `todo_assigned` rows from R1's trigger ("Ana assigned you", the card title,
  `url = /todos?card=<id>`, `tag = todo:<id>`).
- Once a day, on the first tick after 09:00 Bucharest, it inserts a `todo_due` row ("Due today",
  the card title) for each open card due that day with an assignee
  (`dedupe_key = todo_due:<id>:<date>`, so restarts don't repeat it).
- `/todos?card=<id>` opens that card's dialog.

**Done when** assigning a card to another member notifies them; assigning yourself doesn't; with
**To-dos** off nothing arrives; a card due today notifies its assignee once at 09:00.

### R11: MCP tools

`src/lib/mcp/tools/reminders.ts` with `defineTool`, on R3's service:

| Tool | Kind | What |
| --- | --- | --- |
| `list_reminders` | READ | The caller's reminders with state and next due date; optional `state` filter. |
| `add_reminder` | CREATE | Title, first date, optional time, repeat, lead times, notes. |
| `complete_reminder` | UPDATE | Mark the open occurrence done; returns the next one. |

Update the tool-surface snapshot and `server.test.ts` (shared files: rebase and re-check before
merging).

**Done when** the snapshot is updated and a tool test shows a caller only ever sees and changes
their own reminders.

### R12 (optional): Log as expense

- The form gets an optional **Expense** section: amount, currency, category and subtype, stored in
  `expense_template` and validated with the existing expense schemas.
- **Mark done** on such a reminder opens a confirm with the expense pre-filled for the occurrence
  date. Confirming adds the expense through the existing expense service and links it on the
  completion (`expense_id`); "Just mark done" skips it.

**Done when** ticking "Pay rent" adds the rent expense in one confirm, and deleting that expense
leaves the completion in place.

### Checkpoint: smoke test

On two devices (a Mac in Chrome or Safari, and an iPhone home-screen app): enable notifications on
both; send a test; create a reminder two minutes ahead with "at the time" and see it on both;
mark it done from the notification's page; snooze one for an hour; turn **Reminders** off and see
nothing for the next one; check that the other parent and a kid can't see your reminders; assign
a kid a to-do and see their notification; ask Claude Code to add and complete a reminder through
MCP.

## Not in this plan

- **Email notifications**: a later step, for family notifications, probably as a daily or weekly
  summary through Gmail SMTP.
- **Reminders for other people**: use to-dos.
- **Repeated nagging** while overdue, **skipping** an occurrence without marking it done, custom
  repeat rules beyond the presets, and other timezones in the form.
- **A device list** in Settings.
- **Native push**: roadmap 9.6, as an `expo` channel on the same outbox.
