# Family hub roadmap

Prepared 15 October 2026, updated 28 October 2026. This plan grows Simple Ledger from a single-user expense tracker into a family app: families and roles, profile pictures, safer MCP access, a to-do board, private reminders with browser notifications, a shared calendar with a calendar feed for other calendar apps, statement import, AI assistance with a hard cost limit, production hardening, logging, performance and a simpler UI, cars, houses, smart-home devices, and native iOS/Android apps built with Expo. Everything up to and including AI ships on the web before the native apps start (see "Order before the native apps").

Every numbered step below is meant to be **one pull request** that can be reviewed on its own, merged, and deployed without breaking what already works. Unfinished modules stay hidden behind a flag, so `main` is always shippable.

## Where the app is today

These facts shape the plan:

- **Single-owner data model.** Every table (`expenses`, `expense_tabs`, `investment_*`, `net_worth_*`) has a `user_id` column, and its RLS policy is `auth.uid() = user_id`. There is no idea of a group yet.
- **`profiles` already exists** (`id`, `email`, `currency`). Display name and avatar can go there.
- **The browser never talks to Supabase directly.** Next.js route handlers in `src/app/api/**` use `withUser` (`src/lib/http/route.ts`), which reads the user from **cookies**. The Supabase keys are server-only. A native app can't use cookies the same way, so the API has to accept a bearer token as well (step 1.2).
- **The domain logic is already separate from the UI.** Zod schemas (`src/lib/validation`), types and calculations (`src/lib/expenses`, `src/lib/net-worth`, `src/lib/investments`) don't depend on Chakra, so the Expo app can reuse them.
- **MCP connects through OAuth or personal access tokens** (phase 3, [mcp-access-plan.md](mcp-access-plan.md)), and each user turns it on in Settings → AI assistants. MCP clients used to send the user's real email and password (Basic auth); that was removed in M10.
- **The production VPS is reachable only over Tailscale.** This matters for phones, which need Tailscale, and for calendar apps that fetch feeds from their own servers (Google Calendar, Outlook.com), which need a public HTTPS URL (see "Decisions you need to make").
- **Tests:** Vitest for units and routes, plus SQL RLS tests in `supabase/tests` run by `npm run test:db`. The only workflows are deploy and VPS notification. Nothing runs checks on pull requests yet.

## Architecture decisions (recommended)

1. **Keep Next.js as the web app and the backend. Add Expo as a second client for iOS and Android.** Don't rewrite the web app in Expo or React Native Web. The Chakra UI, the dashboards and the PWA keep working, and both clients call the same API with the same validation. The two apps share code through a workspace package, not through UI components.
2. **One family per user.** A user creates a family or joins one with an invite code or link. Nobody belongs to more than one family, so there is no family switcher and no "active family" to pass around: the caller's family follows from their membership. Data for the new modules (to-dos, calendar, cars, houses, devices) belongs to the family and is checked by RLS through a few SQL helpers.
3. **Parents see the whole family's finance, read-only.** Parents see every member's expenses, investments and net worth, including each other's. They can't change data that isn't theirs: only the read policies widen, and insert, update and delete stay owner-only. Kids see only their own finance, plus the rest of the family's if a parent turns on the "Family finance" permission for them. MCP keeps working on the caller's own data only.
4. **Two roles, `parent` and `kid`, plus a creator flag.** The member who created the family is its creator, and only the creator can remove members or delete the family. Parents have every permission. Each kid has their own permission set, chosen by a parent and changeable at any time, so two kids in one family can see different things. Kids can't leave the family on their own, and they're never promoted to parent. Grandparents and other relatives are out of scope for now (step 13.1).
5. **Smart devices go through Home Assistant, not each vendor.** Roborock has no official public API, and air purifiers each use a different cloud. Home Assistant already supports Roborock, Xiaomi, Philips, Dyson and most others. The app stores one Home Assistant URL and token per family, reads entity states, and calls services.
6. **Scheduled and background work runs in a worker, not in a request handler.** It's a small Node process in the same Docker image (`node dist/worker.js`), built in phase 5. It delivers reminders, to-do and calendar notifications.
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
| Calendar (phase 6) | off / view / edit | edit |
| MCP (phase 3) | off / on | off |
| Cars, Houses, Devices (phases 10 and 11) | off / view / edit | view |

Parents always have every permission, and no one can restrict a parent. A module that's off is hidden from the navigation **and** refused by the API with 403. Hiding the navigation alone isn't enough. Reminders (phase 5) and the to-do board (phase 4) aren't modules here: every member has them. Statement import (phase 7) follows Expenses.

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
3. **Phase 5, the worker, push notifications and reminders.** The background worker and the notification layer are built once here, then reused by the calendar, to-dos and later the phone. Email notifications come in a later step.
4. **Phase 6, the calendar.** The app's own family calendar, event notifications on the phase 5 worker, and a private feed per member for other calendar apps. Google sync is dropped.
5. **Phase 7, statement import.** CSV first, then PDF.
6. **Phase 8, AI assistance**, with the cost gate and kill switch.

**Features first, improvements after (decided 26 October 2026).** All the planned functionality ships before the improvement phases. That means phases 6–8 here, then the native apps (9), cars and houses (10), smart home (11), polish (12) and the later items (13). After that come the improvements, in this order:
- **Phase 14, production hardening and security.**
- **Phase 15, logging and tracing,** which also measures phase 16.
- **Phase 16, performance and loading.**
- **Phase 17, the simpler UI, mobile first.** This includes swipe-to-delete on phones.
- **Phase 18, clean-up and fewer tests** (optional).

So the full order is 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18. Phase 14 already has a task breakdown, `docs/security-plan.md`, in [#137](https://github.com/GeorgeDanicico/expense-tracker/pull/137). It's kept unmerged until its turn comes.

Display-name editing (the rest of 2.1) is small and can slot in anywhere.

Each phase gets its own task breakdown (like [family-phase-1-tasks.md](family-phase-1-tasks.md) and [avatars-plan.md](avatars-plan.md)) before its work starts.

## Phase 3: MCP access tokens and a per-user switch

Before this phase, MCP clients signed in with **Basic auth carrying your real email and password** (`src/lib/mcp/auth.ts`). The server signed in with them and cached the session in memory. This phase replaces that with personal access tokens, and makes MCP something each user turns on in Settings. MCP keeps working on the caller's own data only (decision 3).

**Status (23 October 2026): done; Basic auth is removed (M10).** Replanned in [mcp-access-plan.md](mcp-access-plan.md) (tasks P1 and M1–M10). MCP clients connect through **OAuth**, run by Supabase Auth's OAuth 2.1 server behind our own interfaces, or with **personal access tokens** for machines without a browser (adults only). One switch per user, off by default; a kid also needs a parent's permission and a confirmed real email. The steps below are kept as first written; the plan supersedes them.

| Step | What | Done when |
| --- | --- | --- |
| **3.1** | **Schema**: `profiles.mcp_enabled` (default `false`) and `mcp_tokens (id, user_id, name, token_hash, prefix, created_at, last_used_at, expires_at, revoked_at)`. A token is 32 random bytes with a short recognisable prefix. It's shown once at creation and only its SHA-256 hash is stored. Users read and revoke only their own tokens; only the server creates them and sets `last_used_at`. Add an **MCP** kid permission (off / on, default off). | SQL tests: a user can't read or revoke another user's tokens, and a kid can't turn MCP on while the permission is off. |
| **3.2** | **Token auth on `/api/mcp`**: `Authorization: Bearer <token>`. The server hashes it, looks it up, checks it isn't revoked or expired, checks `mcp_enabled` (and the kid permission), and then acts **as that user so RLS still applies**. How the server gets a user session from a token (minting a short-lived user JWT with the project's signing key, or another route behind `AuthService`) is settled in this phase's task plan. Failures are rate-limited per token prefix and IP, as today. Basic auth keeps working alongside during the switch. | Route tests: a valid token works; revoked, expired, unknown, MCP-off and kid-without-permission tokens get 401 or 403; one user's token never sees another user's data. |
| **3.3** | **Settings → AI assistants (MCP)**: the on/off switch, create a token (name, expiry: 30 days, 90 days, 1 year or never), copy it once, see each token's last use, and revoke. Ready-to-paste setup for Claude Code and Claude Desktop. Turning MCP off refuses every token immediately without deleting them. | Screenshots at 390 and 1280 px. A token created on the page works in Claude Code. |
| **3.4** | **Remove Basic auth** from `/api/mcp`, once your own clients use tokens. The in-memory session cache goes with it. | A Basic auth request gets 401. The README describes token setup only. |
| **3.5** | (Later, needs a public HTTPS URL) **OAuth 2.1** following the MCP authorization spec, so claude.ai connectors can connect. Those connect from Anthropic's servers, so they can't reach a Tailscale-only app. | claude.ai connects through the consent screen, and the connection shows in the token list. |

## Phase 4: Family to-do board

To-dos work like a GitHub project board: **three fixed columns, "To do", "In progress" and "Done"**, with cards dragged between and within columns.

**Status (24 October 2026): done** (tasks T1–T7 in [todo-board-plan.md](todo-board-plan.md), merged in #115–#121), apart from the smoke test. The plan changes the steps below: **one board per family** with member filter chips instead of several boards, **no kid permission or per-card rules** (every member can add, edit, move and delete any card on their family's board), **no feature flag** (the nav item lands last), and **no recurring to-dos**. The steps below are kept as first written; the plan supersedes them.

| Step | What | Done when |
| --- | --- | --- |
| **4.1** | **Schema**: `todo_boards (family_id, name, visibility: family / parents / private, created_by)`, with a "Family" board created for every family. `todos (board_id, title, notes, status: todo / in_progress / done, position, assignee_id, due_date, created_by, completed_at, completed_by)`. `position` is a fractional-index text key (the `fractional-indexing` approach), so moving a card rewrites only that card's row. `completed_at` and `completed_by` are set when a card enters Done and cleared when it leaves. RLS: kids with To-dos on see `family` boards and their own private ones. | SQL tests cover kid (To-dos off, view and edit), parent and other-family access. |
| **4.2** | API routes, validation and data layer, following the existing `expense-tabs` pattern. A **move endpoint** takes the new status and the neighbouring cards, and the server computes the position. Kids with To-dos at view may only move cards assigned to them; at edit they can also add, edit and move any card on boards they can see. | Route tests per role and permission level, including two moves racing for the same slot. |
| **4.3** | **Web board** with `dnd-kit`: drag between and within columns, **keyboard dragging** for accessibility, optimistic moves that roll back on error. Quick add at the top of each column, assigning a member (shown by avatar), a due date, and filters for "Mine", "Due today" and "Overdue". At 390 px the three columns don't fit side by side, so phones show one column at a time behind tabs, and each card has a "Move to…" menu. | Screenshots at 390 and 1280 px. Dragging works with mouse, touch and keyboard. |
| **4.4** | MCP tools `list_todos`, `add_todo` and `move_todo`, with roles and kid permissions enforced. | The tool-surface snapshot is updated. |
| **4.5** | (Optional) Recurring to-dos (`rrule`), such as "take out the trash every Tuesday". | The next card is created in To do when the current one reaches Done. |

## Phase 5: Background worker, push notifications and reminders

**Status (26 October 2026): done** (tasks R1–R12 in [reminders-plan.md](reminders-plan.md), merged in #122–#134 and deployed), apart from the smoke test on real devices. Production images are now built on GitHub and pulled by the VPS (#135, vps-apps#10), because `next build` ran the VPS out of memory. The plan changes a few details below: repeats are stored as structured columns instead of an RRULE, reminders are scheduled through `next_notify_at` on the reminder instead of outbox rows written on save, and the worker locks rows with `FOR UPDATE SKIP LOCKED` instead of a job lock table. The plan supersedes the steps below.

**Reminders** are personal nudges that aren't calendar events: "pay the rent", "pay the taxes", "renew the insurance". Most repeat. The phase also builds what any scheduled notification needs: a background worker and a notification layer. On the web the only channel is **browser notifications (Web Push)**; the phone's push notifications join as a second channel in phase 9. ntfy and other stopgap push apps are left out on purpose, because the native app replaces them.

**Decided 25 October 2026:**
- **Reminders are strictly personal.** You can only create reminders for yourself, and nobody else ever sees them, parents included. They work for every member, with or without a family, and aren't a kid permission module. To ask someone else to do something, assign them a **to-do** with a due date: the to-do board is for what you ask of others, reminders are for your own nudges.
- **Reminders notify through browser notifications only, no email.** Email is poor at "now": it lands among everything else, often without an alert. Email notifications are a later step, for family notifications (see "Email notifications, a later step" below).

### How notifications reach you

- **Settings → Notifications** has one **"Browser notifications"** switch for all your devices, an **"Enable on this device"** button and a **"Send a test"** button. Browsers only send notifications after their own permission prompt (Safari only after a click), so each device needs the button pressed once; the device then registers behind the scenes, with no device list to manage.
- The same code works in Chrome, Edge and Firefox everywhere, in Safari on macOS 13 or later, and in Safari on iOS 16.4 or later once the app is added to the home screen (Apple's rule; a normal Safari tab on iPhone can't receive notifications). On an iPhone the button explains the home-screen step instead.
- Web Push needs the app on HTTPS. `tailscale serve` on the `*.ts.net` name is enough.
- **Per reminder**, you can mute one reminder's notifications.
- With notifications off, or no device enabled, Settings warns "Reminders won't notify you". Reminders still show in the app as due and overdue.
- The worker checks the switch, the mute and whether the reminder is done or snoozed **when it sends**, so changes take effect at once.
- **The system notification always shows**, on every browser and device, whether or not the app is open. That keeps the behaviour the same everywhere (Safari also revokes subscriptions that receive pushes without a visible notification). Clicking it focuses an open tab, or opens one, on that reminder.
- **The Reminders nav item shows a badge** with the number of due and overdue reminders. It refreshes when a notification arrives while the app is open and when the page regains focus, so a reminder is never only in a notification you dismissed.

### How it's built

- **Schedule on save, send when due.** When a reminder is created, edited, marked done or snoozed, the API computes its next occurrence and writes one outbox row per lead time (for example 3 days before and on the day), after cancelling that reminder's unsent rows. The worker only sends outbox rows whose `send_at` has passed. A repeating reminder moves to its next occurrence when marked done.
- **Recurrence** is stored as an RRULE and computed with the `rrule` package in the reminder's timezone (`Europe/Bucharest` by default). The form offers presets only: once, monthly on day N, yearly, every N weeks. "The 31st" is stored as `BYMONTHDAY=28,29,30,31;BYSETPOS=-1`, so it falls on the last day of shorter months instead of skipping them. Times are kept in local wall-clock time, so "9:00" stays 9:00 across DST.
- **The worker** is `src/worker/index.ts`, bundled with esbuild into one `dist/worker.js` (Next's standalone output only traces the web app's files), and runs from the same image as a second container. Every 30 seconds it claims due rows through a SQL function using `FOR UPDATE SKIP LOCKED` with a lease, so two workers never send the same row. It retries temporary failures with backoff, writes a heartbeat, and stops cleanly on SIGTERM. It reads the outbox with the Supabase secret key (from phase 1), because it acts for every user.
- **Web Push** uses the `web-push` package with VAPID keys in server env (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). "Enable on this device" calls `Notification.requestPermission()` and `pushManager.subscribe()` inside the click handler and posts the subscription to the API, upserted by endpoint. `public/sw.js` gets `push` (always `showNotification`, tagged with the reminder id so a newer one replaces an older one), `notificationclick` and `pushsubscriptionchange` handlers. The service worker is also registered on localhost so this can be tested locally. Signing out removes that device's subscription.

| Step | What | Done when |
| --- | --- | --- |
| **5.1** | **Worker process**: `src/worker/index.ts`, its esbuild bundle and the second container, with the heartbeat. It only logs at first. | The worker heartbeat appears in `/health` or the logs. |
| **5.2** | **Notification layer**: `profiles.push_enabled`; `push_subscriptions (user_id, endpoint unique, p256dh, auth, user_agent, created_at, last_success_at)`, one row per enabled device; and a `notifications` outbox `(user_id, kind, source_id, payload, send_at, status: pending / sent / cancelled, attempts, next_attempt_at, last_error, locked_until)` with its claim function. Users manage only their own subscriptions and switch; only the worker reads the outbox. Web Push sending, the service worker handlers and **Settings → Notifications** as described above. | A test notification arrives in Chrome, Safari on macOS and the iPhone home-screen app. Turning the switch off stops it straight away. A dead subscription (404 or 410 from the push service) is deleted automatically. |
| **5.3** | **Reminders schema**: `reminders (user_id, title, notes, due_at, timezone, rrule, next_due_at, lead_times, notifications_muted, snoozed_until, expense_template)` and `reminder_completions (reminder_id, occurrence_at, done_at, expense_id)`. RLS: only the owner, for every action. | SQL tests show another member of the same family, a parent included, can't read or change someone's reminders. |
| **5.4** | **Reminders API and scheduling**: create, edit, delete, mark done (moves a repeating reminder to its next occurrence), snooze (an hour, until tomorrow, or a custom time) and mute, each rewriting that reminder's pending outbox rows. | Route tests for every action, plus the outbox rows each one leaves. Recurrence tests cover month ends (31st → 30th), leap years and DST in Europe/Bucharest. |
| **5.5** | **Reminders page**: "Upcoming", "Overdue" and "Done". A form with recurrence presets (once, monthly, yearly, every N weeks) and lead times, with a link to Settings → Notifications. The nav badge and the nav item land last. | Screenshots at 390 and 1280 px. |
| **5.6** | **Delivery**: the worker sends due outbox rows as Web Push. Muted, done or snoozed reminders send nothing. | A monthly reminder notifies 3 days before and on the day, then moves to the next month when marked done. |
| **5.7** | (Optional) **Log as expense**: a reminder can carry an expense template (amount, currency, category, subtype). Marking it done offers to add that expense, pre-filled. | Ticking "Pay rent" adds the rent expense in one confirm. |
| **5.8** | **To-do notifications** on the same layer: "a to-do was assigned to you" (not when you assign yourself), and "a to-do assigned to you is due today" at 9:00. Settings → Notifications gets a switch per kind (reminders, to-dos), on by default. | Assigning a card to someone notifies them, and nothing arrives when they've switched to-do notifications off. |
| **5.9** | MCP tools `list_reminders`, `add_reminder` and `complete_reminder`, on the caller's own reminders only. | The tool-surface snapshot is updated. |

### Email notifications, a later step

Email isn't part of this phase; it's a later step, after phase 5. When it comes, it's for family notifications (for example a parent assigning a kid a to-do), most likely as a daily or weekly summary rather than one email per event. It would be another channel on the same outbox. Without a domain, the plan is Gmail SMTP from George's existing Gmail account with an app password, behind an `EmailSender` interface so a provider like Resend can replace it if a domain is ever bought.

## Phase 6: Family calendar and calendar feeds

**Status (28 October 2026): done** (tasks C1–C9 in [calendar-plan.md](calendar-plan.md), merged in #141–#149: C1 #141, C2 #142, C3 #143, C4 #144, C5 #145, C6 #146, C7 #147, C8 #148, C9 #149), apart from the smoke test on real devices: a Mac and an iPhone subscribing to the feed over Tailscale, a notification arriving on a device, and asking Claude Code "what's on the calendar" through MCP. The plan changes the steps below: **one calendar per family** with no calendars table, **no kid permission** (every member edits every event), **short repeats only** (daily up to 10 days, weekly up to 10 weeks, stored as one row per occurrence instead of an RRULE), fixed notifications (30 minutes before, 07:30 for all-day events) instead of per-event lead times, and **no Google Calendar sync** (6.5–6.7 and 6.9 are dropped). Each member's feed holds **only the events they attend**, not everything they can see. The steps below are kept as first written; the plan supersedes them.

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

**Status (28 October 2026): planned** (tasks I1–I13 in [statement-import-plan.md](statement-import-plan.md)). The plan changes the steps below: imports are linked to the expenses they create through an `import_expenses` table instead of a column on `expenses`, money in (refunds, incoming payments) is skipped, rows in another currency can't be imported, uploads are limited to 2 MB for CSV and 5 MB for PDF, and there are **no MCP tools**. Steps 7.2 and 7.4 become one task per bank and format, which wait for the open "Banks and formats for statement import" decision (a checkpoint in the plan); step 7.5 stays in phase 8. The steps below are kept as first written; the plan supersedes them.

Upload a bank statement and turn it into expenses inside the app. Whatever the format, every import ends in a **review step**, and nothing is saved until you confirm. Importing follows the Expenses permission and only ever creates the caller's own expenses.

| Step | What | Done when |
| --- | --- | --- |
| **7.1** | **Upload and parsing pipeline**: `POST /api/imports` takes a CSV or PDF (size-limited, magic bytes checked), parses it in memory, and returns draft rows. **The file itself is never stored**, because statements carry IBANs and account numbers. Draft rows live in `import_batches` / `import_rows` until confirmed or expired (24 hours). Parsers sit behind a `StatementParser` interface, picked by the file's header or layout. | A test statement becomes draft rows, and no copy of the file remains on disk or in Storage. |
| **7.2** | **CSV parsers** for your banks, one per bank, with fixtures taken from real (anonymised) statements. | Each fixture parses to the expected rows. |
| **7.3** | **Review screen**: a table of draft rows with date, merchant, amount and currency. Likely **duplicates** of existing expenses (same date and amount, similar merchant) are flagged and unticked. Category and subtype are suggested by the existing merchant classification. Each row can be edited or excluded. Confirming inserts everything in one transaction, tagged with the import batch, so a whole import can be undone. | Screenshots at 390 and 1280 px. Importing the same statement twice adds nothing the second time. Undo removes exactly that batch. |
| **7.4** | **PDF statements with text**: extract the text and parse it with the same per-bank parsers. | Each PDF fixture parses to the expected rows. |
| **7.5** | (AI, see phase 8) **Unknown layouts**: let an LLM extract rows from statements no parser recognises, with account numbers masked in the extracted text before it's sent. Opt-in per user, because it sends financial data to a third party. The rows still go through the review step. | An unrecognised statement produces draft rows only after the user opts in. |

## Phase 8: AI assistance, with a hard cost limit

AI helps where it saves typing or thinking. It's built so the spend can't run away: every call goes through one gate that checks a budget, records the cost, and is switched off by a feature flag when usage gets high.

**What AI does**, cheapest and most useful first:
- **Quick add in plain language:** "lunch 45 yesterday", "remind me to pay rent on the 25th every month" or "Ana: clean her room by Friday" become a pre-filled expense, reminder or to-do for you to confirm. Nothing is saved without a tap.
- **Category suggestions** for expenses that the existing merchant rules don't recognise.
- **An assistant inside the app** that answers questions about your own data ("how much did we spend on food this month compared with last?") by calling the **same tools as MCP** (phase 3), with your permissions. Read-only at first; writes need a confirm.
- **A monthly summary** with spending changes and recurring payments ("this looks like a monthly bill, make it a reminder?"). Plain calculations do the work; AI only writes the text.
- Later: **receipt photos** to an expense, and statement extraction (7.5).

**How cost is kept under control:**
- **One gate:** every model call goes through `src/lib/ai/client.ts`. It sets `max_tokens` per feature, a timeout, at most N tool steps per assistant turn, prompt caching for the tool definitions, and the cheapest model that does the job (a small model for parsing and categories, a larger one only for the assistant). Model ids come from env.
- **A usage ledger:** `ai_usage (user_id, feature, model, input_tokens, output_tokens, cache_tokens, cost_micros, created_at)`, priced from a table in config.
- **Budgets:** a per-user daily and monthly cap, and a global monthly budget (`AI_MONTHLY_BUDGET_USD`). They're checked before every call with an estimate and settled after it.
- **The kill switch is a feature flag:** `app_flags.ai_enabled`, which an env value can override. The gate turns it **off automatically** when global spend reaches the budget, and warns at 80% through the phase 5 notification layer. A user who hits their own cap is paused until the next day or month. The flag can be flipped by hand on an admin page.
- **Monitoring:** an admin page with spend per day, feature and user, the remaining budget and the flag. Every call also logs its tokens and cost (phase 15). As a last line of defence, set a monthly spend limit in the Anthropic console too.
- **Privacy:** AI is opt-in per user, like the MCP switch. Kids need a parent's permission. Only the data a feature needs is sent, and API data isn't used for training.

| Step | What | Done when |
| --- | --- | --- |
| **8.1** | **Flags, ledger and budget gate**, with no AI yet: `app_flags`, `ai_usage`, the budget checks and the automatic switch-off, all tested with a fake model. | Tests show calls are refused over each cap and the flag turns off at the global budget. |
| **8.2** | **AI client**: the Claude API behind the gate, with timeouts, retries, logging, prompt caching and per-feature limits. The per-user opt-in in Settings, with the kid permission. | A test call is recorded with its exact token counts and cost. |
| **8.3** | **Admin usage page and alerts**: spend charts, per-user caps, the flag toggle, and the 80% and 100% notifications. Who counts as an admin is set by env (`APP_ADMIN_USER_IDS`). | Crossing a test budget notifies the admin and turns AI off. |
| **8.4** | **Quick add in plain language** for expenses, reminders and to-dos, with a confirm step. | Ten example sentences parse correctly in tests (with recorded responses). |
| **8.5** | **Category suggestions** for unrecognised merchants, shown as a suggestion, never applied silently. | The suggestion appears on new uncategorised expenses. |
| **8.6** | **Assistant chat** on the MCP tools: read-only first, then writes behind a confirm. Each conversation has a cost limit. | It answers spending questions and stays within its cost limit. |
| **8.7** | **Monthly summary**: the numbers computed in code, the text written by the model. | Generated once a month per opted-in user, within budget. |
| **8.8** | (Optional) **Receipt photo to expense**. | A photo of a receipt pre-fills an expense. |

## Phase 9: Native apps (Expo), first vertical slice

The idea is to ship one small, useful native feature end to end before adding anything else: the to-do board, plus reminders with phone notifications.

| Step | What | Done when |
| --- | --- | --- |
| **9.1** | **Convert to an npm-workspaces monorepo** with **moves only**: `apps/web` (today's Next app), `packages/core` (Zod schemas, types, pure domain logic, API response types). No behaviour change. Update Docker and CI paths. | `npm run check`, the tests and the Docker build pass. The diff is renames plus import paths. |
| **9.2** | **Typed API client in `packages/core`**: `createApiClient({ baseUrl, getToken })`, used by web (cookies, no token) and mobile (bearer). Move the web SWR fetchers onto it. | The web app still passes. The client has unit tests. |
| **9.3** | **`apps/mobile` Expo skeleton**: Expo Router, TypeScript, EAS config, environment-specific API URL, light and dark themes matching the web tokens. Runs in the iOS Simulator and Android emulator. | The app opens to a placeholder screen. CI type-checks it. |
| **9.4** | **Mobile sign-in**: email/password plus Google through Supabase (PKCE + deep link `appname://auth/callback`). The session is stored in `expo-secure-store`, and the access token is sent as a bearer to the API from step 1.2. | Sign in, sign out and token refresh all work on both platforms. |
| **9.5** | **Mobile to-do board**: one column at a time, long-press to drag within a column, and the "Move to…" menu between columns, on the shared API client, with pull to refresh, optimistic moves and swipe to delete (`react-native-gesture-handler`, see 17.6). | You can move a card on the phone and see it on the web. |
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
| **11.1** | **Connection**: a family setting (parents only) for the Home Assistant base URL plus a long-lived access token (encrypted with AES-GCM and a server key in env). A server-side client for the HA REST API. "Test connection" button. | Status shows as connected, and the token is never sent to the client. |
| **11.2** | **Device registry**: pick which HA entities appear in the app (vacuum, air purifier, sensors). Each one gets a friendly name, a room, and whether kids with Devices at edit may control it. | Only chosen devices are listed. |
| **11.3** | **Read-only dashboard**: vacuum state and battery, air-quality readings, purifier mode. | Live state on web and mobile. |
| **11.4** | **Controls**: start, stop or dock the vacuum, clean a room (Roborock segment cleaning through HA), set the purifier mode or fan speed. Every action is checked against the role and kid permissions, and written to an audit log. | A kid with Devices at view can't control anything; at edit, only the devices marked for kids. |
| **11.5** | (Optional) **Automations and alerts**: notify when the vacuum is stuck or a filter needs replacing, and make "clean the kitchen" a to-do card action. | |

## Phase 12: Polish that cuts across modules

- **12.1** (Folded into 17.4.) A home dashboard per role: today's to-dos, upcoming reminders, today's events, car reminders, device alerts. Parents see family finance widgets; kids see only the modules their permissions allow.
- **12.2** MCP tools for cars and devices.
- **12.3** Offline-first reads on mobile (cache with TanStack Query persistence) and an audit log page for parents.

## Phase 13: Later or optional

- **13.1** Grandparents and other relatives: a third member type with kid-style module permissions, private finance, and the right to leave on their own.
- **13.2** Account deletion moved to 14.9.
- **13.3** Optional grace period for family deletion (soft-delete for 7 days before the purge), if an accidental delete ever happens.

## Phase 14: Production hardening and security

The app is used every day and holds family finance data, so before more features it gets the review a real production app needs. **Starting point (26 October 2026):**
- RLS on every table, Zod on every route, and Supabase calls through supabase-js and RPCs with parameters, with no raw SQL.
- An in-memory rate limiter on sign-in, joining a family, password changes and MCP tokens.
- Security headers without a Content-Security-Policy or HSTS.
- 302 commits of history that have never been scanned for secrets.

| Step | What | Done when |
| --- | --- | --- |
| **14.1** | **Secrets**: scan the full Git history and the working tree with gitleaks, and add the scan to CI. Check that no `NEXT_PUBLIC_*` variable holds a secret, and search the built client bundle (`.next/static`) and the GHCR image for secret patterns (`sb_secret_`, the VAPID private key, tokens). Check committed screenshots and fixtures for real emails or data. Rotate anything that ever leaked. | The CI scan is green on the full history. A short report lists what was checked and what was rotated. |
| **14.2** | **Dependencies and supply chain**: `npm audit --omit=dev` in CI, failing on high and critical. Dependabot for npm, GitHub Actions and the Docker base image. Actions pinned by commit SHA. A Trivy scan of the image in the image workflow. | CI fails on a known vulnerable dependency. No open high or critical findings. |
| **14.3** | **HTTP security headers**: a Content-Security-Policy with a nonce set in `proxy.ts` (no `unsafe-inline` for scripts; `connect-src 'self'`, because the browser only talks to `/api`). HSTS once the HTTPS origin is final. `frame-ancestors 'none'` and `Cross-Origin-Opener-Policy`. Report-only first, then enforced. | No CSP violations in the logs (phase 15) for a week of report-only mode, then enforced. |
| **14.4** | **Cookies, sessions and CSRF**: the browser never talks to Supabase, so the auth cookies can be `HttpOnly`, `Secure` and `SameSite=Lax`. Check what `@supabase/ssr` sets and change it. Every mutating `/api` route checks `Origin` (or `Sec-Fetch-Site`) against the app's origin. Session lifetime, refresh and sign-out-everywhere are reviewed. | Route tests show a cross-site POST is refused. The cookie flags can be seen in the browser. |
| **14.5** | **Injection and input**: audit every PostgREST filter built from strings. For example, `expenses.ts` builds `.or()` from expense-tab category and subtype keys, so make sure only whitelisted keys can reach it. Also audit RPC parameters, `ilike` patterns, request body size limits and upload handling. Add a lint rule against template strings in `.or()`/`.filter()`. | Every filter takes either whitelisted keys or values passed as parameters, with tests. |
| **14.6** | **Data exposure**: responses carry only the fields the client needs, and no other user's email unless it's needed. Errors never include database messages. Logs redact tokens, cookies and emails. Run the Supabase security and performance advisors and fix their findings. Review every `security definer` function's `search_path` and grants. | The advisors are clean. Snapshot tests of response shapes for the family and account routes. |
| **14.7** | **Abuse limits**: extend rate limiting to every mutating route (per user) and to anonymous routes (per IP), with `429` and `Retry-After`. | A burst test gets `429` and the app stays responsive. |
| **14.8** | **Operations**: validate env at startup and fail fast with a clear message. Confirm Supabase backups, and do a test restore into a branch. The containers run read-only with `no-new-privileges`. An uptime and worker-heartbeat alert through Obsy. A written incident checklist (rotate keys, restore, roll back an image tag). | A restore has been rehearsed once. The checklist is in `docs/`. |
| **14.9** | **Privacy**: account deletion (moved here from 13.2), a data export for your own data, and a short privacy note. | A user can delete their account and download their data. |

## Phase 15: Logging, tracing and a log viewer on the VPS

Logs that let you find out what happened over the last few days, at almost no memory or CPU cost. **No Elasticsearch, Loki or Grafana stack.**

**Design:**
- **Every process logs one JSON line per event to stdout.** The worker already does this. The web app gets the same small logger: no dependency, or `pino` if measuring shows it's worth it.
- **"Tracing" means a request id plus timed spans inside the request's log line**, not a tracing backend. Each request gets an id (`x-request-id`, which is also returned to the client and shown in error toasts). Its log line carries `spans: [{ name: "reminders.list", ms: 12 }, …]` for Supabase calls, web-push sends and AI calls. Next's `instrumentation.ts` with OpenTelemetry stays an option, if this ever isn't enough.
- **Retention is time-based, through journald.** The containers use Docker's `journald` log driver. A journald drop-in on the VPS (`MaxRetentionSec=5day`, `SystemMaxUse=300M`) deletes anything older automatically and keeps the total size capped. `docker logs` and `journalctl CONTAINER_NAME=…` both keep working.
- **Viewing on the VPS:** a **Logs** page in Obsy, which already reads Docker through its socket. It offers a container picker, level, a time range (last hour, today, 3 days), text or request-id search, and live tail. The same queries also work with `journalctl … -o cat | jq` over SSH.

| Step | What | Done when |
| --- | --- | --- |
| **15.1** | **Shared logger**: `src/lib/log.ts` used by the web app and the worker. It writes levels, a timestamp, the request id, route, status, duration and user id (never emails, tokens or bodies), with redaction for known secret fields. `withUser` logs one line per request. | One line per request in `docker logs`, with redaction tests. |
| **15.2** | **Spans**: a `span(name, fn)` helper that times repository, RPC, push and AI calls into the current request's log line (AsyncLocalStorage). A `slow` warning for requests over 1 s. | The log line of a slow page shows which call was slow. |
| **15.3** | **Client errors and Web Vitals**: error boundaries, `unhandledrejection` and the Web Vitals (LCP, INP, CLS, TTFB) go to a small, rate-limited, sampled `POST /api/client-log`. CSP reports from 14.3 land in the same place. | A forced client error shows up in the logs with the user's request id. |
| **15.4** | **Retention**: `scripts/deploy.sh` runs the containers with `--log-driver journald` and a tag. The vps-apps README documents the journald drop-in (George applies it on the VPS). | `journalctl` shows nothing older than the retention window. Disk use stays under the cap. |
| **15.5** | **Obsy Logs page** (vps-apps): filters, search by request id, live tail, and links from a container's card. It's read-only and only reachable the same way Obsy already is. | A request id from an error toast can be found in Obsy within a few seconds. |
| **15.6** | (Optional) **Simple metrics from the logs**: requests per minute, p50/p95 per route, error rate and the worker heartbeat's age on Obsy's dashboard. | The numbers match a manual check. |

## Phase 16: Performance, loading and smooth interaction

The goal: pages appear fast, nothing spins forever, errors show up as errors with a retry, and taps respond at once. **Starting point (26 October 2026):**
- The API client already times out after 15 s.
- There's one `error.tsx` (for `(app)`), no `loading.tsx`, and no global `SWRConfig`.
- Pages fetch everything in the browser after load.

| Step | What | Done when |
| --- | --- | --- |
| **16.1** | **Measure first**: Web Vitals from real use (15.3), server timings (15.2), the bundle analyzer per route, and the container's memory in Obsy. A baseline table in `docs/`. | The baseline is written down and the budgets below are agreed. |
| **16.2** | **No endless loading**: a global `SWRConfig` with limited error retries, `loadingTimeout` and `onLoadingSlow` ("This is taking longer than usual", with a retry). A `loading.tsx` with skeletons and an `error.tsx` with retry for every section. Every data state ends in content, empty or error. Auth expiry during a request leads to sign-in, not a spinner. | With the API stopped, every screen shows an error with a retry within 15 s. No screen ever shows a spinner with no end. |
| **16.3** | **Faster first paint**: load each page's first data on the server and stream it with `Suspense`, instead of fetching after the page has loaded. Prefetch navigation links. Remove request waterfalls (parallel requests, combined endpoints where it helps). Cache stable data (account, family, categories) longer. | LCP under 2.5 s on a mid-range phone for Home, Expenses, To-dos and Reminders. |
| **16.4** | **Smaller bundles**: dynamically import the heavy parts (charts, dnd-kit, dialogs, the AI chat later). Drop unused dependencies. `next/font` and `next/image` for avatars. Check `optimizePackageImports`. | JS per route is under the agreed budget, as the analyzer shows. |
| **16.5** | **Database**: indexes for the slow queries the spans show, the Supabase performance advisor, and fewer round trips per page. | No route's p95 is over 300 ms on the server. |
| **16.6** | **Smooth interaction**: optimistic updates everywhere a write is likely to succeed, no layout shift when data arrives (skeletons sized like the content), transitions that respect `prefers-reduced-motion`, and fewer re-renders on big lists. | INP under 200 ms. CLS under 0.1. |
| **16.7** | **Lean runtime on the VPS**: a Node heap cap for the web and worker containers, `experimental.preloadEntriesOnStart: false` if memory matters more than the first request after a deploy, and the containers' memory tracked in Obsy. | Steady-state memory is measured and within the VPS budget. |

## Phase 17: A simpler UI, mobile first

The app has grown screen by screen and now shows too much at once, especially on phones. This phase rethinks it before more modules land.

| Step | What | Done when |
| --- | --- | --- |
| **17.1** | **Audit**: for each screen, list what it shows, the two or three things people actually do there, and what can be hidden, merged or moved. Includes the navigation (sidebar sections, the phone's bottom bar and More sheet) and the many Settings tabs. | A one-page audit per screen, reviewed with George. |
| **17.2** | **Direction and mockups**: a short design direction (density, hierarchy, one primary action per screen, progressive disclosure), plus 390 px mockups of the main screens in `/dev/preview` before anything is built. | George signs off the mockups. |
| **17.3** | **Navigation**: a bottom bar for the daily screens (for example Home, Expenses, Planning, More), fewer Settings tabs, and the same structure in the sidebar. | Screenshots at 390 and 1280 px. |
| **17.4** | **Home as "today"**: what's due, recent spending and quick add, instead of every widget. Absorbs roadmap 12.1. | Screenshots, and Home fits one phone screen without scrolling for a typical day. |
| **17.5** | **Screen by screen**: Expenses, Investments, Net worth, To-dos, Reminders and Settings, one PR each, following the mockups. | Screenshots, with George's sign-off per screen. |
| **17.6** | **Swipe actions on phones**: swipe a to-do card left to **delete** (with an undo toast), and later a reminder row for Done or Snooze. **Phone web: yes.** Pointer events tell a horizontal swipe from vertical scrolling and from the board's long-press drag (dnd-kit): moving 10 px sideways before the 200 ms long-press starts a swipe. **Desktop: no swipe.** Trackpad side-scrolling clashes with it, so cards get a delete icon on hover plus the `Delete` key on a focused card. **Native (9.5):** `react-native-gesture-handler`'s `Swipeable`, which is the natural place for it. | On a phone, swiping deletes with undo, and scrolling and long-press drag still work. On desktop, hover and keyboard delete work. |
| **17.7** | **Accessibility pass**: contrast, focus order, screen-reader labels and 44 px touch targets on the new screens. | No axe violations on the main screens. |

## Phase 18: Code clean-up and fewer, better tests (optional)

Low priority. **Starting point (26 October 2026):** about 26,000 lines of tests in 162 files for about 34,500 lines of code. Many features are tested at the repository, service and route levels with overlapping cases.

| Step | What | Done when |
| --- | --- | --- |
| **18.1** | **Inventory**: a coverage report, the slowest tests, and duplicate cases across the layers. Find dead code with `knip`. | A list of what to merge, delete or keep. |
| **18.2** | **Test strategy**: behaviour is tested once, at the service level (use cases, with fakes). Each route has one test file for auth, validation and response shape. Repositories are tested for mapping and errors only. SQL RLS tests all stay, because they're security-critical. Table-driven tests replace near-copies. Written into `docs/`. | George agrees the strategy. |
| **18.3** | **Reduce, module by module**, without lowering behaviour coverage on `src/lib/**`. | Test lines down by roughly 40%, coverage the same, CI faster. |
| **18.4** | **Refactor** (move-only PRs): shared fakes and fixtures, large files split, patterns made consistent (service and repository), dead code removed. | No behaviour change. Lint, types and tests green. |

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
| **Public HTTPS or Tailscale only** | Stay on Tailscale through phase 8. Decide before 3.5 or the store releases. | Phones need the Tailscale app to reach the API. claude.ai MCP connectors (3.5), Google Calendar, new Outlook and Outlook.com subscribing to the calendar feed (C8 in calendar-plan.md) and some OAuth redirects need a public URL (Tailscale Funnel or a Cloudflare Tunnel both work). Web Push needs HTTPS but not a public URL. |
| **Email provider** | Decided (25 October 2026): Gmail SMTP from George's existing Gmail account with an app password, behind an `EmailSender` interface. Resend if a domain is ever bought | No domain, so providers that need SPF and DKIM on your own domain are out. Supabase Auth's email is only for sign-in emails. |
| **One to-do board or several** | Decided: one board per family, filtered by member; no private cards. See [todo-board-plan.md](todo-board-plan.md) | Simpler for a family, and member chips cover "show me Ana's to-dos". |
| **Banks and formats for statement import** | Open, needed before 7.2: which banks, and whether each gives CSV, PDF or both | Every bank needs its own parser and fixtures. |
| **How MCP clients sign in** | Decided: OAuth through Supabase Auth's OAuth 2.1 server, behind our own interfaces so leaving Supabase stays cheap, plus personal access tokens (1, 3 or 6 months, or never with a warning) for headless machines. Kids: OAuth only, with a parent's permission and a confirmed real email. See [mcp-access-plan.md](mcp-access-plan.md) | Using the secret key to read data would bypass RLS for every MCP call; a home-made OAuth server would still need Supabase to act as the user. |
| **AI provider, cost and privacy** | Claude API (a small model for parsing and categories, a larger one for the assistant), opt-in per user, kids with a parent's permission. You choose the global monthly budget and the per-user caps before 8.1. | The budget is what the kill switch enforces. |
| **Log retention** | 5 days through journald, capped at 300 MB. Your call on the number of days. | Longer means more disk; the cap keeps it bounded either way. |
| **Who is an admin** | Your own account, by user id in env (`APP_ADMIN_USER_IDS`) | The AI usage page and the kill switch need an owner who isn't tied to a family role. |
| **UI direction** | Sign off the 17.2 mockups before any screen is rebuilt | Rebuilding screens without an agreed direction would mean doing it twice. |
| **Mac calendar** | Decided (28 October 2026): a read-only feed per member with only the events they attend; no Google sync, no CalDAV. See [calendar-plan.md](calendar-plan.md) | Apple Calendar on a Mac or iPhone with Tailscale subscribes now; Google and Outlook.com subscribe once the app has a public URL. |
| **Reminder rules** | Decided: reminders are strictly personal; to ask someone else, assign them a to-do (phase 5) | |
| **Home Assistant** | Use it if you already run HA, or are willing to. It's a Docker container on the VPS or a Raspberry Pi at home. | The alternative is reverse-engineered vendor clouds (python-roborock, miio), which are fragile and may break the vendors' terms. |
| **Finance visibility** | Decided: parents see every member's finance read-only, kids only with Family finance on (decision 3, step 1.7) | It widens the read policies on every finance table, so every finance read needs an explicit owner filter first. |
| **Kids' sign-in** | Decided: a username account created by a parent (or a kid code or link). A real email can be added later (step 1.5) | Creating accounts on the server needs the Supabase secret key, which the app doesn't have yet. |
| **Can a non-creator parent leave?** | Yes, on their own. Their finance stops being visible to the family | Otherwise only the creator can get them out. |
| **What if the creator wants to leave?** | Let the creator hand over the creator flag to another parent, then leave as a normal parent. Otherwise the only way out is deleting the family | Without a handover, the creator can't leave without wiping everyone's family data. |
| **Family totals across currencies** | Group by currency, with no conversion, until there's a source for FX rates | Members can pick different currencies in `profiles.currency`. |
