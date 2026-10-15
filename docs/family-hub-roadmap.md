# Family hub roadmap

Prepared 15 October 2026. This plan grows Simple Ledger from a single-user expense tracker into a family app: families and roles, profile pictures, to-dos, a shared calendar with two-way Google Calendar sync, cars, houses, smart-home devices, and native iOS/Android apps built with Expo.

Every numbered step below is meant to be **one pull request** that can be reviewed on its own, merged, and deployed without breaking what already works. Unfinished modules stay hidden behind a flag, so `main` is always shippable.

## Where the app is today

These facts shape the plan:

- **Single-owner data model.** Every table (`expenses`, `expense_tabs`, `investment_*`, `net_worth_*`) has a `user_id` column, and its RLS policy is `auth.uid() = user_id`. There is no idea of a group yet.
- **`profiles` already exists** (`id`, `email`, `currency`). Display name and avatar can go there.
- **The browser never talks to Supabase directly.** Next.js route handlers in `src/app/api/**` use `withUser` (`src/lib/http/route.ts`), which reads the user from **cookies**. The Supabase keys are server-only. A native app can't use cookies the same way, so the API has to accept a bearer token as well (step 1.3).
- **The domain logic is already separate from the UI.** Zod schemas (`src/lib/validation`), types and calculations (`src/lib/expenses`, `src/lib/net-worth`, `src/lib/investments`) don't depend on Chakra, so the Expo app can reuse them.
- **The production VPS is reachable only over Tailscale.** This matters for phones, which need Tailscale, and for Google Calendar push webhooks, which need a public HTTPS URL (see "Decisions you need to make").
- **Tests:** Vitest for units and routes, plus SQL RLS tests in `supabase/tests` run by `npm run test:db`. The only workflows are deploy and VPS notification. Nothing runs checks on pull requests yet.

## Architecture decisions (recommended)

1. **Keep Next.js as the web app and the backend. Add Expo as a second client for iOS and Android.** Don't rewrite the web app in Expo or React Native Web. The Chakra UI, the dashboards and the PWA keep working, and both clients call the same API with the same validation. The two apps share code through a workspace package, not through UI components.
2. **One family per user.** A user creates a family or joins one with an invite code or link. Nobody belongs to more than one family, so there is no family switcher and no "active family" to pass around: the caller's family follows from their membership. Data for the new modules (to-dos, calendar, cars, houses, devices) belongs to the family and is checked by RLS through a few SQL helpers.
3. **Parents see the whole family's finance, read-only.** Parents see every member's expenses, investments and net worth, including each other's. They can't change data that isn't theirs: only the read policies widen, and insert, update and delete stay owner-only. Kids see only their own finance, plus the rest of the family's if a parent turns on the "Family finance" permission for them. MCP keeps working on the caller's own data only.
4. **Two roles, `parent` and `kid`, plus a creator flag.** The member who created the family is its creator, and only the creator can remove members or delete the family. Parents have every permission. Each kid has their own permission set, chosen by a parent and changeable at any time, so two kids in one family can see different things. Kids can't leave the family on their own, and they're never promoted to parent. Grandparents and other relatives are out of scope for now (step 9.1).
5. **Smart devices go through Home Assistant, not each vendor.** Roborock has no official public API, and air purifiers each use a different cloud. Home Assistant already supports Roborock, Xiaomi, Philips, Dyson and most others. The app stores one Home Assistant URL and token per family, reads entity states, and calls services.
6. **Google Calendar sync runs in a background worker, not in a request handler.** It's a small Node process in the same Docker image (`node dist/worker.js`) that uses Google's incremental `syncToken`. It polls every couple of minutes at first, and push webhooks come later if the app becomes publicly reachable.
7. **Feature flags.** An env flag hides each unfinished module's navigation and API until it's ready. This is separate from kid permissions, which decide what a finished module shows to each kid.
8. **Supabase sits behind interfaces.** Routes, MCP tools and use cases talk to storage through repository interfaces (`ExpenseRepository`, `FamilyRepository`, …) and to auth through `AuthService` / `AuthAdmin`. Supabase is one implementation, chosen in two composition roots, and a lint rule stops Supabase imports from leaking elsewhere. New SQL identifies the caller through `app_private.current_user_id()` instead of `auth.uid()`. Moving to another Postgres host or auth provider then means writing new implementations, not touching the app. The frontend already only talks to `/api`.

## Phase 0: Safety net and rename

| Step | What | Done when |
| --- | --- | --- |
| **0.1** | **CI for pull requests**: a GitHub workflow running `lint`, `typecheck`, `test` and `test:db` (a Supabase CLI local stack) on every PR. | A PR shows green checks, and a deliberately broken RLS test fails CI. |
| **0.2** | **Central brand constant**: move "Simple Ledger" from `brand.tsx`, `manifest.ts`, page titles, email copy and MCP server info into one `src/lib/brand.ts`. The name doesn't change yet. | `grep "Simple Ledger"` hits only `brand.ts` and the README. |
| **0.3** | **Rename** the product to the new name: UI, manifest, icons, README, MCP `serverInfo`. Rename the repo, Docker image and domain in a separate ops change. | The app shows the new name. No routes or data change. |
| **0.4** | **Navigation that scales**: today's nav has 5 items. Group them into sections (Finance, Family, Home), keeping the current pages under Finance. This is a structural change with no new features. | Existing pages work. Mobile tab bar plus More sheet still pass the layout screenshots. |

## Phase 1: Foundations (families, roles, permissions, a native-ready API)

The step-by-step task breakdown is in [family-phase-1-tasks.md](family-phase-1-tasks.md), one agent and one PR per task. It starts with **step 0 (R01–R10)**, which moves the existing Supabase code behind repository and auth interfaces (decision 8) and runs alongside the SQL-only step 1.1.

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
| To-dos, Calendar (phases 3 and 5) | off / view / edit | edit |
| Cars, Houses, Devices (phases 6 and 7) | off / view / edit | view |

Parents always have every permission, and no one can restrict a parent. A module that's off is hidden from the navigation **and** refused by the API with 403. Hiding the navigation alone isn't enough.

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

> Kids are real accounts with a username, created by a parent or joined with a code. Grandparents and other relatives (step 9.1) are out of scope for now.

## Phase 2: Profiles and avatars

| Step | What | Done when |
| --- | --- | --- |
| **2.1** | `profiles.avatar_path` and `profiles.color` (used for calendar and to-do chips). `display_name` and `username` already arrive in phase 1 (task F04). A Settings → Profile form for editing the display name and color. | Members can change their own display name, and the family list shows it. |
| **2.2** | **Avatar upload**: a Supabase Storage bucket `avatars`. Path `user_id/<uuid>.webp`. RLS lets you write your own folder and lets family members read each other's. Resize on the client before upload, and send it through a signed upload URL from the API. | Upload, replace and remove work. A non-member gets 403 on the object. |
| **2.3** | A shared `<Avatar>` component with an initials fallback, used in the sidebar, the family list and later in to-dos and the calendar. | Shows up in the UI gallery (`/dev/ui`). |

## Phase 3: Family to-dos

| Step | What | Done when |
| --- | --- | --- |
| **3.1** | **Schema**: `todo_lists (family_id, name, visibility: family / parents / private)` and `todos (list_id, title, notes, assignee_id, due_date, completed_at, completed_by, created_by, position)`. RLS: kids with To-dos on see `family` lists, and their own private ones. | SQL tests cover kid (To-dos off, view and edit), parent and other-family access. |
| **3.2** | API routes, validation and data layer, following the existing `expense-tabs` pattern. Kids with To-dos at view may only toggle completion on to-dos assigned to them; at edit they can also add and edit. | Route tests per role and permission level. |
| **3.3** | **Web UI**: list overview, list detail, quick add, assign to member (avatar), filters for "Mine", "Today" and "Overdue". | Screenshots at 390 and 1280 px. |
| **3.4** | MCP tools `list_todos`, `add_todo`, `complete_todo`, with roles and kid permissions enforced. | The tool-surface snapshot is updated. |
| **3.5** | (Optional) Recurring to-dos (`rrule`), such as "take out the trash every Tuesday". | The next instance is created when the current one is completed. |

## Phase 4: Native apps (Expo), first vertical slice

The idea is to ship one small, useful native feature (to-dos) end to end before adding anything else.

| Step | What | Done when |
| --- | --- | --- |
| **4.1** | **Convert to an npm-workspaces monorepo** with **moves only**: `apps/web` (today's Next app), `packages/core` (Zod schemas, types, pure domain logic, API response types). No behaviour change. Update Docker and CI paths. | `npm run check`, the tests and the Docker build pass. The diff is renames plus import paths. |
| **4.2** | **Typed API client in `packages/core`**: `createApiClient({ baseUrl, getToken })`, used by web (cookies, no token) and mobile (bearer). Move the web SWR fetchers onto it. | The web app still passes. The client has unit tests. |
| **4.3** | **`apps/mobile` Expo skeleton**: Expo Router, TypeScript, EAS config, environment-specific API URL, light and dark themes matching the web tokens. Runs in the iOS Simulator and Android emulator. | The app opens to a placeholder screen. CI type-checks it. |
| **4.4** | **Mobile sign-in**: email/password plus Google through Supabase (PKCE + deep link `appname://auth/callback`). The session is stored in `expo-secure-store`, and the access token is sent as a bearer to the API from step 1.3. | Sign in, sign out and token refresh all work on both platforms. |
| **4.5** | **Mobile to-dos**: the lists and to-dos screens on the shared API client, with pull to refresh and optimistic toggles. | You can tick a to-do on the phone and see it on the web. |
| **4.6** | **Push notifications**: `expo-notifications`, a `push_tokens` table, and a server helper to send through the Expo Push API. The first trigger is "a to-do was assigned to you". | A notification arrives on a physical device (development build). |
| **4.7** | **Distribution**: an EAS development build for your devices, then TestFlight and Play internal testing. | A family member installs from TestFlight. |

After 4.7, every later feature step gets a "web + mobile" pair (for example 5.4a web, 5.4b mobile) instead of a single step.

## Phase 5: Family calendar and two-way Google sync

| Step | What | Done when |
| --- | --- | --- |
| **5.1** | **Schema**: `calendars (family_id, name, color, visibility)`, `events (calendar_id, title, starts_at, ends_at, all_day, timezone, rrule, location, notes, attendee member ids)`, `event_exceptions` for edited or cancelled recurring instances. Store `timestamptz` plus an IANA timezone. | SQL RLS tests per role and kid permission level. |
| **5.2** | API plus a **web calendar** with month, week and agenda views. Events are coloured by member. Expand recurrences server-side for the visible range. | Create, edit and delete for single and recurring events. Tests cover DST edges in Europe/Bucharest. |
| **5.3** | **Mobile calendar**: agenda plus a month view. | Parity with the web for viewing and creating events. |
| **5.4** | **Google account connection**: a separate Google OAuth flow with the `calendar.events` scope, `access_type=offline` and `prompt=consent`. Store the refresh token **encrypted** (AES-GCM with a server key in env) in `google_connections`. Pick which Google calendar maps to which family calendar. | Connect and disconnect work, and disconnecting revokes the token. Tokens are never sent to the client. |
| **5.5** | **Worker process**: add `worker.ts` to the same image as a second container on the VPS, with a job lock table so two workers don't overlap. It only logs at first. | The worker heartbeat appears in `/health` or the logs. |
| **5.6** | **Google → app (import)**: incremental sync using `syncToken`, and a full resync on 410 Gone. Events are matched by `google_event_id` + `etag`. | Editing an event in Google shows up in the app within the poll interval. |
| **5.7** | **App → Google (export)**: an outbox table written in the same transaction as each event change. The worker pushes it to Google with `If-Match` on the etag. **Conflict rule:** the latest `updated` wins, and the losing version is saved to an `event_conflicts` log you can review. | Round-trip tests with a fake Google client. No echo loops (your own writes are ignored on import). |
| **5.8** | (Optional, needs a public HTTPS URL) **Push webhooks** through `events.watch`, renewed before expiry, replacing polling for connected calendars. | Changes in Google arrive within seconds. |

## Phase 6: Cars and houses

| Step | What | Done when |
| --- | --- | --- |
| **6.1** | **Vehicles**: `vehicles (family_id, name, make, model, year, plate, VIN, fuel type, photo)` and an optional `expenses.vehicle_id` so the existing `car_fuel`, `car_maintenance` and `car_repairs` subtypes link to a car. | A car's detail page shows its expenses. Linked expenses follow the finance rules from 1.7: parents see every member's, kids only their own unless Family finance is on. |
| **6.2** | **Vehicle documents and reminders**: ITP, RCA, CASCO, rovinietă and service intervals (date or km), plus odometer logs. Reminders go to the calendar and push notifications. | A reminder fires N days before expiry. |
| **6.3** | **Houses**: `properties (family_id, name, address, area, rooms, year built, photo)`, an optional link to a `net_worth_items` property, utility providers and contract numbers, and documents in Storage. | The house detail page shows linked net-worth value history if you can see that item under the finance rules from 1.7. |
| **6.4** | **Maintenance log and recurring tasks** for houses (boiler check, filter changes) that create to-dos from phase 3. | A recurring task creates a to-do on schedule. |

## Phase 7: Smart home through Home Assistant

| Step | What | Done when |
| --- | --- | --- |
| **7.1** | **Connection**: a family setting (parents only) for the Home Assistant base URL plus a long-lived access token (encrypted like the Google tokens). A server-side client for the HA REST API. "Test connection" button. | Status shows as connected, and the token is never sent to the client. |
| **7.2** | **Device registry**: pick which HA entities appear in the app (vacuum, air purifier, sensors). Each one gets a friendly name, a room, and whether kids with Devices at edit may control it. | Only chosen devices are listed. |
| **7.3** | **Read-only dashboard**: vacuum state and battery, air-quality readings, purifier mode. | Live state on web and mobile. |
| **7.4** | **Controls**: start, stop or dock the vacuum, clean a room (Roborock segment cleaning through HA), set the purifier mode or fan speed. Every action is checked against the role and kid permissions, and written to an audit log. | A kid with Devices at view can't control anything; at edit, only the devices marked for kids. |
| **7.5** | (Optional) **Automations and alerts**: notify when the vacuum is stuck or a filter needs replacing, and make "clean the kitchen" a to-do action. | |

## Phase 8: Polish that cuts across modules

- **8.1** A home dashboard per role: today's to-dos, today's events, car reminders, device alerts. Parents see family finance widgets; kids see only the modules their permissions allow.
- **8.2** MCP tools for the calendar, cars and devices, so Claude can answer things like "what's on the family calendar this week?"
- **8.3** Offline-first reads on mobile (cache with TanStack Query persistence) and an audit log page for parents.

## Phase 9: Later or optional

- **9.1** Grandparents and other relatives: a third member type with kid-style module permissions, private finance, and the right to leave on their own.
- **9.2** Account deletion for every user. Kids can't leave their family, so this is also how a grown-up kid gets out. The EU requires it before the app has outside users.
- **9.3** Optional grace period for family deletion (soft-delete for 7 days before the purge), if an accidental delete ever happens.

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
| **Public HTTPS or Tailscale only** | Stay on Tailscale through phase 5.7. Decide before 5.8 or the store releases. | Phones need the Tailscale app to reach the API. Google push webhooks and some OAuth redirects need a public URL (Tailscale Funnel or a Cloudflare Tunnel both work). |
| **Google OAuth consent screen** | Publish the OAuth app "In production" (unverified is fine for family use, under 100 users) | In "Testing" status, Google refresh tokens for sensitive scopes like Calendar **expire after 7 days**, so the sync would keep breaking. |
| **Home Assistant** | Use it if you already run HA, or are willing to. It's a Docker container on the VPS or a Raspberry Pi at home. | The alternative is reverse-engineered vendor clouds (python-roborock, miio), which are fragile and may break the vendors' terms. |
| **Finance visibility** | Decided: parents see every member's finance read-only, kids only with Family finance on (decision 3, step 1.7) | It widens the read policies on every finance table, so every finance read needs an explicit owner filter first. |
| **Kids' sign-in** | Decided: a username account created by a parent (or a kid code or link). A real email can be added later (step 1.5) | Creating accounts on the server needs the Supabase secret key, which the app doesn't have yet. |
| **Can a non-creator parent leave?** | Yes, on their own. Their finance stops being visible to the family | Otherwise only the creator can get them out. |
| **What if the creator wants to leave?** | Let the creator hand over the creator flag to another parent, then leave as a normal parent. Otherwise the only way out is deleting the family | Without a handover, the creator can't leave without wiping everyone's family data. |
| **Family totals across currencies** | Group by currency, with no conversion, until there's a source for FX rates | Members can pick different currencies in `profiles.currency`. |
