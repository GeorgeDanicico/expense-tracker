# Calendar plan (family hub phase 6)

This plan covers the family calendar: events with attendees and repeats, month, week and agenda
views, event notifications through the phase 5 worker, a private ICS feed for Apple Calendar and
Outlook, two-way sync with one Google calendar per member, and MCP tools. It replaces steps
6.1–6.8 in [family-hub-roadmap.md](family-hub-roadmap.md). Push webhooks (6.9) need a public
HTTPS URL and aren't planned.

## The design in one page

| Question | Answer |
| --- | --- |
| Who has a calendar? | **Every family has exactly one**, like the to-do board. There's no calendars table: each event belongs to a family through `events.family_id`. A user without a family has no calendar; the nav item is hidden and `/calendar` links to Settings → Family. |
| Who sees an event? | **Family** events (the default): every member. **Private** events: only the person who created them. Private events still go to that person's ICS feed and Google calendar. |
| Is there a kid permission? | **No**, the same as to-dos and reminders. Every member uses the calendar. |
| Who can change an event? | **Anyone in the family can add one.** Its **creator and any parent** can edit or delete it. A kid can't change a parent's event, but can change their own. |
| What's on an event? | Title (≤ 200), notes (≤ 2,000), location (≤ 200), all-day or a start and end time, a time zone (Europe/Bucharest), attendees (any family members, optional), visibility, a repeat, and up to two notification lead times. |
| How are events coloured? | By the first attendee's member colour, or the creator's when there are no attendees. Filter chips (Everyone, Me, each member) work like the to-do board's. |
| How does an event repeat? | Presets: **daily**, **weekly** on chosen weekdays, **monthly** on the same day or on "the second Tuesday", and **yearly**. Every N, ending **never**, **on a date** or **after N times**. It's stored as an RRULE limited to that subset, so it maps 1:1 to Google. |
| Changing one occurrence? | "This event", "This and following" or "All events". One occurrence is stored as an exception (moved, edited or cancelled). "This and following" ends the old series and starts a new one. |
| Where are occurrences worked out? | On the server, for the visible range only (`?from=&to=`), in local wall-clock time with the reminders' time-zone helpers, so "09:00 every Monday" stays 09:00 across DST. |
| Notifications? | Through the phase 5 outbox, to each attendee (or the creator when there are none), at each lead time before each occurrence: "Dentist starts in 30 min". There's a new **Calendar** switch in Settings → Notifications. |
| Feeds out? | A **private `webcal://` link per user** with every event they can see, repeats and exceptions included. The link's secret token is stored hashed and can be regenerated or revoked. Apple Calendar on a device with Tailscale can use it today. Google can't subscribe while the app isn't public. |
| Google? | **Each member can connect their Google account and pick one Google calendar** to mirror the family calendar, in both directions. Family events and their own private events go out to that calendar. Events created in it come in as family events created by them. Tokens are encrypted and never sent to the browser. |
| Feature flag? | None. As with to-dos and reminders, the page lands unlinked and the nav item lands last. Routes call `requireFamilyFeature()`. |
| MCP | `list_events` (a range), `add_event`, `update_event`, `delete_event`, acting as the caller, so the visibility rules apply. |

### Working out the dates

`src/lib/events/recurrence.ts`, pure and shared by the API, the worker, the ICS feed and the
Google sync:

- `parseRule` and `formatRule` handle only the preset subset: `FREQ`, `INTERVAL`, `BYDAY` (with
  an ordinal for monthly), `BYMONTHDAY`, `COUNT` and `UNTIL`. Anything else is reported as
  unsupported. A Google event with such a rule comes in **read-only** ("Edit this in Google
  Calendar").
- `occurrencesBetween(event, exceptions, from, to)` expands in local wall-clock time and then
  converts to UTC with `zonedTimeToUtc` from `src/lib/time-zone.ts`. A time skipped at the spring
  change moves forward; the repeated autumn hour uses the first instant. A monthly event on the
  31st follows RFC 5545 and **skips** months without one. That's what Google does, so the two
  stay identical; the form warns when you pick the 29th–31st.
- All-day events are plain dates with an exclusive end, and never convert time zones.

### Google sync

```
connect (browser) ── Google OAuth (calendar.events, offline) ──▶ /api/calendar/google/callback
   └─ refresh token encrypted (AES-256-GCM, GOOGLE_TOKEN_KEY) → google_connections

worker, every 2 minutes per connection
  ├─ import: events.list(syncToken) → for each changed Google event
  │    known link? update the app event if Google's `updated` is newer, else log a conflict
  │    new?        create an app event (family visibility, created by the connection's user) + link
  │    cancelled?  delete the app event (or cancel that occurrence)
  │    410 Gone →  full resync
  └─ export: claim this connection's outbox rows (written with each app change)
       insert / patch with If-Match: etag / delete → store the new etag on the link
       412 → re-read from Google, newest `updated` wins, the loser goes to event_conflicts
```

`event_google_links (event_id, connection_id, google_event_id, etag, google_updated)` lets two
parents mirror the same family calendar into two Google calendars without echo loops. The import
ignores changes whose etag matches the link's, because those are the app's own writes coming
back.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Calendars per family | One, no calendars table | Like the to-do board: filter chips cover "Ana's events" without another level of structure. |
| Who can edit | The creator and any parent | Unlike to-dos, events are often a parent's arrangements (appointments, trips). A kid deleting them would hurt more than a deleted card. |
| Private events | Creator only | Covers "my own appointment" without a sharing model. |
| Repeat format | A preset-only RRULE subset | Unlike reminders' structured columns: Google speaks RRULE, and a subset keeps the mapping exact. |
| Monthly on the 31st | Skip short months (RFC 5545) | It matches Google. Reminders clamp to the last day instead, and the form explains the difference. |
| Google scope | `calendar.events` on **one** chosen calendar per member | The smallest scope that works. Mirroring every calendar would push someone's work events onto the family calendar. |
| Google polling | Every 2 minutes on the worker | No public URL is needed. Webhooks (6.9) wait for one. |
| Conflicts | The newest `updated` wins, and the loser is logged in `event_conflicts` | Simple, and nothing is silently lost. |

## Tasks

The workflow is the same as phases 1–5: one task, one branch (`family/<id>-<slug>` from `main`),
one PR, one fresh agent per task, run one at a time, merged when reviewed and green. All SQL is
in C1; George applies the migration at the checkpoint.

| Task | What | Depends on |
| --- | --- | --- |
| C1 | Migration: events, attendees, exceptions, feeds, Google tables, outbox kind, RLS | — |
| — | **Checkpoint:** George applies the C1 migration | C1 |
| C2 | Domain: types, Zod schemas, `recurrence.ts` | — (can run alongside C1) |
| C3 | Repository and service: CRUD, edit scopes, range expansion | C1, C2 |
| C4 | API routes | C3 |
| C5 | Web calendar at `/calendar`: agenda, month and week views, event dialog (not linked yet) | C4 |
| C6 | Event notifications on the worker, and the Calendar switch | C3 |
| C7 | ICS feed and the Settings link | C3 |
| C8 | Nav item, filter chips, phone layout, Home "today" entry | C5, C6 |
| — | **Checkpoint:** George sets up the Google OAuth client and keys | C8 |
| C9 | Google connection: OAuth flow, encrypted tokens, calendar picker | C3, checkpoint |
| C10 | Google → app import on the worker | C9 |
| C11 | App → Google export and conflicts | C10 |
| C12 | MCP tools | C4 |
| — | **Checkpoint:** smoke test | C11, C12 |

### C1: Migration

Migration `create_calendar`:

- **`events`:**
  - `id`, `family_id` (cascade), `created_by` (set null), `title`, `notes`, `location`;
  - `all_day boolean`, `starts_at timestamptz`, `ends_at timestamptz` (timed events), `start_date date`, `end_date date` (all-day, exclusive end), with a check that exactly one pair is set and end ≥ start;
  - `timezone` (default Europe/Bucharest), `rrule text` (null for one-off events);
  - `visibility` (`family` / `private`), `lead_minutes integer[]` (≤ 2, presets 0, 10, 30, 60, 1440);
  - `series_id uuid` (links the parts of a split series), `read_only boolean` (an unsupported Google rule);
  - `next_notify_at`, `notify_locked_until`, `created_at`, `updated_at`.
- **`event_attendees (event_id, member_id)`:** members of the event's family only (trigger).
- **`event_exceptions (event_id, original_start, cancelled boolean, starts_at, ends_at, start_date, end_date, title, notes, location)`:** null fields mean "as in the series". Unique `(event_id, original_start)`.
- **`calendar_feeds (user_id unique, token_hash, created_at, last_fetched_at, revoked_at)`.**
- **`google_connections`:**
  - `user_id unique`, `google_email`, `calendar_id`, `calendar_summary`;
  - `refresh_token_ciphertext bytea`, `token_iv bytea`, `access_token_ciphertext`, `access_token_expires_at`;
  - `sync_token`, `next_sync_at`, `sync_locked_until`, `last_error`, `created_at`.
- **`event_google_links (event_id, connection_id, google_event_id, etag, google_updated)`:** unique `(connection_id, google_event_id)` and `(event_id, connection_id)`.
- **`google_outbox (connection_id, event_id, google_event_id, operation insert/update/delete, created_at, attempts, last_error, locked_until)`:** written by a trigger on events, attendees and exceptions for every connection that should see the event.
- **`event_conflicts (event_id, connection_id, losing_version jsonb, resolved_at, created_at)`.**
- **`notifications.kind`** gains `event`. **`notification_settings`** gains `calendar_enabled boolean default true`.

RLS (all `to authenticated`, on the F06 helpers):
- **events select:** same family, and `visibility = 'family'` or `created_by` is the caller.
- **events insert:** same family, with `created_by` the caller.
- **events update and delete:** the creator, or a parent of that family. Not allowed when `read_only` is set.
- **Attendees and exceptions:** through the parent event.
- **Feeds:** owner only. Registration and rotation go through `rotate_calendar_feed()` (security definer, returns the raw token once).
- **Google connections:** the owner can select non-secret columns only, through a view or column grants. Only the worker (secret key) reads the ciphertext.
- **Links, outbox and conflicts:** the worker only. A user can read their own conflicts through a view.
- **Worker claims:** `claim_due_events(p_batch)`, `claim_google_syncs(p_batch)` and `claim_google_outbox(p_batch)`, `FOR UPDATE SKIP LOCKED` with a 2-minute lease, `service_role` only.

SQL tests (`supabase/tests/calendar_rls.sql`, `calendar_google.sql`):
- A family event is visible to every member. A private one only to its creator.
- A kid can add events and change their own, but not a parent's. A parent can change anyone's.
- Another family sees and changes nothing.
- Attendees must be from the event's family.
- A read-only event can't be edited.
- Feeds and connections are owner-only, and the ciphertext is unreadable by `authenticated`.
- The outbox trigger writes one row per connection that can see the event, and none for a private event of someone else.

**Done when** `npm run test:db` passes and `database.types.ts` is regenerated.

### C2: Domain and validation

Pure code, no Supabase:
- `src/lib/events/types.ts`. The folder is `events`, not `calendar`, because `src/lib/calendar.ts` already exists and `@/lib/calendar` would become ambiguous.
- `src/lib/validation/event.ts` with `eventSchema` (timed or all-day, end after start, attendees, lead presets, repeat preset) and `eventScopeSchema` (`this` / `following` / `all`).
- `src/lib/events/recurrence.ts` as described above.

Tests:
- weekly on Monday and Wednesday across both DST changes;
- monthly on the 31st, which skips short months;
- monthly on the second Tuesday, and on the last Friday (`BYDAY=-1FR`);
- yearly on 29 February;
- `COUNT` and `UNTIL`;
- exceptions that move or cancel an occurrence;
- all-day events spanning months;
- an unsupported rule being reported;
- `formatRule(parseRule(x)) === x` for every preset.

### C3: Repository and service

- `EventRepository` (acting as the caller) and its fake.
- `src/lib/events/service.ts`:
  - `listEvents(from, to)` returns occurrences with series ids and original starts;
  - `createEvent`;
  - `updateEvent(id, occurrence, scope, input)`: "this" writes an exception, "following" sets `UNTIL` on the old series and creates a new one with the same `series_id`, and "all" updates the series;
  - `deleteEvent(id, occurrence, scope)`.
- Every write recomputes `next_notify_at`.
- A range is limited to 100 days.

**Done when** the service tests cover all three scopes on a weekly series, edits to a single
event, and a range across a DST change.

### C4: API routes

| Route | What |
| --- | --- |
| `GET /api/calendar/events?from=&to=` | Occurrences in the range, with attendees (name, colour, `avatarUrl`). |
| `POST /api/calendar/events` | Create. |
| `PATCH / DELETE /api/calendar/events/[id]?occurrence=&scope=` | Edit or delete with a scope. |

Route tests:
- a parent, a kid editing their own event (200) and a parent's event (403);
- another family's member (404), no family (404), the flag off (404);
- validation errors, and a range over 100 days (422);
- editing a read-only Google event (409).

### C5: The web calendar

- Page `src/app/(app)/calendar/page.tsx`, components in `src/components/calendar/`, built by hand on CSS grid with no calendar library (keeps the bundle small). **Agenda** is the default on phones; **month** and **week** are on desktop.
- An event dialog with title, all-day, start and end, attendees, visibility, repeat preset, lead times, location and notes. Editing a repeating event asks for the scope ("This event / This and following / All events").
- SWR keyed by the visible range, with the next and previous ranges prefetched. Optimistic create and edit.
- Added to `/dev/preview` with fixtures.

**Done when** there are screenshots at 390 and 1280 px (light and dark), and creating, moving
and cancelling one occurrence of a weekly event works in the preview.

### C6: Event notifications

- The worker claims events whose `next_notify_at` has passed (`claim_due_events`), the same way
  as reminders. It queues one `event` outbox row per recipient: the attendees, or the creator
  when there are none. The dedupe key is `event:<id>:<occurrence start>:<lead>`. Then it
  advances `next_notify_at` to the next notify time across the following occurrences.
- The payload is "Dentist" with "Starts in 30 min · 16:00", `url /calendar?event=<id>&at=<start>`,
  `tag event:<id>:<start>`. Delivery checks `calendar_enabled`.
- Settings → Notifications gets the **Calendar** switch.

**Done when** worker tests show:
- a weekly event with 30 min and 1 day notifies twice per occurrence;
- a cancelled occurrence doesn't notify;
- a private event notifies only its creator;
- a week of downtime sends one notification, not a burst.

### C7: ICS feed

- `GET /api/calendar/feed/[token].ics`, authenticated by the token alone. It's hashed and looked up through a security-definer function and rate-limited. It returns `text/calendar` with every event the token's owner can see, with `RRULE`, `EXDATE` and overriding `VEVENT`s with `RECURRENCE-ID`, `VTIMEZONE` for Europe/Bucharest, and stable `UID`s.
- Settings → Calendar shows the `webcal://` link, copy, regenerate (with a warning) and revoke, plus Apple Calendar instructions.
- The proxy matcher must let the feed through without a session.

**Done when** the output passes an iCalendar validator in tests, Apple Calendar subscribes on a
Tailscale device in the smoke test, and a revoked token gets 404.

### C8: Nav item, chips, phones and Home

- `NAV_ITEMS.calendar` (`/calendar`, "Calendar", `CalendarDays`, `requiresFamily`) in the
  Planning section.
- Filter chips (Everyone, Me, each member) kept in the URL.
- On phones, agenda only, with a view switcher hidden. The event dialog is a full-height sheet
  (`fullHeightOnPhone`).
- Home gets a "Today" line with the next two events.

**Done when** there are screenshots at 390 and 1280 px, and a user without a family doesn't see
the item.

### Checkpoint: Google setup

George, in the Google Cloud project that already handles Google sign-in:
- Enable the **Google Calendar API**.
- Create a **Web** OAuth client for the app, with the redirect URI
  `https://<app origin>/api/calendar/google/callback`.
- Add the `calendar.events` scope to the consent screen, and **publish it "In production"**
  (unverified is fine under 100 users). In "Testing", refresh tokens expire after 7 days.

Add to `/etc/expense-tracker/.env.production`:
- `GOOGLE_CALENDAR_CLIENT_ID`;
- `GOOGLE_CALENDAR_CLIENT_SECRET`;
- `GOOGLE_TOKEN_KEY`, 32 random bytes in base64, generated once with `openssl rand -base64 32` and kept only on the VPS.

### C9: Google connection

- `GET /api/calendar/google/connect` starts the OAuth flow, with `access_type=offline`,
  `prompt=consent`, a signed `state` tied to the session, and PKCE.
- The callback exchanges the code, encrypts the refresh token (AES-256-GCM, `src/lib/crypto.ts`,
  key from `GOOGLE_TOKEN_KEY`) and stores the connection.
- Settings → Calendar → Google: connect, pick the Google calendar from `calendarList` (only ones
  the user can write to), show the last sync and errors, and disconnect. Disconnecting revokes
  the token at Google and deletes the connection, links and outbox rows.

**Done when** tests use a fake Google client, and a real connect and disconnect works in the
smoke test. The token never appears in responses or logs.

### C10: Google → app import

- The worker claims connections whose `next_sync_at` has passed and refreshes the access token
  when it's expired. It calls `events.list` with `syncToken` (the first sync uses `timeMin` of
  one year ago with `singleEvents=false`) and applies the changes as described in "Google sync".
  A 410 triggers a full resync; a 401 or `invalid_grant` marks the connection as needing a
  reconnect, shown in Settings.
- Recurring Google events: a supported RRULE becomes a series, and instance changes become
  exceptions. An unsupported one becomes a `read_only` series.
- Echo loops are prevented by comparing etags with the link.

**Done when** tests with a recorded fake Google show:
- a create, an edit, a delete, an edited instance and a cancelled instance come in;
- a 410 resyncs;
- the app's own writes aren't re-imported;
- an unsupported RRULE comes in read-only.

### C11: App → Google export and conflicts

- The worker claims `google_outbox` rows and calls `insert`, `patch` (with `If-Match`) or
  `delete`, storing the new etag on the link. A 412 re-reads the Google event: the newest
  `updated` wins, and the losing version goes to `event_conflicts`. A 404 on delete counts as
  done. Retries use backoff, then the row is `failed` and shown in Settings.
- Settings → Calendar → **Conflicts** lists unresolved conflicts with "Keep this" or "Use the
  other one".

**Done when** round-trip tests show:
- app → Google → app with no loop;
- two parents connected to two Google calendars each get the family events once;
- a conflict on both sides is logged and resolvable.

### C12: MCP tools

`src/lib/mcp/tools/calendar.ts`:
- `list_events` (READ): a range of at most 31 days.
- `add_event` (CREATE): title, start, end or all-day, attendees by name, a repeat preset, lead times.
- `update_event` (UPDATE): with a scope.
- `delete_event` (DELETE): with a scope.

They're hidden while the family flag is off. Update the tool-surface snapshot and
`server.test.ts`.

**Done when** the snapshot is updated, and a tool test shows the visibility and edit rules hold.

### Checkpoint: smoke test

With three accounts:
- A parent adds a weekly family event with a kid as attendee and a 30 min lead time. The kid
  sees it and gets the notification.
- The kid can't delete it, but a second parent can move one occurrence.
- A private event stays hidden from the others.
- Apple Calendar subscribes to the `webcal://` link.
- A parent connects Google: family events appear in the chosen Google calendar within 2 minutes,
  an event added in Google appears in the app, and editing the same event on both sides
  produces a logged conflict.
- Claude lists this week's events through MCP.

## Not in this plan

- **Push webhooks from Google** (6.9): they need a public HTTPS URL.
- **CalDAV and iCloud sync:** the Mac calendar gets the events through Google, or through the
  ICS feed.
- **Free/busy, invitations to people outside the family, and RSVP.**
- **Mirroring more than one Google calendar per member.**
- **The mobile calendar:** roadmap 9.8.
