# Family hub roadmap

Prepared 15 October 2026, updated 23 October 2026. This plan grows Simple Ledger from a single-user expense tracker into a family app: families and roles, profile pictures, safer MCP access, a to-do board, reminders with browser and email notifications, a shared calendar with an ICS feed and two-way Google Calendar sync, statement import, AI features (still open), cars, houses, smart-home devices, and native iOS/Android apps built with Expo. Everything up to and including AI ships on the web before the native apps start (see "Order before the native apps").

Every numbered step below is meant to be **one pull request** that can be reviewed on its own, merged, and deployed without breaking what already works. Unfinished modules stay hidden behind a flag, so `main` is always shippable.

## Where the app is today

These facts shape the plan:

- **Single-owner data model.** Every table (`expenses`, `expense_tabs`, `investment_*`, `net_worth_*`) has a `user_id` column, and its RLS policy is `auth.uid() = user_id`. There is no idea of a group yet.
- **`profiles` already exists** (`id`, `email`, `currency`). Display name and avatar can go there.
- **The browser never talks to Supabase directly.** Next.js route handlers in `src/app/api/**` use `withUser` (`src/lib/http/route.ts`), which reads the user from **cookies**. The Supabase keys are server-only. A native app can't use cookies the same way, so the API has to accept a bearer token as well (step 1.2).
- **The domain logic is already separate from the UI.** Zod schemas (`src/lib/validation`), types and calculations (`src/lib/expenses`, `src/lib/net-worth`, `src/lib/investments`) don't depend on Chakra, so the Expo app can reuse them.
- **MCP signs in with Basic auth.** MCP clients send the user's real email and password on every request (`src/lib/mcp/auth.ts`), and MCP is on for everyone. Phase 3 replaces this with per-user tokens and a Settings switch.
- **The production VPS is reachable only over Tailscale.** This matters for phones, which need Tailscale, and for Google Calendar push webhooks, which need a public HTTPS URL (see "Decisions you need to make").
- **Tests:** Vitest for units and routes, plus SQL RLS tests in `supabase/tests` run by `npm run test:db`. The only workflows are deploy and VPS notification. Nothing runs checks on pull requests yet.

## Architecture decisions (recommended)

1. **Keep Next.js as the web app and the backend. Add Expo as a second client for iOS and Android.** Don't rewrite the web app in Expo or React Native Web. The Chakra UI, the dashboards and the PWA keep working, and both clients call the same API with the same validation. The two apps share code through a workspace package, not through UI components.
2. **One family per user.** A user creates a family or joins one with an invite code or link. Nobody belongs to more than one family, so there is no family switcher and no "active family" to pass around: the caller's family follows from their membership. Data for the new modules (to-dos, calendar, cars, houses, devices) belongs to the family and is checked by RLS through a few SQL helpers.
3. **Parents see the whole family's finance, read-only.** Parents see every member's expenses, investments and net worth, including each other's. They can't change data that isn't theirs: only the read policies widen, and insert, update and delete stay owner-only. Kids see only their own finance, plus the rest of the family's if a parent turns on the "Family finance" permission for them. MCP keeps working on the caller's own data only.
4. **Two roles, `parent` and `kid`, plus a creator flag.** The member who created the family is its creator, and only the creator can remove members or delete the family. Parents have every permission. Each kid has their own permission set, chosen by a parent and changeable at any time, so two kids in one family can see different things. Kids can't leave the family on their own, and they're never promoted to parent. Grandparents and other relatives are out of scope for now (step 13.1).
5. **Smart devices go through Home Assistant, not each vendor.** Roborock has no official public API, and air purifiers each use a different cloud. Home Assistant already supports Roborock, Xiaomi, Philips, Dyson and most others. The app stores one Home Assistant URL and token per family, reads entity states, and calls services.
6. **Scheduled and background work runs in a worker, not in a request handler.** It's a small Node process in the same Docker image (`node dist/worker.js`), built in phase 5. It delivers reminders and notifications, and runs Google Calendar sync with Google's incremental `syncToken`, polling every couple of minutes at first; push webhooks come later if the app becomes publicly reachable.
7. **Feature flags.** An env flag hides each unfinished module's navigation and API until it's ready. This is separate from kid permissions, which decide what a finished module shows to each kid.
8. **Supabase sits behind interfaces.** Routes, MCP tools and use cases talk to storage through repository interfaces (`ExpenseRepository`, `FamilyRepository`, …) and to auth through `AuthService` / `AuthAdmin`. Supabase is one implementation, chosen in two composition roots, and a lint rule stops Supabase imports from leaking elsewhere. New SQL identifies the caller through `app_private.current_user_id()` instead of `auth.uid()`. Moving to another Postgres host or auth provider then means writing new implementations, not touching the app. The frontend already only talks to `/api`.
9. **Notifications go through channels.** Anything that notifies (reminders, to-do assignments, events) writes to one outbox, and the worker delivers it to each of the user's channels: Web Push and email on the web, Expo push once the phone app exists. A new channel needs no change to the features that notify.

## Phase 0: Safety net and rename

**Status: done** (merged in [#19](https://github.com/GeorgeDanicico/expense-tracker/pull/19)).

| Step | What | Done when |
| --- | --- | --- |
| **0.1** | **CI for pull requests**: a GitHub workflow running `lint`, `typecheck`, `test` and `test:db` (a Supabase CLI local stack) on every PR. | A PR shows green checks, and a deliberately broken RLS test fails CI. |
| **0.2** | **Central brand constant**: move "Simple Ledger" from `brand.tsx`, `manifest.ts`, page titles, email copy and MCP server info into one `src/lib/brand.ts`. The name doesn't change yet. | `grep "Simple Ledger"` hits only `brand.ts` and the README. |
| **0.3** | **Rename** the product to the new name: UI, manifest, icons, README, MCP `serverInfo`. Rename the repo, Docker image and domain in a separate ops change. | The app shows the new name. No routes or data change. |
| **0.4** | **Navigation that scales**: today's nav has 5 items. Group them into sections (Finance, Family, Home), keeping the current pages under Finance. This is a structural change with no new features. | Existing pages work. Mobile tab bar plus More sheet still pass the layout screenshots. |

## Phase 1: Foundations (families, roles, permissions, a native-ready API)

The step-by-step task breakdown is in [family-phase-1-tasks.md](family-phase-1-tasks.md), one agent and one PR per task. It starts with **step 0 (R01–R10)**, which moves the existing Supabase code behind repository and auth interfaces (decision 8) and runs alongside the SQL-only step 1.1.

**Status (16 October 2026): done.** All 59 tasks are merged, with the family migrations on the live database, and the family hub is documented in the README. It stays behind `FAMILY_ENABLED` until the flag is turned on in production (set `SUPABASE_SECRET_KEY` and `FAMILY_ENABLED=true`, then run the smoke test in F48); removing the flag is a later follow-up.

### Who can do what

| Action | Creator | Parent | Kid |
| --- | --- | --- | --- |
| Create a parent or kid invite code or link | ✓ | ✓ | ✗ |
| Create a kid account with a username | ✓ | ✓ | ✗ |
| Change a kid's permissions, reset a kid's password | ✓ | ✓ | ✗ |
| See every member's finance (read-only) | ✓ | ✓ | Only with "Family finance" |
| See when members were last active | ✓ | ✓ | ✗ |
| Remove a member | ✓ | ✗ | ✗ |
| Delete the family | ✓ | ✗ | ✗ |
| Leave the family | See open decisions | See open decisions | ✗ (a creator removes them) |
| See their own permissions | ✓ | ✓ | ✓ |

**Kid permissions** are set per kid, per module, with presets so parents don't tick every box by hand:

| Module | Levels | Default for a new kid |
| --- | --- | --- |
| Expenses, Investments, Net worth (the kid's own data) | off / on | Expenses on, the rest off |
| Family finance (the other members' data) | off / view | off |
| To-dos, Calendar (phases 4 and 6) | off / view / edit | edit |
| MCP (phase 3) | off / on | off |
| Cars, Houses, Devices (phases 10 and 11) | off / view / edit | view |

Parents always have every permission, and no one can restrict a parent. A module that's off is hidden from the navigation **and** refused by the API with 403. Hiding the navigation alone isn't enough. Reminders (phase 5) aren't a module here: every member has them. Statement import (phase 7) follows Expenses.

### Steps

| Step | What | Done when |
| --- | --- | --- |
| **1.1** | **Families schema**: `families (id, name, creator_id, created_at)`, `family_members (id, family_id, user_id unique, role parent/kid, joined_at, last_active_at)` and `member_permissions (member_id, module, level)`. `user_id` is unique, so a user is in at most one family. Add the SQL helpers `private.my_family_id()`, `private.is_family_parent(fid)`, `private.is_family_creator(fid)` and `private.member_can(module, level)` (security definer, `search_path` pinned, so the policies on `family_members` don't recurse). Members can read their own family and its members. Every change goes through API routes, which check the role. No UI. | SQL tests prove that: a non-member can't read a family; a user can't join a second family; a kid can't change their own row or permissions; a parent who isn't the creator can't remove anyone; the creator is always a parent member. |
| **1.2** | **Bearer-token auth in `withUser`**: accept `Authorization: Bearer <supabase access token>` as well as cookies, and build the Supabase client from the token. Cookie behaviour doesn't change. Basic auth for MCP stays as it is. | Route tests cover cookie, bearer, an expired bearer (401) and a bearer for another user's data (404 or empty). |
| **1.3** | **Permissions module**: the module and level tables above in `src/lib/permissions.ts`, with a `can(member, module, level)` function and presets ("Young kid", "Teen"), mirrored by `private.member_can`. A `withPermission(module, level)` route wrapper and a `useCan()` hook. Apply it to the existing finance routes and navigation: a user with no family, or a parent, can do everything; a kid only gets what their permissions allow. | The matrix is snapshot-tested. A kid with Investments off gets 403 from the investments API and doesn't see it in the navigation. Users without a family see no change. |
| **1.4** | **Create and join**: "Create a family" (name) makes the caller its creator and a parent. `family_invites (family_id, code_hash, role, permissions, created_by, expires_at, used_at, used_by, revoked_at)`. A parent creates a single-use code: 8 characters with no lookalikes (no 0/O, no 1/l). It also works as the link `/join/<code>`. The role and, for kids, the permissions are fixed when the code is created. Parent codes expire after 48 hours, kid codes after 7 days. Failed attempts are rate-limited. The join page shows the family name, who invited you, and what the parents will be able to see ("your expenses, investments and net worth"). It refuses if you're already in a family. Add **Settings → Family**, the family list grouped into Parents and Kids, and **Settings → My permissions**. Kids also see what their parents can see about them. | A second account joins as a parent with a code, a third joins as a kid with a link, and each sees the right permissions page. Expired, used and revoked codes are refused. |
| **1.5** | **Kid accounts created by a parent**: the parent picks a username and a temporary password, and the server creates the user with the Supabase **secret key**. The app only has the publishable key today, so this adds a new server-only env variable, used in one small module. The kid's auth email is generated on a reserved, non-routable domain (check that Supabase Auth accepts it). `profiles.username` is unique and lowercase. The sign-in form accepts "email or username", and the server looks up usernames, so kids' emails are never sent to the browser. `app_metadata.must_change_password` sends the kid to a change-password screen on first sign-in. A parent can reset a kid's password, which turns the flag on again. Later, the kid can add a real email in Settings, with confirmation; the address replaces the generated one, and email password reset starts working. | A parent creates a kid, the kid signs in with the username, is forced to change the password, and lands in the app with the right permissions. Adding an email works. Route tests show only parents can create kids or reset their passwords. |
| **1.6** | **Family settings for parents**: each member's role, permissions and last active time. To keep `last_active_at` accurate, `withUser` updates it at most every 5 minutes; `last_sign_in_at` misses sessions that refresh silently. Add a per-kid permission editor, and a list of pending invites with revoke. **Creator only:** remove a member, and delete the family. Deleting requires typing the family name. It deletes the family, its members, invites, permissions and, later, all family-owned module data. Personal finance is never touched. `account_notices (user_id, kind, family_name, created_at, seen_at)` shows a one-time popup on the next sign-in: "The family X was deleted" or "You were removed from X". A removed kid keeps a normal standalone account, with their own data and no restrictions. | Permission changes take effect on the kid's next request. A non-creator parent gets 403 on remove and delete. After deletion, every former member sees the popup once, keeps their own finance, and sees no family pages. |
| **1.7** | **Family finance view**: widen only the **select** policies on `expenses`, `expense_tabs`, `investment_*` and `net_worth_*` to "the owner, or a parent in the owner's family, or a kid in that family with Family finance on". Insert, update and delete stay owner-only. Before widening, add an explicit owner filter to every finance read in `src/lib/data`; today only about 15 of 27 queries filter by `user_id`, and the rest rely on RLS. Without this, a parent's own lists would silently start including everyone's rows, and so would MCP. Give `get_expense_dashboard` an optional `p_user_id` (still `security invoker`). Add a "Viewing: Me / <member> / Family" picker to the finance pages. Members can use different currencies (`profiles.currency`), so "Family" totals are grouped by currency; there is no FX conversion yet. | A parent sees a kid's and the spouse's expenses but gets 404 or 403 trying to edit them. A kid with Family finance off sees only their own data. A user's own pages and MCP show exactly what they showed before. SQL tests cover every widened table. |

> Kids are real accounts with a username, created by a parent or joined with a code. Grandparents and other relatives (step 13.1) are out of scope for now.

## Phase 2: Profiles and avatars

**Status (22 October 2026): done except display-name editing.** Member colours shipped in [#88](https://github.com/GeorgeDanicico/expense-tracker/pull/88) and [#92](https://github.com/GeorgeDanicico/expense-tracker/pull/92). Avatars were replaced by [avatars-plan.md](avatars-plan.md) (tasks A1–A6, merged in #94–#100): a private bucket, uploads re-encoded by the server, and images served through `GET /api/avatars/<userId>/<uuid>`. The steps below are kept as first written; 2.2 differs from what shipped.

| Step | What | Done when |
| --- | --- | --- |
| **2.1** | `profiles.avatar_path` and `profiles.color` (used for calendar and to-do chips). `display_name` and `username` already arrive in phase 1 (task F04). A Settings → Profile form for editing the display name and color. **Still open: editing your own display name.** | Members can change their own display name, and the family list shows it. |
| **2.2** | **Avatar upload**: a Supabase Storage bucket `avatars`. Path `user_id/<uuid>.webp`. RLS lets you write your own folder and lets family members read each other's. Resize on the client before upload, and send it through a signed upload URL from the API. | Upload, replace and remove work. A non-member gets 403 on the object. |
| **2.3** | A shared `<Avatar>` component with an initials fallback, used in the sidebar, the family list and later in to-dos and the calendar. | Shows up in the UI gallery (`/dev/ui`). |

## Order before the native apps

Everything in phases 3–8 ships on the web before the Expo work in phase 9 starts. The order:

1. **Phase 3, MCP access tokens.** Small, independent, and it stops MCP clients from holding your real password.
2. **Phase 4, the to-do board.** Already planned, now as a kanban board.
3. **Phase 5, the worker, notifications and reminders.** The background worker and the notification channels are built once here, then reused by the calendar, to-dos and later the phone.
4. **Phase 6, the calendar.** The app's own calendar, an ICS feed for other calendar apps, then two-way Google sync on the worker from phase 5.
5. **Phase 7, statement import.** CSV first, then PDF.
6. **Phase 8, AI.** Still an open discussion; nothing is planned in detail yet.

Display-name editing (the rest of 2.1) is small and can slot in anywhere.

Each phase gets its own task breakdown (like [family-phase-1-tasks.md](family-phase-1-tasks.md) and [avatars-plan.md](avatars-plan.md)) before its work starts.

## Phase 3: MCP access tokens and a per-user switch

Today MCP clients sign in with **Basic auth carrying your real email and password** (`src/lib/mcp/auth.ts`). The server signs in with them and caches the session in memory. This phase replaces that with personal access tokens, and makes MCP something each user turns on in Settings. MCP keeps working on the caller's own data only (decision 3).

**Status (23 October 2026): planned** in [mcp-tokens-plan.md](mcp-tokens-plan.md) (tasks M1–M8), which settles how a token acts as its user: the server opens a real Supabase session for the token's owner through the admin API, so RLS keeps applying and no signing key is needed.

| Step | What | Done when |
| --- | --- | --- |
| **3.1** | **Schema**: `profiles.mcp_enabled` (default `false`) and `mcp_tokens (id, user_id, name, token_hash, prefix, created_at, last_used_at, expires_at, revoked_at)`. A token is 32 random bytes with a short recognisable prefix. It's shown once at creation and only its SHA-256 hash is stored. Users read and revoke only their own tokens; only the server creates them and sets `last_used_at`. Add an **MCP** kid permission (off / on, default off). | SQL tests: a user can't read or revoke another user's tokens, and a kid can't turn MCP on while the permission is off. |
| **3.2** | **Token auth on `/api/mcp`**: `Authorization: Bearer <token>`. The server hashes it, looks it up, checks it isn't revoked or expired, checks `mcp_enabled` (and the kid permission), and then acts **as that user so RLS still applies**. How the server gets a user session from a token (minting a short-lived user JWT with the project's signing key, or another route behind `AuthService`) is settled in this phase's task plan. Failures are rate-limited per token prefix and IP, as today. Basic auth keeps working alongside during the switch. | Route tests: a valid token works; revoked, expired, unknown, MCP-off and kid-without-permission tokens get 401 or 403; one user's token never sees another user's data. |
| **3.3** | **Settings → AI assistants (MCP)**: the on/off switch, create a token (name, expiry: 30 days, 90 days, 1 year or never), copy it once, see each token's last use, and revoke. Ready-to-paste setup for Claude Code and Claude Desktop. Turning MCP off refuses every token immediately without deleting them. | Screenshots at 390 and 1280 px. A token created on the page works in Claude Code. |
| **3.4** | **Remove Basic auth** from `/api/mcp`, once your own clients use tokens. The in-memory session cache goes with it. | A Basic auth request gets 401. The README describes token setup only. |
| **3.5** | (Later, needs a public HTTPS URL) **OAuth 2.1** following the MCP authorization spec, so claude.ai connectors can connect. Those connect from Anthropic's servers, so they can't reach a Tailscale-only app. | claude.ai connects through the consent screen, and the connection shows in the token list. |

## Phase 4: Family to-do board

To-dos work like a GitHub project board: **three fixed columns, "To do", "In progress" and "Done"**, with cards dragged between and within columns.

| Step | What | Done when |
| --- | --- | --- |
| **4.1** | **Schema**: `todo_boards (family_id, name, visibility: family / parents / private, created_by)`, with a "Family" board created for every family. `todos (board_id, title, notes, status: todo / in_progress / done, position, assignee_id, due_date, created_by, completed_at, completed_by)`. `position` is a fractional-index text key (the `fractional-indexing` approach), so moving a card rewrites only that card's row. `completed_at` and `completed_by` are set when a card enters Done and cleared when it leaves. RLS: kids with To-dos on see `family` boards and their own private ones. | SQL tests cover kid (To-dos off, view and edit), parent and other-family access. |
| **4.2** | API routes, validation and data layer, following the existing `expense-tabs` pattern. A **move endpoint** takes the new status and the neighbouring cards, and the server computes the position. Kids with To-dos at view may only move cards assigned to them; at edit they can also add, edit and move any card on boards they can see. | Route tests per role and permission level, including two moves racing for the same slot. |
| **4.3** | **Web board** with `dnd-kit`: drag between and within columns, **keyboard dragging** for accessibility, optimistic moves that roll back on error. Quick add at the top of each column, assigning a member (shown by avatar), a due date, and filters for "Mine", "Due today" and "Overdue". At 390 px the three columns don't fit side by side, so phones show one column at a time behind tabs, and each card has a "Move to…" menu. | Screenshots at 390 and 1280 px. Dragging works with mouse, touch and keyboard. |
| **4.4** | MCP tools `list_todos`, `add_todo` and `move_todo`, with roles and kid permissions enforced. | The tool-surface snapshot is updated. |
| **4.5** | (Optional) Recurring to-dos (`rrule`), such as "take out the trash every Tuesday". | The next card is created in To do when the current one reaches Done. |

## Phase 5: Background worker, notifications and reminders

**Reminders** are personal nudges that aren't calendar events: "pay the rent", "pay the taxes", "renew the insurance". Most repeat. The phase also builds what any scheduled notification needs: a background worker and delivery channels. In the browser those channels are **browser notifications (Web Push) and email**; the phone's push notifications join as a third channel in phase 9.

### Who can do what with reminders

Every reminder has a **recipient** (`user_id`, who gets the notifications) and a **creator** (`created_by`). Usually they're the same person.

| | For yourself | Parent → other parent | Parent → kid |
| --- | --- | --- | --- |
| **Who can create** | Everyone | Any parent | Any parent |
| **Who sees it** | Only you | The creator and the recipient | The kid and every parent |
| **Mark done, snooze** | You | Recipient | Kid |
| **Turn off its notifications** | You | Recipient | Kid |
| **Edit, delete** | You | Creator and recipient | Creator only |

- Kids can't create reminders for anyone else. A kid's own reminders stay private, also from parents.
- When a kid turns off notifications on a reminder a parent set, the parent sees a muted icon on it. It still shows as overdue when it isn't done, so muting never hides a missed reminder.
- Reminders aren't a kid permission module: every member has them.

| Step | What | Done when |
| --- | --- | --- |
| **5.1** | **Worker process**: add `worker.ts` to the same image as a second container on the VPS, with a job lock table so two workers don't overlap. It only logs at first. | The worker heartbeat appears in `/health` or the logs. |
| **5.2** | **Notification layer**: a `notifications` outbox `(user_id, kind, payload, send_at, sent_at, attempts, last_error)` that the worker delivers, and `notification_channels (user_id, kind: web_push / email / expo, endpoint, keys, created_at, last_success_at, disabled_at)`. **Web Push** with VAPID keys through the existing PWA's service worker. **Email** through a sending provider (see "Decisions you need to make"). **Settings → Notifications**: turn on browser notifications for this device, email on or off, and a "send a test" button. Web Push needs the app on HTTPS, and on iPhone it only works once the app is added to the home screen. | A test notification arrives in the browser and by email. A dead Web Push subscription (410 from the push service) is disabled automatically. |
| **5.3** | **Reminders schema**: `reminders (family_id, user_id, created_by, title, notes, due_at, timezone, rrule, lead_times, channels, notifications_muted, snoozed_until, notify_creator_when_overdue, expense_template)` and `reminder_completions (reminder_id, occurrence_at, done_at, done_by, expense_id)`. `lead_times` holds when to notify, for example 3 days before and on the day. RLS follows the table above, and a trigger lets the recipient change only the done, snooze and mute fields of a reminder someone else created. | SQL tests cover every cell of the table above, plus another family's members. |
| **5.4** | **Reminders API**: create (with a recipient picker for parents), edit, delete, mark done (moves a repeating reminder to its next occurrence), snooze (an hour, until tomorrow, or a custom time) and mute. | Route tests per role for every action in the table. |
| **5.5** | **Reminders page**: "Upcoming", "Overdue" and "Done". A form with recurrence presets (once, monthly, yearly, custom), lead times and channels. Parents see a "Set by me" view with each reminder's status: done, snoozed, overdue or muted. | Screenshots at 390 and 1280 px. |
| **5.6** | **Delivery**: the worker turns due lead times into outbox rows in the recipient's timezone. Muted reminders send nothing. With `notify_creator_when_overdue` on (off by default, only for reminders set for someone else), the creator is told when it's overdue: "Ana hasn't marked *homework* done". | A monthly reminder notifies 3 days before and on the day, then moves to the next month when marked done. Tests cover month ends (31st → 30th) and DST in Europe/Bucharest. |
| **5.7** | (Optional) **Log as expense**: a reminder can carry an expense template (amount, currency, category, subtype). Marking it done offers to add that expense, pre-filled, for the recipient. | Ticking "Pay rent" adds the rent expense in one confirm. |
| **5.8** | **Notifications from other modules** on the same layer: "a to-do was assigned to you" (phase 4), and the creator alert from 5.6. | Assigning a card to someone notifies them through their channels. |
| **5.9** | MCP tools `list_reminders`, `add_reminder` and `complete_reminder`, on the caller's own reminders only. | The tool-surface snapshot is updated. |

## Phase 6: Family calendar, calendar feeds and two-way Google sync

The app gets its own family calendar. Other calendars connect in two ways:
- **An ICS feed out**: a private `webcal://` link per user that Apple Calendar, Outlook or any other calendar app subscribes to. It's read-only and works for the Mac calendar without any Apple API.
- **Two-way Google Calendar sync**, run by the worker from phase 5.

Two-way sync with iCloud through CalDAV isn't planned. It needs app-specific passwords and breaks easily, and a Mac calendar that already syncs with Google gets the app's events through Google anyway.

| Step | What | Done when |
| --- | --- | --- |
| **6.1** | **Schema**: `calendars (family_id, name, color, visibility)`, `events (calendar_id, title, starts_at, ends_at, all_day, timezone, rrule, location, notes, attendee member ids, reminder lead times)`, `event_exceptions` for edited or cancelled recurring instances. Store `timestamptz` plus an IANA timezone. | SQL RLS tests per role and kid permission level. |
| **6.2** | API plus a **web calendar** with month, week and agenda views. Events are coloured by member. Expand recurrences server-side for the visible range. | Create, edit and delete for single and recurring events. Tests cover DST edges in Europe/Bucharest. |
| **6.3** | **Event notifications** through the phase 5 channels: "starts in 30 minutes" and similar, per event, to its attendees. | An event notifies its attendees at its lead time. |
| **6.4** | **ICS feed**: `calendar_feeds (user_id, token_hash, created_at, last_fetched_at, revoked_at)` and a route that serves the events the user can see as iCalendar, recurrences included. Settings shows the `webcal://` link, with regenerate and revoke. The feed is authenticated by its secret token only, so it never includes more than the user can see in the app. Google can only subscribe once the app has a public URL; Apple Calendar on a device with Tailscale works now. | Apple Calendar subscribes and shows the events. A revoked or regenerated link stops working. |
| **6.5** | **Google account connection**: a separate Google OAuth flow with the `calendar.events` scope, `access_type=offline` and `prompt=consent`. Store the refresh token **encrypted** (AES-GCM with a server key in env) in `google_connections`. Pick which Google calendar maps to which family calendar. | Connect and disconnect work, and disconnecting revokes the token. Tokens are never sent to the client. |
| **6.6** | **Google → app (import)**: incremental sync on the worker using `syncToken`, and a full resync on 410 Gone. Events are matched by `google_event_id` + `etag`. | Editing an event in Google shows up in the app within the poll interval. |
| **6.7** | **App → Google (export)**: an outbox table written in the same transaction as each event change. The worker pushes it to Google with `If-Match` on the etag. **Conflict rule:** the latest `updated` wins, and the losing version is saved to an `event_conflicts` log you can review. | Round-trip tests with a fake Google client. No echo loops (your own writes are ignored on import). |
| **6.8** | MCP tools for the calendar, so Claude can answer things like "what's on the family calendar this week?" | The tool-surface snapshot is updated. |
| **6.9** | (Optional, needs a public HTTPS URL) **Push webhooks** through `events.watch`, renewed before expiry, replacing polling for connected calendars. | Changes in Google arrive within seconds. |

## Phase 7: Statement import

Upload a bank statement and turn it into expenses inside the app. Whatever the format, every import ends in a **review step**, and nothing is saved until you confirm. Importing follows the Expenses permission and only ever creates the caller's own expenses.

| Step | What | Done when |
| --- | --- | --- |
| **7.1** | **Upload and parsing pipeline**: `POST /api/imports` takes a CSV or PDF (size-limited, magic bytes checked), parses it in memory, and returns draft rows. **The file itself is never stored**, because statements carry IBANs and account numbers. Draft rows live in `import_batches` / `import_rows` until confirmed or expired (24 hours). Parsers sit behind a `StatementParser` interface, picked by the file's header or layout. | A test statement becomes draft rows, and no copy of the file remains on disk or in Storage. |
| **7.2** | **CSV parsers** for your banks, one per bank, with fixtures taken from real (anonymised) statements. | Each fixture parses to the expected rows. |
| **7.3** | **Review screen**: a table of draft rows with date, merchant, amount and currency. Likely **duplicates** of existing expenses (same date and amount, similar merchant) are flagged and unticked. Category and subtype are suggested by the existing merchant classification. Each row can be edited or excluded. Confirming inserts everything in one transaction, tagged with the import batch, so a whole import can be undone. | Screenshots at 390 and 1280 px. Importing the same statement twice adds nothing the second time. Undo removes exactly that batch. |
| **7.4** | **PDF statements with text**: extract the text and parse it with the same per-bank parsers. | Each PDF fixture parses to the expected rows. |
| **7.5** | (AI, see phase 8) **Unknown layouts**: let an LLM extract rows from statements no parser recognises, with account numbers masked in the extracted text before it's sent. Opt-in per user, because it sends financial data to a third party. The rows still go through the review step. | An unrecognised statement produces draft rows only after the user opts in. |

## Phase 8: AI in the app (open for discussion)

Nothing here is planned in detail yet. The direction so far:

- **Plain insights first, without an LLM**: month-over-month changes, category spikes, detected recurring payments and subscriptions, and "this looks like a monthly bill, make it a reminder?". Most of the value, with no API cost and no data leaving the app.
- **Statement extraction** (7.5) is likely the first real LLM feature.
- **Then perhaps**: a monthly summary with suggestions, or asking questions about your spending inside the app. MCP (phase 3) already lets Claude analyse your data from outside.

To decide before planning: which provider, who pays and how much, opting in per user, what data is sent (and masked), and whether kids get it at all.

## Phase 9: Native apps (Expo), first vertical slice

The idea is to ship one small, useful native feature end to end before adding anything else: the to-do board, plus reminders with phone notifications.

| Step | What | Done when |
| --- | --- | --- |
| **9.1** | **Convert to an npm-workspaces monorepo** with **moves only**: `apps/web` (today's Next app), `packages/core` (Zod schemas, types, pure domain logic, API response types). No behaviour change. Update Docker and CI paths. | `npm run check`, the tests and the Docker build pass. The diff is renames plus import paths. |
| **9.2** | **Typed API client in `packages/core`**: `createApiClient({ baseUrl, getToken })`, used by web (cookies, no token) and mobile (bearer). Move the web SWR fetchers onto it. | The web app still passes. The client has unit tests. |
| **9.3** | **`apps/mobile` Expo skeleton**: Expo Router, TypeScript, EAS config, environment-specific API URL, light and dark themes matching the web tokens. Runs in the iOS Simulator and Android emulator. | The app opens to a placeholder screen. CI type-checks it. |
| **9.4** | **Mobile sign-in**: email/password plus Google through Supabase (PKCE + deep link `appname://auth/callback`). The session is stored in `expo-secure-store`, and the access token is sent as a bearer to the API from step 1.2. | Sign in, sign out and token refresh all work on both platforms. |
| **9.5** | **Mobile to-do board**: one column at a time, long-press to drag within a column, and the "Move to…" menu between columns, on the shared API client, with pull to refresh and optimistic moves. | You can move a card on the phone and see it on the web. |
| **9.6** | **Push notifications**: `expo-notifications`, registered as an `expo` channel in the phase 5 notification layer, sent through the Expo Push API. Reminders, to-do assignments and event notifications all reach the phone with no new triggers. | A reminder notification arrives on a physical device (development build). |
| **9.7** | **Mobile reminders**: the reminders list, create, mark done and snooze. | Parity with the web reminders page. |
| **9.8** | **Mobile calendar**: agenda plus a month view. | Parity with the web for viewing and creating events. |
| **9.9** | **Distribution**: an EAS development build for your devices, then TestFlight and Play internal testing. | A family member installs from TestFlight. |

After 9.9, every later feature step gets a "web + mobile" pair (for example 10.2a web, 10.2b mobile) instead of a single step.

## Phase 10: Cars and houses

| Step | What | Done when |
| --- | --- | --- |
| **10.1** | **Vehicles**: `vehicles (family_id, name, make, model, year, plate, VIN, fuel type, photo)` and an optional `expenses.vehicle_id` so the existing `car_fuel`, `car_maintenance` and `car_repairs` subtypes link to a car. | A car's detail page shows its expenses. Linked expenses follow the finance rules from 1.7: parents see every member's, kids only their own unless Family finance is on. |
| **10.2** | **Vehicle documents and reminders**: ITP, RCA, CASCO, rovinietă and service intervals (date or km), plus odometer logs. Expiry dates become reminders from phase 5. | A reminder fires N days before expiry. |
| **10.3** | **Houses**: `properties (family_id, name, address, area, rooms, year built, photo)`, an optional link to a `net_worth_items` property, utility providers and contract numbers, and documents in Storage. | The house detail page shows linked net-worth value history if you can see that item under the finance rules from 1.7. |
| **10.4** | **Maintenance log and recurring tasks** for houses (boiler check, filter changes) that create cards on the to-do board from phase 4. | A recurring task creates a card on schedule. |

## Phase 11: Smart home through Home Assistant

| Step | What | Done when |
| --- | --- | --- |
| **11.1** | **Connection**: a family setting (parents only) for the Home Assistant base URL plus a long-lived access token (encrypted like the Google tokens). A server-side client for the HA REST API. "Test connection" button. | Status shows as connected, and the token is never sent to the client. |
| **11.2** | **Device registry**: pick which HA entities appear in the app (vacuum, air purifier, sensors). Each one gets a friendly name, a room, and whether kids with Devices at edit may control it. | Only chosen devices are listed. |
| **11.3** | **Read-only dashboard**: vacuum state and battery, air-quality readings, purifier mode. | Live state on web and mobile. |
| **11.4** | **Controls**: start, stop or dock the vacuum, clean a room (Roborock segment cleaning through HA), set the purifier mode or fan speed. Every action is checked against the role and kid permissions, and written to an audit log. | A kid with Devices at view can't control anything; at edit, only the devices marked for kids. |
| **11.5** | (Optional) **Automations and alerts**: notify when the vacuum is stuck or a filter needs replacing, and make "clean the kitchen" a to-do card action. | |

## Phase 12: Polish that cuts across modules

- **12.1** A home dashboard per role: today's to-dos, upcoming reminders, today's events, car reminders, device alerts. Parents see family finance widgets; kids see only the modules their permissions allow.
- **12.2** MCP tools for cars and devices.
- **12.3** Offline-first reads on mobile (cache with TanStack Query persistence) and an audit log page for parents.

## Phase 13: Later or optional

- **13.1** Grandparents and other relatives: a third member type with kid-style module permissions, private finance, and the right to leave on their own.
- **13.2** Account deletion for every user. Kids can't leave their family, so this is also how a grown-up kid gets out. The EU requires it before the app has outside users.
- **13.3** Optional grace period for family deletion (soft-delete for 7 days before the purge), if an accidental delete ever happens.

## How every step is reviewed

Each PR should include:

1. **The migration and its RLS SQL test**, for any schema change. New tables always ship with `enable row level security`, explicit grants, and policies built on the family helpers.
2. **Route tests for each role** (creator, parent, kid with the module off and on, non-member) for any new endpoint.
3. **Screenshots** at 390 px and 1280 px for any UI change, as in `docs/ui-styling`.
4. **A flag** that keeps the module hidden until its final step, so a half-built module never appears in production.
5. **No mixing:** a PR is either a move/refactor (no behaviour change) or a feature. Never both.

## Decisions you need to make

| Decision | Recommendation | Why it matters |
| --- | --- | --- |
| **New product name** | Your call, needed by step 0.3 | It sets the app ID and bundle ID for the stores. Those are hard to change after TestFlight. |
| **Public HTTPS or Tailscale only** | Stay on Tailscale through phase 8. Decide before 3.5, 6.9 or the store releases. | Phones need the Tailscale app to reach the API. claude.ai MCP connectors (3.5), Google subscribing to the ICS feed (6.4), Google push webhooks (6.9) and some OAuth redirects need a public URL (Tailscale Funnel or a Cloudflare Tunnel both work). Web Push needs HTTPS but not a public URL. |
| **Email provider** | Your call before 5.2: a transactional provider such as Resend or Amazon SES, or the SMTP account Supabase Auth already sends from | Reminder emails need a sender, a verified domain (SPF and DKIM) and a way to unsubscribe. |
| **One to-do board or several** | Several, each with its own visibility, plus a "Family" board every family gets | A single board can't keep a parents-only or private list apart. |
| **Banks and formats for statement import** | Open, needed before 7.2: which banks, and whether each gives CSV, PDF or both | Every bank needs its own parser and fixtures. |
| **How MCP tokens act as the user** | Decided: an admin magic-link session for the token's owner, cached per token (see [mcp-tokens-plan.md](mcp-tokens-plan.md)). A self-signed JWT would need a signing key the app doesn't have | Using the secret key to read data instead would bypass RLS for every MCP call. |
| **AI provider, cost and privacy** | Open, discuss when phase 8 starts | Sending financial data to a third party needs opt-in and masking. |
| **Mac calendar** | Decided: an ICS feed out (6.4) and two-way Google sync; no CalDAV | A Mac calendar synced with Google gets the app's events through Google. |
| **Reminder rules** | Decided: see the table in phase 5 | |
| **Google OAuth consent screen** | Publish the OAuth app "In production" (unverified is fine for family use, under 100 users) | In "Testing" status, Google refresh tokens for sensitive scopes like Calendar **expire after 7 days**, so the sync would keep breaking. |
| **Home Assistant** | Use it if you already run HA, or are willing to. It's a Docker container on the VPS or a Raspberry Pi at home. | The alternative is reverse-engineered vendor clouds (python-roborock, miio), which are fragile and may break the vendors' terms. |
| **Finance visibility** | Decided: parents see every member's finance read-only, kids only with Family finance on (decision 3, step 1.7) | It widens the read policies on every finance table, so every finance read needs an explicit owner filter first. |
| **Kids' sign-in** | Decided: a username account created by a parent (or a kid code or link). A real email can be added later (step 1.5) | Creating accounts on the server needs the Supabase secret key, which the app doesn't have yet. |
| **Can a non-creator parent leave?** | Yes, on their own. Their finance stops being visible to the family | Otherwise only the creator can get them out. |
| **What if the creator wants to leave?** | Let the creator hand over the creator flag to another parent, then leave as a normal parent. Otherwise the only way out is deleting the family | Without a handover, the creator can't leave without wiping everyone's family data. |
| **Family totals across currencies** | Group by currency, with no conversion, until there's a source for FX rates | Members can pick different currencies in `profiles.currency`. |
