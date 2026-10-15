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
2. **A "family" is a `household`.** Members have a role. Data for the new modules (to-dos, calendar, cars, houses, devices) belongs to the household and is checked by RLS through one SQL helper. Every policy asks the same question: is the caller a member with role X?
3. **Finance stays personal.** Expenses, investments and net worth keep their owner-only RLS. Children can't see them because they were never shared, so no "hide" logic is needed. Sharing finance with a partner can come later as an opt-in (step 9.1).
4. **Roles are `owner`, `parent` and `child`.** One permission table in code (`can(role, action, module)`) is mirrored by SQL helpers. To start, children can see and tick off to-dos assigned to them and see the family calendar. They have no finance access and only read access to cars, houses and devices.
5. **Smart devices go through Home Assistant, not each vendor.** Roborock has no official public API, and air purifiers each use a different cloud. Home Assistant already supports Roborock, Xiaomi, Philips, Dyson and most others. The app stores one Home Assistant URL and token per household, reads entity states, and calls services.
6. **Google Calendar sync runs in a background worker, not in a request handler.** It's a small Node process in the same Docker image (`node dist/worker.js`) that uses Google's incremental `syncToken`. It polls every couple of minutes at first, and push webhooks come later if the app becomes publicly reachable.
7. **Feature flags.** A `household_modules` row, or an env flag for early steps, hides each module's navigation and API until it's ready.

## Phase 0: Safety net and rename

| Step | What | Done when |
| --- | --- | --- |
| **0.1** | **CI for pull requests**: a GitHub workflow running `lint`, `typecheck`, `test` and `test:db` (a Supabase CLI local stack) on every PR. | A PR shows green checks, and a deliberately broken RLS test fails CI. |
| **0.2** | **Central brand constant**: move "Simple Ledger" from `brand.tsx`, `manifest.ts`, page titles, email copy and MCP server info into one `src/lib/brand.ts`. The name doesn't change yet. | `grep "Simple Ledger"` hits only `brand.ts` and the README. |
| **0.3** | **Rename** the product to the new name: UI, manifest, icons, README, MCP `serverInfo`. Rename the repo, Docker image and domain in a separate ops change. | The app shows the new name. No routes or data change. |
| **0.4** | **Navigation that scales**: today's nav has 5 items. Group them into sections (Finance, Family, Home), keeping the current pages under Finance. This is a structural change with no new features. | Existing pages work. Mobile tab bar plus More sheet still pass the layout screenshots. |

## Phase 1: Foundations (households, roles, a native-ready API)

| Step | What | Done when |
| --- | --- | --- |
| **1.1** | **Households schema**: `households`, `household_members (household_id, user_id, role, joined_at)`, and the SQL helpers `private.is_household_member(hid)` and `private.has_household_role(hid, roles[])` (security definer, `search_path` pinned). RLS on both tables. No UI. | SQL tests prove a non-member can't read a household, a child can't change roles, and the last owner can't leave. |
| **1.2** | **Auto-create a personal household** on first sign-in or profile upsert, with the user as `owner`. Backfill a household for each existing user. Add `getCurrentHousehold()` on the server. | Every existing account has exactly one household. Finance pages are unchanged. |
| **1.3** | **Bearer-token auth in `withUser`**: accept `Authorization: Bearer <supabase access token>` as well as cookies, and build the Supabase client from the token. Cookie behaviour doesn't change. Basic auth for MCP stays as it is. | Route tests cover cookie, bearer, an expired bearer (401) and a bearer for another user's data (404 or empty). |
| **1.4** | **Permissions module**: a `can(role, action, module)` matrix in `src/lib/permissions.ts` with exhaustive tests, a `withHouseholdRole(...)` route wrapper, and a `useCan()` hook for the UI. | The matrix is snapshot-tested. Routes reject a forbidden role with 403. |
| **1.5** | **Invites**: `household_invites` (email, role, token hash, expiry). A parent invites by email or link, and the invitee accepts after signing in. Add a Settings → Family page listing members, roles and pending invites. | A second account can join. Roles can be changed by owner or parent only. A child can't invite. |
| **1.6** | **Household switcher** (only when a user belongs to more than one): the active household is stored per user and passed to API calls. | The switcher is hidden for single-household users. Data scoping is verified in tests. |

> Children's accounts: in this phase a child is just a member with a login (their own email or a Google account). Profiles without a login, for kids too young for an account, are step 9.2.

## Phase 2: Profiles and avatars

| Step | What | Done when |
| --- | --- | --- |
| **2.1** | `profiles.display_name`, `profiles.avatar_path`, `profiles.color` (used for calendar and to-do chips). A Settings → Profile form. | The name shows in the family member list. |
| **2.2** | **Avatar upload**: a Supabase Storage bucket `avatars`. Path `user_id/<uuid>.webp`. RLS lets you write your own folder and lets household members read each other's. Resize on the client before upload, and send it through a signed upload URL from the API. | Upload, replace and remove work. A non-member gets 403 on the object. |
| **2.3** | A shared `<Avatar>` component with an initials fallback, used in the sidebar, the family list and later in to-dos and the calendar. | Shows up in the UI gallery (`/dev/ui`). |

## Phase 3: Family to-dos

| Step | What | Done when |
| --- | --- | --- |
| **3.1** | **Schema**: `todo_lists (household_id, name, visibility: family / parents / private)` and `todos (list_id, title, notes, assignee_id, due_date, completed_at, completed_by, created_by, position)`. RLS: children see `family` lists, and their own private ones. | SQL tests cover child, parent and other-household access. |
| **3.2** | API routes, validation and data layer, following the existing `expense-tabs` pattern. Children may only toggle completion on to-dos assigned to them. | Route tests per role. |
| **3.3** | **Web UI**: list overview, list detail, quick add, assign to member (avatar), filters for "Mine", "Today" and "Overdue". | Screenshots at 390 and 1280 px. |
| **3.4** | MCP tools `list_todos`, `add_todo`, `complete_todo`, with roles enforced. | The tool-surface snapshot is updated. |
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
| **5.1** | **Schema**: `calendars (household_id, name, color, visibility)`, `events (calendar_id, title, starts_at, ends_at, all_day, timezone, rrule, location, notes, attendee member ids)`, `event_exceptions` for edited or cancelled recurring instances. Store `timestamptz` plus an IANA timezone. | SQL RLS tests per role. |
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
| **6.1** | **Vehicles**: `vehicles (household_id, name, make, model, year, plate, VIN, fuel type, photo)` and an optional `expenses.vehicle_id` so the existing `car_fuel`, `car_maintenance` and `car_repairs` subtypes link to a car. | A car's detail page shows its expenses. Finance stays personal: you only see your own linked expenses. |
| **6.2** | **Vehicle documents and reminders**: ITP, RCA, CASCO, rovinietă and service intervals (date or km), plus odometer logs. Reminders go to the calendar and push notifications. | A reminder fires N days before expiry. |
| **6.3** | **Houses**: `properties (household_id, name, address, area, rooms, year built, photo)`, an optional link to a `net_worth_items` property, utility providers and contract numbers, and documents in Storage. | The house detail page shows linked net-worth value history if you own that item. |
| **6.4** | **Maintenance log and recurring tasks** for houses (boiler check, filter changes) that create to-dos from phase 3. | A recurring task creates a to-do on schedule. |

## Phase 7: Smart home through Home Assistant

| Step | What | Done when |
| --- | --- | --- |
| **7.1** | **Connection**: a household setting for the Home Assistant base URL plus a long-lived access token (encrypted like the Google tokens). A server-side client for the HA REST API. "Test connection" button. | Status shows as connected, and the token is never sent to the client. |
| **7.2** | **Device registry**: pick which HA entities appear in the app (vacuum, air purifier, sensors). Each one gets a friendly name, a room, and a minimum role to control it. | Only chosen devices are listed. |
| **7.3** | **Read-only dashboard**: vacuum state and battery, air-quality readings, purifier mode. | Live state on web and mobile. |
| **7.4** | **Controls**: start, stop or dock the vacuum, clean a room (Roborock segment cleaning through HA), set the purifier mode or fan speed. Every action is role-checked and written to an audit log. | A child can't control a device that needs the parent role. |
| **7.5** | (Optional) **Automations and alerts**: notify when the vacuum is stuck or a filter needs replacing, and make "clean the kitchen" a to-do action. | |

## Phase 8: Polish that cuts across modules

- **8.1** A home dashboard per role: today's to-dos, today's events, car reminders, device alerts. Parents also see finance widgets.
- **8.2** MCP tools for the calendar, cars and devices, so Claude can answer things like "what's on the family calendar this week?"
- **8.3** Offline-first reads on mobile (cache with TanStack Query persistence) and an audit log page for parents.

## Phase 9: Later or optional

- **9.1** Opt-in finance sharing with a partner: shared expense tabs or a shared net-worth view, gated to `parent` and never visible to children.
- **9.2** Profiles without a login ("managed members") for young children, who can be assigned to-dos and events without having an account.
- **9.3** Per-member permission overrides on top of the roles, such as a teenager who can control the vacuum.

## How every step is reviewed

Each PR should include:

1. **The migration and its RLS SQL test**, for any schema change. New tables always ship with `enable row level security`, explicit grants, and policies built on the household helpers.
2. **Route tests for each role** (owner, parent, child, non-member) for any new endpoint.
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
| **Finance visibility** | Keep it personal (decision 3 above) | This avoids rewriting the RLS on every existing table now. |
| **Children's sign-in** | Their own Google or email account at first | A profile without a login (9.2) adds a second type of identity everywhere. |
