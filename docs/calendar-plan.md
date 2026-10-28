# Calendar plan (family hub phase 6)

This plan covers the family calendar: one calendar per family that every member sees and edits,
with month, week and agenda views, short daily and weekly repeats, notifications before your
events through the phase 5 worker, and a private **calendar feed** per member, so the calendar
apps on an iPhone, a Mac or Windows show the events that member attends. It replaces steps
6.1–6.9 in [family-hub-roadmap.md](family-hub-roadmap.md). **Google Calendar sync (6.5–6.7, 6.9)
is dropped** (see "Decisions").

## The design in one page

| Question | Answer |
| --- | --- |
| Who has a calendar? | **Every family has exactly one.** There's no calendars table: each event belongs to a family through `calendar_events.family_id`, as to-do cards do. A user without a family has no calendar; the nav item is hidden and `/calendar` links to Settings → Family. |
| Who sees and changes events? | **Every member of the family**, parents and kids alike, sees every event in full and can add, edit and delete it. There's no kid permission module, no private events and no "busy only" events. |
| What's on an event? | Title (≤ 200 chars), notes (≤ 2,000), location (≤ 200), all-day or a start and end time, and its **attendees**: one or more members, **Just me** by default, with an "Everyone" shortcut. |
| Whose event is it? | **An event is yours when you attend it.** "Swimming" with just you is yours; "Visit my parents" created by your wife with the two of you is both of yours; "Kid's dentist" created by her with only the kid is the kid's. Who created it doesn't matter. This one rule decides your feed and your notifications. |
| How does it repeat? | **Daily for up to 10 days** or **weekly (same weekday) for up to 10 weeks**, chosen when the event is created. Nothing repeats forever. |
| How is a repeat stored? | **As separate events**, one row per occurrence, linked by a shared `series_id`. There's no rule to expand, no exceptions table and no recurrence math when reading (see "Why repeats are separate rows"). |
| Editing one occurrence? | Edit or delete **this event**, **this and following events**, or **all events** in the series. Each is a plain update or delete of the matching rows. |
| Time zones? | Instants (`timestamptz`) plus an IANA zone per event, for display and for working out the repeats. Only Europe/Bucharest is offered, as for reminders. A 09:00 weekly event stays 09:00 across DST because each occurrence is converted on its own when it's created. |
| Colours? | An event with one attendee takes that member's colour (`profiles.color`, the same as the finance and to-do chips). An event with several takes the neutral family colour and shows their avatars. |
| Filters? | Chips above the calendar, as on the to-do board: **Everyone**, **Me** and one per member, filtering by attendee. Kept in the URL (`?member=`). |
| Notifications? | Every attendee gets a browser notification **30 minutes before** a timed event, and at **07:30 on the day** of an all-day event. Members also get one when someone else adds them to an event, once per series. A **Calendar** switch in Settings → Notifications turns both off. |
| Other calendar apps? | **A private feed link per member** (`webcal://…/api/calendar/feed/<token>.ics`) that Apple Calendar, Outlook and others subscribe to. It's **read-only** and holds **only the events that member attends**, not the whole family calendar. |
| Live updates? | No realtime channel. The calendar revalidates on focus and every **60 seconds while visible** through SWR. |
| How is access enforced? | **RLS** limits every event and attendee row to the caller's family. Feeds are read by their token only, through one SQL function that returns nothing but that member's own events. |
| Feature flag? | **None.** As with to-dos and reminders, the API and the page land unlinked and the nav item lands last. Routes call `requireFamilyFeature()`. |
| MCP | `list_events`, `add_event`, `update_event`, `delete_event`, acting as the caller, so RLS keeps them to the caller's family. Kids still need the `mcp` permission to use MCP at all. |

### Why repeats are separate rows

Calendars that allow "repeats forever" (Google, Apple, Outlook) store **one event with a rule**
(an RFC 5545 `RRULE`) plus a list of exceptions, and expand the rule for whatever range is on
screen. That's the only way to store something infinite, but it puts recurrence math, exception
matching and edit-scope splitting into every read.

With at most 10 occurrences, it's simpler to do the other thing calendars sometimes do and **store
every occurrence**:

- **Creating** "Swimming, weekly, 6 weeks" works out the 6 dates in TypeScript (each converted to
  an instant with `zonedTimeToUtc` from `src/lib/time-zone.ts`, so DST is handled per occurrence)
  and inserts 6 rows with the same `series_id` and a `series_index` from 1 to 6, in one
  transaction.
- **Reading** a range is one overlap query: `starts_at < :to and ends_at > :from`. No expansion.
- **This event** updates or deletes one row. **This and following** and **all events** update or
  delete the series' rows with `series_index >=` the chosen one, or all of them. A changed date
  shifts every affected row by the same number of days; a changed time sets that time on each.
- **Notifications** work per row, so each occurrence has its own notify time.
- **The feed** sends one plain `VEVENT` per row, with UTC times: no `RRULE`, `EXDATE`,
  `RECURRENCE-ID` or `VTIMEZONE` block.

The repeat (daily or weekly, how many) is fixed once created. To make a series longer, add a new
one; to make it shorter, delete the following events.

### How notification times are worked out

`calendar_events.notify_at` is set by the API on every save: `starts_at − 30 minutes` for a timed
event, 07:30 local time on the start date for an all-day event. If that time has already passed
when the event is saved, `notify_at` is null and the event doesn't notify (attendees added by
someone else still get "added you"). The times are constants in
`src/lib/family-calendar/notify.ts`; a per-person setting can come later without a migration.

```
worker tick (every 30 s, secret key)
  └─ claim_due_calendar_events(50): notify_at <= now(), notified_at is null, ends_at > now(),
       FOR UPDATE SKIP LOCKED, lease 2 min
       └─ for each: insert one outbox row per attendee
                      (dedupe_key = event:<id>:<notify_at>:<user id>)
                    set notified_at = now()
```

Editing an event's time works `notify_at` out again and clears `notified_at`, so a moved event
notifies again at its new time. An event that already ended when the worker gets to it (the worker
was down) is marked notified without sending.

### The calendar feed

```
Calendar app ──GET /api/calendar/feed/<token>.ics──▶ route (no session)
  route: sha256(token) → rpc calendar_feed(hash) as anon (security definer)
           unknown or revoked → 404; owner no longer in a family → an empty calendar
         → events the owner attends that ended at most 90 days ago, the family name
         → iCalendar text, 200, text/calendar, Cache-Control: private, max-age=300
```

- One VEVENT per row: `UID:<event id>@simple-ledger`, `DTSTAMP` and `LAST-MODIFIED` from
  `updated_at`, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `DTSTART` and `DTEND` in UTC
  (`20261103T070000Z`), or a `VALUE=DATE` pair with the end exclusive for all-day events.
- `X-WR-CALNAME:<family name>`, plus `REFRESH-INTERVAL;VALUE=DURATION:PT15M` and
  `X-PUBLISHED-TTL:PT15M`, which Apple and Outlook honour as a hint.
- No `VALARM`: the app's own notifications already cover it, and alarms in the feed would notify
  twice.
- Text is escaped (`\\`, `\;`, `\,`, `\n`) and lines are folded at 75 octets without splitting a
  UTF-8 character.

**Where it works today.** The feed is fetched by the calendar app itself, so the device has to
reach the app over Tailscale:

| App | Works now? |
| --- | --- |
| Apple Calendar on an iPhone or iPad with Tailscale | Yes. Tap **Add to Calendar** on the phone, or Settings → Calendar → Accounts → Add Subscribed Calendar. iOS picks its own refresh schedule, often 15 minutes to an hour. |
| Calendar on a Mac with Tailscale | Yes. **Add to Calendar** opens it, or File → New Calendar Subscription; set auto-refresh to every 5 minutes. |
| Classic Outlook for Windows with Tailscale | Yes, through Add Calendar → From internet. |
| New Outlook, the Windows Calendar app, Outlook.com, Google Calendar | **Not yet.** They fetch the feed from Microsoft's or Google's servers, which can't reach a Tailscale-only app. They start working once the app has a public HTTPS URL (the roadmap's open decision), with no change to the feed. |

The feed link is a secret: anyone who has it sees that member's events. It's shown **once**, when
it's created, like MCP tokens; regenerating it stops the old link at once.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Calendars per family | One, no calendars table | Decided 28 October 2026. Same as the to-do board; member chips and colours do what separate calendars would. Replaces the roadmap's `calendars` table. |
| Kid permission | None; every member edits every event | Decided 28 October 2026. Same as to-dos and reminders. Drops the roadmap's reserved "Calendar: off / view / edit" module, so the permission catalogue doesn't change. |
| Busy-only events | None; everyone sees every event in full | Decided 28 October 2026. |
| Whose event | The attendees' | Decided 28 October 2026. One rule for the feed and the notifications; the creator only matters for "added you". |
| Repeats | Daily up to 10 days, weekly up to 10 weeks; nothing forever | Decided 28 October 2026. Enough for how the app is used today, and it lets each occurrence be its own row. |
| Repeat storage | One row per occurrence with `series_id`, not a rule | No expansion, exceptions or recurrence math on read; edit scopes are plain updates; the feed needs no `RRULE` or `VTIMEZONE`. Replaces the roadmap's `rrule` and `event_exceptions`. |
| Notification times | 30 minutes before; 07:30 on the day for all-day events; one Calendar switch | Decided 28 October 2026. Every attendee, whoever created the event. No per-event lead times. |
| Google Calendar sync | **Dropped** | Decided 28 October 2026. It needs a Google OAuth app kept "In production", encrypted refresh tokens, a sync loop with conflict rules and echo protection: about half the phase, for something a read-only feed mostly covers. Google Calendar can subscribe to the same feed once the app has a public URL. |
| Feed contents | Only the events the member attends | Decided 28 October 2026. A member's phone shows their own commitments, not the whole family's. |
| Feed authentication | Its secret token only, hashed with SHA-256 like MCP tokens, read through an anon-callable security definer function | Calendar apps can't sign in. The function returns only the token owner's events, so a bug in the route can't widen it, and the route needs no secret key. |
| Feed link display | Shown once, regenerate to get a new one | Storing it in plain text would make a database read enough to see anyone's events. |
| Live updates | SWR polling, 60 s while visible | No new infrastructure; calendars change rarely. |

## Tasks

The workflow is the same as phases 1–5: one task, one branch (`family/<id>-<slug>` from `main`),
one PR, one fresh agent per task, run one at a time. All SQL is in C1; George applies the
migration at the checkpoint.

| Task | What | Depends on |
| --- | --- | --- |
| C1 | Migration: events, attendees, the save functions, feeds, notification kinds, the worker function, the attendee trigger | — |
| — | **Checkpoint:** George applies the C1 migration | C1 |
| C2 | Domain: types, Zod schemas, `series.ts`, `notify.ts` | — (can run alongside C1) |
| C3 | `CalendarRepository`: interface, Supabase implementation, fake, wiring, service | C1, C2 |
| C4 | API routes: list a range, add, edit, delete, with the three scopes | C3 |
| C5 | Calendar page at `/calendar`: month and agenda views, event dialog (not linked yet) | C4 |
| C6 | Week view, member filters, phone layout, the nav item | C5 |
| C7 | Event notifications: 30 minutes before, 07:30 for all-day, "added you", the Calendar switch | C3 |
| C8 | Calendar feed: iCalendar output, the feed route, the Subscribe dialog | C1, C2 |
| C9 | MCP tools | C3 |
| — | **Checkpoint:** smoke test | C6, C7, C8, C9 |

### C1: Migration

Migration `create_family_calendar`:

```sql
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  series_id uuid not null default gen_random_uuid(),       -- shared by a repeat's occurrences
  series_index smallint not null default 1 check (series_index between 1 and 10),
  series_repeat text not null default 'none' check (series_repeat in ('none', 'daily', 'weekly')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  location text not null default '' check (char_length(location) <= 200),
  all_day boolean not null default false,
  starts_at timestamptz not null,                          -- all-day: local midnight of the first day
  ends_at timestamptz not null,                            -- all-day: local midnight after the last day
  timezone text not null default 'Europe/Bucharest',
  notify_at timestamptz,
  notified_at timestamptz,
  notify_locked_until timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, series_index),
  check (ends_at > starts_at and ends_at <= starts_at + interval '31 days'),
  check (series_repeat <> 'none' or series_index = 1)      -- a one-off is the only row of its series
);

create table public.calendar_event_attendees (
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete cascade,
  primary key (event_id, member_id)
);

create table public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_fetched_at timestamptz,
  revoked_at timestamptz
);
```

Indexes: `calendar_events (family_id, starts_at)` for the range query, `calendar_events
(series_id)`, `calendar_event_attendees (member_id)` for the cascade and the feed, a partial
unique index on `calendar_feeds (user_id) where revoked_at is null` (one live link per user), and
a partial index on `calendar_events (notify_at) where notified_at is null`.

Policies (all `to authenticated`, helpers in a sub-select, as in `create_todos`):
- **calendar_events**: select, insert, update and delete where `family_id =
  family_private.my_family_id()`; insert also needs `created_by = app_private.current_user_id()`.
- **calendar_event_attendees**: through the parent event's family.
- **calendar_feeds**: the owner selects their own rows, **without `token_hash`** (column grants, as
  `mcp_tokens` does). Every write goes through the functions below.

Trigger `calendar_events_guard` (security invoker, like `todos_guard`): `family_id`, `series_id`,
`series_index` and `series_repeat` never change, `created_by` never changes for the API roles,
`updated_at = now()`. A trigger on attendees checks the member is in the event's family (23514)
and touches the event's `updated_at`, so the feed's `LAST-MODIFIED` moves.

Functions (security invoker, so RLS applies; each runs in one transaction):
- `create_calendar_events(p_rows jsonb, p_member_ids uuid[])`: inserts the 1–10 rows the API
  worked out and the same attendees on each, and returns the rows.
- `update_calendar_events(p_rows jsonb, p_member_ids uuid[])`: updates the given rows (each with
  its new values, worked out by the API) and, when `p_member_ids` isn't null, replaces their
  attendees. P0002 if any row isn't visible.
- Deletes need no function: one `delete … where id = any(…)` is atomic.

Feed functions (security definer):
- `create_calendar_feed(p_token_hash)` and `revoke_calendar_feed()` (`authenticated`): create
  revokes the caller's live link first, under an advisory lock per user.
- `calendar_feed(p_token_hash)` (granted to `anon` and `authenticated`): for a live feed whose
  owner is in a family, returns `{ familyName, events: [...] }` with only the events the owner
  attends that ended at most 90 days ago; for a revoked or unknown hash, null. It bumps
  `last_fetched_at` at most every 5 minutes.

Notifications:
- `notifications.kind` gains `event` and `event_added`; `notification_settings` gains
  `calendar_enabled boolean not null default true`.
- `claim_due_calendar_events(p_batch)` (`service_role` only): the R1 claim pattern with `FOR UPDATE
  SKIP LOCKED` and a 2-minute lease, returning each event with its attendees' user ids.
- Trigger `calendar_event_attendees_notify` (after insert, security definer): when the attendee's
  user isn't `app_private.current_user_id()`, inserts an `event_added` row for them with the event
  id, title, start, series length and the adder's display name, with
  `dedupe_key = event_added:<series_id>:<user id>` and `on conflict do nothing`, so a 10-day
  series notifies once.

SQL tests:
- `supabase/tests/calendar_rls.sql`: every member of the family, a kid included, can read and
  change every event and attendee; a member of another family and a user with no family see and
  change nothing; attendees must be in the family; `family_id`, `created_by` and the series
  columns can't change; the length check rejects a 32-day event and an end before the start;
  leaving the family removes you as an attendee; deleting the family deletes its events.
- `supabase/tests/calendar_save.sql`: creating a 10-row series inserts the rows and attendees
  together; a failing row (a bad title) inserts nothing; updating rows of another family is P0002.
- `supabase/tests/calendar_feeds.sql`: users never read `token_hash`; one live link per user;
  `calendar_feed` returns only the owner's attended events, nothing after revoke or regenerate, an
  empty list once the owner leaves the family, and works for `anon`.
- `notifications_rls.sql` gains: the claim function refuses `authenticated`; adding another member
  to a 5-day series queues one `event_added` row for them, adding yourself queues none.

**Done when** `npm run test:db` passes and `database.types.ts` is regenerated.

### Checkpoint

George applies `create_family_calendar` to the live project (Supabase MCP `apply_migration`, as in
earlier checkpoints). Nothing in the app uses it yet.

### C2: Domain and validation

Pure code, no Supabase, so it can run alongside C1. `src/lib/calendar.ts` already holds the month
and date helpers, which this reuses.

- `src/lib/family-calendar/types.ts`: `CalendarEvent` (with `seriesId`, `seriesIndex`,
  `seriesLength`, `seriesRepeat` and attendees), `SeriesRepeat` (`none` / `daily` / `weekly`),
  `EditScope` (`this` / `following` / `all`), `MAX_SERIES_LENGTH = 10`.
- `src/lib/validation/calendar-event.ts`: `calendarEventSchema` (title, notes, location, all-day,
  start and end as local date and time, attendees ≥ 1, `repeat: { kind, count }` with count 2–10)
  and `calendarEventEditSchema` (the same fields, all optional, plus `scope`), trimming as the
  expense schemas do.
- `src/lib/family-calendar/series.ts`:
  - `seriesRows(input, timeZone)`: the 1–10 rows to insert, each occurrence's local date and time
    turned into `starts_at` and `ends_at` with `zonedTimeToUtc`.
  - `editedRows(rows, edit, timeZone)`: the new values for the rows an edit touches. A new date
    moves each row by the same number of days; a new time sets that time on each row's own date;
    switching to all-day keeps each row's dates.
- `src/lib/family-calendar/notify.ts`: `notifyAt(event, now)` (30 minutes before, or 07:30 local on
  the first day; null when that has passed) and the two constants.

Tests: a daily series of 10 and a weekly series of 10 across the October DST change keep 09:00
local; a weekly series across the end of a month and of a year; an all-day event spanning three
days; a timed event across midnight; a 03:30 start on the spring change day; "this and following"
moving the time from the 4th of 6; a date shift on "all"; `notifyAt` for timed and all-day events,
for one already past, and for 07:30 on the day the clocks change.

**Done when** the unit tests pass and nothing imports the new code yet.

### C3: Repository and service

Follow `TodoRepository` and the reminders service:

- `CalendarRepository` in `src/lib/family-calendar/repository.ts`: `listBetween(from, to)` (rows
  with their attendees and series length), `get(id)`, `listSeries(seriesId)`, `create(rows,
  memberIds)`, `update(rows, memberIds?)`, `delete(ids)`. Acts as the caller.
- `CalendarFeedRepository`: `get()` (whether a live link exists and when it was last fetched),
  `create(tokenHash)`, `revoke()`, and `read(tokenHash)` on the anon client for the route.
- Supabase implementations in `src/lib/supabase/repositories/`, fakes in `src/test/fakes/`, both
  added to `Repositories` (shared files: rebase and re-check before merging).
- `src/lib/family-calendar/service.ts`: list a range (filtered by member), create, edit and delete
  with the three scopes. The scope picks the rows (`this`: the one; `following`: `series_index >=`;
  `all`: the series); `series.ts` works out their new values and `notify.ts` their `notify_at`,
  clearing `notified_at` when it changes. `following` on index 1 is the same as `all`.

**Done when** typecheck, lint and the repository and service tests pass.

### C4: API routes

Every route uses `withUser` and `requireFamilyFeature()`.

| Route | What |
| --- | --- |
| `GET /api/calendar/events?from=&to=&member=` | The events overlapping the range, at most 92 days. |
| `POST /api/calendar/events` | Create, with an optional repeat. |
| `GET /api/calendar/events/[id]` | One event with its attendees and its series' length, for the edit dialog. |
| `PATCH /api/calendar/events/[id]` | Edit with `scope` (`this` by default). |
| `DELETE /api/calendar/events/[id]?scope=` | Delete with a scope. |

Route tests: each action for a parent and a kid; another family's event is 404 on every id route;
a user without a family gets the family-required error; validation errors (no attendees, a repeat
of 11, an end before the start, a range over 92 days); "this", "following" and "all" on a 6-week
series change the expected rows.

**Done when** the route tests pass and `protected-routes.test.ts` lists the new routes.

### C5: The calendar page

Page `src/app/(app)/calendar/page.tsx`, components in `src/components/family-calendar/`. Nothing
links to it yet.

- A header with **Today**, previous and next, the period's title ("October 2026") and a
  **Month / Week / Agenda** `SegmentedControl`, kept in the URL (`?view=&date=`). Week is a
  placeholder until C6.
- **Month**: a 6-week grid starting on Monday, up to three event chips per day and "+2 more",
  which opens the day. Multi-day events span the days they cover, placed in lanes per week row by
  a pure, tested `layoutMonthWeek`. Today is marked.
- **Agenda**: the next 60 days grouped by day, with "Load more", and an empty state.
- An `AppDialog` form to add and edit: title, all-day switch, start and end, **Who's going**
  (member chips plus Everyone, **Just me** by default), **Repeat** (doesn't repeat / daily /
  weekly, with "for N days" or "for N weeks", 2–10, only when creating), location, notes. Editing
  or deleting an event in a series first asks **This event / This and following / All events**.
  The dialog shows "3 of 6" on a series.
- Clicking an empty day adds an event on that day. Optimistic saves with SWR `mutate`, rolled back
  on error; the previous and next ranges are prefetched.
- Add the page to `/dev/preview` with fake data.

**Done when** screenshots at 1280 px (light and dark), and creating a 6-week series, moving one
occurrence, changing the time of the following ones and deleting all show the right days.

### C6: Week view, filters, phones and the nav item

- **Week**: seven columns with an all-day row and an hourly grid (07:00–22:00 in view, scrolling to
  the rest), events placed by time, overlapping ones side by side (a pure, tested
  `layoutDayColumns`), and a "now" line. Clicking a slot adds an event at that hour.
- **Member chips** (Everyone, Me, each member) above the calendar, filtering by attendee, in the
  URL.
- **Phones** (< 768 px): Agenda is the default; Month shows dots instead of chips and lists the
  chosen day's events below the grid; Week shows three days at a time; the form opens as a
  full-height sheet.
- `NAV_ITEMS.calendar` (`/calendar`, "Calendar", a `CalendarDays` icon, `requiresFamily`), in
  **Planning** after To-dos.

**Done when** screenshots at 390 and 1280 px, and a user without a family doesn't see Calendar.

### C7: Event notifications

- The worker's tick also calls `claim_due_calendar_events`. For each event it inserts an `event`
  outbox row for each attendee (payload "Swimming", "At 18:00, in 30 minutes" or "Today, all day",
  `url = /calendar?event=<id>`, `tag = event:<id>`) and sets `notified_at`. An event that already
  ended is marked notified without sending.
- The worker formats `event_added` rows from C1's trigger ("Ana added you", "Visit my parents,
  Sat 1 Nov" or "… every week for 6 weeks").
- `kindAllowed` maps both kinds to `calendar_enabled`; **Settings → Notifications** gets a
  **Calendar** switch next to Reminders and To-dos, described as "30 minutes before your events,
  and at 07:30 on the day of all-day events".
- `/calendar?event=<id>` opens that event.

Tests with a fake clock: a timed event notifies each attendee once, 30 minutes before; an all-day
event notifies at 07:30 local; moving an event an hour later notifies again at the new time;
an event created 10 minutes before it starts doesn't notify; a worker that was down past the end
sends nothing; with **Calendar** off nothing arrives; adding yourself sends no "added you"; a
10-day series sends one "added you".

**Done when** the worker tests pass and an event starting 32 minutes from now notifies its
attendees on a real device.

### C8: The calendar feed

- `src/lib/family-calendar/ics.ts`: `toICalendar({ familyName, events, now })`, pure, with the
  escaping and folding described above.
- `GET /api/calendar/feed/[token]` (the path ends in `.ics`; strip it): no session, hashes the
  token and reads through `CalendarFeedRepository.read`. 404 for an unknown or revoked token, an
  empty calendar when the owner has no family. Exclude `api/calendar/feed` from the `proxy.ts`
  matcher, as `api/mcp` is, so a feed fetch doesn't refresh a session it doesn't have, and add it
  to `PUBLIC_ROUTES` in `protected-routes.test.ts` with a test that it never reads cookies.
- `GET / POST / DELETE /api/calendar/feed-link` (`withUser`): whether a link exists and when it was
  last fetched; create or regenerate (returns the token **once**); revoke.
- A **Subscribe** button on the calendar page opens a dialog: "Your events in other calendar apps",
  what the feed includes (only events you attend, read-only, updates every 15 minutes or so), the
  `webcal://` link with **Copy** and **Add to Calendar** (opens Apple Calendar on a Mac or iPhone),
  the short steps per app from the table above, **Regenerate** and **Turn off**. Once created, the
  dialog shows "Link created on …, last used …" instead of the link.

Tests: the feed for a timed event, an all-day event and a 3-week series, compared with snapshot
files and parsed back by a small test parser; folding of a long UTF-8 title; a kid's feed holds
only their events; regenerate makes the old token 404.

**Done when** Calendar on the Mac and on an iPhone subscribe through Tailscale, show the events,
and pick up an edit after a refresh.

### C9: MCP tools

`src/lib/mcp/tools/calendar.ts` with `defineTool`, on C3's service:

| Tool | Kind | What |
| --- | --- | --- |
| `list_events` | READ | Events between two dates (at most 92 days), optionally for one member. |
| `add_event` | CREATE | Title, start, end or all-day, attendees by name or "everyone" (the caller by default), an optional daily or weekly repeat of 2–10, location, notes. |
| `update_event` | UPDATE | Fields of an event, with `scope` for a series. |
| `delete_event` | DELETE | With `scope`. |

Update the tool-surface snapshot and `server.test.ts` (shared files: rebase and re-check before
merging).

**Done when** the snapshot is updated and a tool test shows a caller only ever sees and changes
their own family's events.

### Checkpoint: smoke test

With two parents and a kid: add "Swimming" weekly for 4 weeks for yourself and see it in everyone's
calendar in your colour; have the other parent add "Visit my parents" for the two of you and get
the "added you" notification; move one swimming occurrence and change the time of the following
ones; get the 30-minute notification on your device, and the 07:30 one for an all-day event;
subscribe to your feed on a Mac and an iPhone and see only your events, the shared one included;
edit an event in the app and see it change after a refresh; regenerate the link and see the old
one stop; ask Claude Code "what's on the family calendar this week?" through MCP.

## Not in this plan

- **Repeats that go on forever**, monthly and yearly repeats, every N days or weeks, several
  weekdays in one weekly series, and changing a series' length after it's created.
- **Google Calendar sync** in either direction, and **CalDAV**. Google can subscribe to the feed
  once the app has a public URL.
- **Importing** events from other calendars (an `.ics` file upload could come later).
- **Editing from other calendar apps**: the feed is read-only.
- **Private and busy-only events**, several calendars per family, and a kid permission for the
  calendar.
- A personal notification time, per-event notification times, and "don't notify me" per event.
- Drag to reschedule, a family-wide feed, and other time zones in the form.
- **Mobile calendar**: roadmap 9.8, on the same API.
