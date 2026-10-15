# Phase 1 tasks: families, roles and permissions

This document splits phase 1 of the [family hub roadmap](family-hub-roadmap.md) into small tasks, each sized for **one fresh agent and one pull request**:

- **Step 0 (R01–R10)** first puts Supabase behind repository and auth interfaces, so the database or auth provider can be replaced later by writing new implementations instead of touching routes, MCP tools or the UI.
- **Steps 1.1–1.7 (F01–F48)** then build the family features on top of those interfaces.

An agent needs only two things: the shared sections below (how the work is run, the shared names, the conventions) and its own task.

## How to run a task

Start each agent with this prompt, replacing `<ID>` with the task id, such as `R02` or `F15`:

> Read `AGENTS.md`, then read `docs/family-phase-1-tasks.md`: the sections "How to run a task", "Shared names" and "Conventions", and then task <ID>. Do only task <ID>. Create the branch `family/<id>-<short-slug>` from `main`, using the lowercase id (for example `family/r02-account-repository`). Implement the task, make every check in "Conventions → Checks" pass, and open a pull request titled `<ID>: <task title>`. If the task says something that contradicts the code, stop and report it instead of guessing.

Rules for every task:

- **Do only your task.** If you find something else that needs doing, mention it in the PR description instead of doing it.
- **Use the names in "Shared names" exactly.** Other tasks, written by other agents, depend on them. If one has to change, say so in the PR and update this document in the same PR.
- **Keep the family feature dark.** When the `FAMILY_ENABLED` flag (task F01) is off, none of the new family code may run: no new queries, no new UI, and new routes answer 404. That way `main` can deploy at any time, even before the migrations reach the live database.
- **Refactors don't change behaviour.** Every step 0 task keeps every REST response (status, JSON shape, messages, headers), every MCP tool and every page exactly as it was. Existing tests may move onto the new fakes, but what they assert stays the same.
- **Check the dependencies.** "Depends on" lists tasks that must already be merged into `main`. Tasks that don't depend on each other can run at the same time, as long as their "Files" lists don't overlap.

### Order and parallel work

| Step | Tasks | Can run in parallel |
| --- | --- | --- |
| 0 Storage and auth boundaries | R01–R10 | R01 first. Then R02, R03 and R04 in parallel. Then R05, R06, R08 and R09 in parallel; each adds one line to `src/lib/repositories.ts`, so rebase before merging. R07 after R06. R10 last |
| 1.1 Database | F01–F13 | F02 and F04 right away. F01 after R02. F03 after F02 and R03. F11 any time after F03. Then F05–F10, F12 and F13 in order, because each builds on the one before |
| 1.2 Bearer tokens | F14 | After R04 |
| 1.3 Permissions in the app | F15–F19 | F15 after R02. F16 and F17 after R06–R09, because they change the converted routes and tools. F18 in parallel with F16 |
| 1.4 Create and join | F20–F27 | The API tasks (F20–F22) first, then the UI tasks (F23–F27) |
| 1.5 Kid accounts | F28–F33 | F28 first, then F29–F33 |
| 1.6 Family settings | F34–F40 | F34 and F35 first, then the UI tasks |
| 1.7 Family finance | F41–F47 | F41 is folded into R06–R09. F42 after R07. F43 after R06–R09 |
| Release | F48 | Last |

**What can start on day one:** R01, R03, F02 and F04.

**Why the refactor doesn't delay the family work:** step 1.1 is almost all SQL, so it runs alongside step 0. The family TypeScript code (from F15 on) is then written against the interfaces from its first line, so nothing has to be rewritten later.

### Applying migrations to the live database

Local development (`.env.local`) talks to the **live** Supabase project, and agents never apply migrations there. You (George) apply them, at three checkpoints:

1. **After R03 and F04–F13 are merged:** apply those migrations. They only add new tables and functions that nothing uses while the flag is off, so this is safe, and the UI tasks can then be tried against real data with the flag on locally.
2. **After F42:** apply the dashboard function change. Its default behaves exactly like today.
3. **At release (F48):** apply F43, which widens who can read finance rows. Apply it only after R06–R09 are deployed.

## Shared names

These names are fixed. Tasks refer to them without restating them.

### Feature flag

- The env variable `FAMILY_ENABLED` turns the module on when it's `"true"`. Read it through `isFamilyEnabled()` in `src/lib/features.ts` (task F01).

### Repositories and auth (step 0)

The app talks to storage and auth only through these interfaces. They use domain types only, never `Database` types, Supabase clients or Supabase errors.

| Interface | Interface file | Supabase implementation | Created in |
| --- | --- | --- | --- |
| `AccountRepository` | `src/lib/account/repository.ts` | `src/lib/supabase/repositories/account.ts` | R02 (grows in F13, F31) |
| `ExpenseTabRepository` | `src/lib/expenses/tab-repository.ts` | `src/lib/supabase/repositories/expense-tabs.ts` | R06 |
| `ExpenseRepository` | `src/lib/expenses/repository.ts` | `src/lib/supabase/repositories/expenses.ts` | R07 |
| `InvestmentRepository` | `src/lib/investments/repository.ts` | `src/lib/supabase/repositories/investments.ts` | R08 |
| `NetWorthRepository` | `src/lib/net-worth/repository.ts` | `src/lib/supabase/repositories/net-worth.ts` | R09 |
| `FamilyRepository` | `src/lib/family/repository.ts` | `src/lib/supabase/repositories/family.ts` | F15 (grows in later tasks) |
| `NoticeRepository` | `src/lib/account/notice-repository.ts` | `src/lib/supabase/repositories/notices.ts` | F36 |
| `AuthService` | `src/lib/auth/service.ts` | `src/lib/supabase/auth.ts` | R04 (grows in R05, F14, F30, F31, F33) |
| `AuthAdmin` | `src/lib/auth/admin.ts` | `src/lib/supabase/auth-admin.ts` | F28 |

- **Composition roots.** `getRepositories()` in `src/lib/repositories.ts` and `getAuth()` / `getAuthAdmin()` in `src/lib/auth/index.ts` are the only places that choose the Supabase implementations. Switching providers later means new implementation files plus a change in these two files.
- **Who the caller is.** The Supabase implementations get the request's client from `createClient()` in `src/lib/supabase/server.ts`. That function already returns the scoped client for MCP, and after F14 for bearer requests too. Interfaces never mention clients or sessions:
  - Finance repositories take the acting `userId` explicitly, as the data functions do today.
  - `FamilyRepository` and `NoticeRepository` act as the signed-in caller, because their SQL functions check the caller themselves.
- **Use cases.** Logic that combines several repositories or adapters lives in `src/lib/<domain>/service.ts`, for example the ledgers and the investments overview with quotes. Routes and MCP tools call a service when there's logic, and a repository directly when there isn't. No pass-through wrappers.
- **Errors.** Supabase implementations translate Postgres error codes with `src/lib/supabase/errors.ts` (R02): `42501` → 403, `P0002` → 404, `23514` → 422, `23505` → 409, each as a `DomainError`.
- **Fakes.** Each interface has an in-memory fake in `src/test/fakes/`. Route and MCP tests use these fakes. `src/test/fake-supabase.ts` is only for testing the Supabase implementations themselves.
- **Boundary.** ESLint forbids importing `@supabase/*`, `@/lib/supabase/*` or `@/lib/database.types` anywhere except `src/lib/supabase/**`, `src/lib/repositories.ts`, `src/lib/auth/index.ts` and `src/proxy.ts`. R01 adds the rule with a temporary allowlist, and R10 removes the allowlist.
- **SQL.** New SQL identifies the caller with `app_private.current_user_id()` (R03), never with `auth.uid()` directly, so a different auth system only needs that one function redefined.

### Permission catalogue (`src/lib/permissions.ts`, task F02)

| Module key | Allowed levels | Shown in the UI as | Default for a new kid |
| --- | --- | --- | --- |
| `expenses` | `off`, `edit` | Off / On | `edit` |
| `investments` | `off`, `edit` | Off / On | `off` |
| `net_worth` | `off`, `edit` | Off / On | `off` |
| `family_finance` | `off`, `view` | Off / Can see | `off` |

- **Levels are ordered** `off < view < edit`. A check for `view` passes at `edit`.
- **Missing rows count as `off`.** A kid's permissions are stored as rows, and a module with no row is treated as `off`.
- **Parents** always pass every check. **Users without a family** pass every check too.
- **Presets:**
  - `young_kid`: the defaults above.
  - `teen`: `expenses`, `investments` and `net_worth` at `edit`, `family_finance` at `off`.
- **Permissions as JSON**, used in API bodies and stored on invites: `{ "expenses": "edit", "investments": "off", ... }`. Every module key must be present.

### Tables (all in `public`)

| Table | Columns |
| --- | --- |
| `families` | `id uuid pk default gen_random_uuid()`, `name text not null` (trimmed, 1–60 characters), `creator_id uuid not null references auth.users(id) on delete restrict`, `created_at timestamptz not null default now()` |
| `family_members` | `id uuid pk`, `family_id uuid not null references families(id) on delete cascade`, `user_id uuid not null unique references auth.users(id) on delete cascade`, `role text not null check (role in ('parent','kid'))`, `joined_at timestamptz not null default now()`, `last_active_at timestamptz` |
| `member_permissions` | `member_id uuid references family_members(id) on delete cascade`, `module text`, `level text`, `primary key (member_id, module)`, with a check that the pair is allowed by the catalogue |
| `family_invites` | `id uuid pk`, `family_id uuid not null references families(id) on delete cascade`, `code_hash text not null unique`, `role text not null` (parent/kid), `permissions jsonb` (required for kid invites, null for parent invites), `created_by uuid references auth.users(id) on delete set null`, `created_at`, `expires_at timestamptz not null`, `used_at`, `used_by uuid references auth.users(id) on delete set null`, `revoked_at` |
| `account_notices` | `id uuid pk`, `user_id uuid not null references auth.users(id) on delete cascade`, `kind text not null check (kind in ('family_deleted','removed_from_family'))`, `family_name text not null`, `created_at timestamptz not null default now()`, `seen_at timestamptz` |
| `profiles` (existing) | F04 adds `username text unique` (lowercase, `^[a-z0-9][a-z0-9._-]{2,29}$`) and `display_name text` (trimmed, 1–40 characters). F13 adds `managed_by_family uuid references families(id) on delete set null` and `must_change_password boolean not null default false` |

Kid-account state lives in `profiles`, not in Supabase's auth metadata, so it survives a change of auth provider.

### SQL helpers

- **`app_private.current_user_id()`** (R03): the caller's user id.
- **Schema `family_private`** (F06): `my_family_id()`, `is_parent(family_id uuid)`, `is_creator(family_id uuid)` and `member_level(module text)` (the caller's level, `'edit'` for parents). F43 adds `can_view_finance_of(owner uuid)`.

### Public RPCs

All of these are `security definer`, granted only to `authenticated`, and identify the caller with `app_private.current_user_id()`.

| Function | Task | Who may call it | Returns |
| --- | --- | --- | --- |
| `get_my_membership()` | F06 | anyone | 0 or 1 rows: `member_id, family_id, family_name, role, is_creator, permissions jsonb` |
| `get_family()` | F06 | members | `jsonb`: the family and its members (see F06) |
| `create_family(p_name)` | F07 | users without a family | `uuid` |
| `create_family_invite(p_role, p_permissions, p_code_hash)` | F08 | parents | `table(invite_id, expires_at)` |
| `list_family_invites()` | F08 | parents | pending invites |
| `revoke_family_invite(p_invite_id)` | F08 | parents | `void` |
| `preview_family_invite(p_code_hash)` | F09 | anyone signed in | 0 or 1 rows: `family_name, inviter_name, role, permissions, expires_at` |
| `redeem_family_invite(p_code_hash)` | F09 | users without a family | `uuid` (member id) |
| `set_member_permissions(p_member_id, p_permissions)` | F10 | parents, for kids only | `void` |
| `touch_last_active()` | F10 | members | `void` |
| `get_my_notices()`, `dismiss_notice(p_notice_id)` | F11 | anyone | unseen notices / `void` |
| `remove_family_member(p_member_id)` | F12 | the creator, never for themselves | `void` |
| `delete_family(p_confirm_name)` | F12 | the creator | `void` |
| `add_managed_kid(p_user_id, p_permissions)` | F13 | parents | `uuid` (member id) |
| `complete_password_change()` | F13 | anyone, for themselves | `void` |
| `require_password_change(p_member_id)` | F13 | parents, for kids in their family | `void` |

### Invite codes

- **Format:** 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0, O, 1, I or L). They're generated in TypeScript with `crypto.randomInt`.
- **Matching:** before comparing, the code is uppercased and spaces and dashes are removed.
- **Storage:** only `sha256(code)` as lowercase hex reaches the database. The plain code is shown once, when it's created.
- **Link:** `<SITE_URL>/join/<code>`.
- **Expiry:** 48 hours for parent invites and 7 days for kid invites, set by `create_family_invite`.

### API routes

| Route | Task |
| --- | --- |
| `GET /api/family`, `POST /api/family` `{ name }`, `DELETE /api/family` `{ confirmName }` | F20, F35 |
| `GET /api/family/invites`, `POST /api/family/invites` `{ role, permissions? }`, `DELETE /api/family/invites/[id]` | F21 |
| `POST /api/family/join/preview` `{ code }`, `POST /api/family/join` `{ code }` | F22 |
| `POST /api/family/kids` `{ displayName, username, password, permissions }` | F29 |
| `PATCH /api/family/members/[id]/permissions` `{ permissions }`, `DELETE /api/family/members/[id]` | F35 |
| `POST /api/family/members/[id]/password` `{ password }` | F32 |
| `GET /api/account/notices`, `POST /api/account/notices/[id]/dismiss` | F36 |
| `POST /api/account/password` `{ password }` | F31 |
| `PATCH /api/account/email` `{ email }` | F33 |

### Pages

| Page | Task |
| --- | --- |
| `/settings` (account, as today) | existing |
| `/settings/family` (members, or create/join when there's no family) | F23–F26 |
| `/settings/permissions` | F27 |
| `/settings/family/manage` (parents only) | F37–F40 |
| `/join/[code]` | F25 |
| `/change-password` | F31 |

## Conventions

- **Next.js:** this is Next 16. Before writing route or page code, read the relevant guide in `node_modules/next/dist/docs/`, as `AGENTS.md` asks.
- **Routes:** use `withUser`, `json`, `parseBody`, `parseId` and `HttpError` from `src/lib/http/route.ts`, and `DomainError` from `src/lib/errors.ts`. Routes stay thin:
  - validation goes in `src/lib/validation/`;
  - data goes through `getRepositories()`, and auth through `getAuth()` or `getAuthAdmin()`;
  - every new route is added to `PROTECTED_ROUTES` in `src/app/api/protected-routes.test.ts`.
- **New data access:** when a task needs a new query or RPC call, add the method to the interface, the Supabase implementation and the in-memory fake, all in the same PR. Test the Supabase implementation with `src/test/fake-supabase.ts`. R02 adds a short "How to add a repository method" note right below this list; follow it.
- **Route tests:** use `signedInAs` and `callRoute` from `src/test/route.ts`, the in-memory fakes in `src/test/fakes/`, and the builders in `src/test/builders.ts`. One behaviour per test, with sentence-style names.
- **Frontend:**
  - Fetch with `apiRequest` from `src/lib/api/client.ts`.
  - Add SWR keys to `src/lib/api/keys.ts` and invalidation to `src/lib/api/invalidate.ts`.
  - Use `useApiForm` (`src/hooks/use-api-form.ts`) for forms.
  - Build with the UI primitives in `src/components/ui/` (`Card`, `FormField`, `AppDialog`, `ConfirmDialog`, `PageHeader`, `InlineAlert`, `DataLoading`, `DataError`).
  - Look at the existing pages for patterns before adding anything new.
  - The frontend never imports a repository, `src/lib/auth` or Supabase. It only calls `/api`.
- **Migrations:**
  - File name: `supabase/migrations/<YYYYMMDDHHMMSS>_<snake_name>.sql`, with a timestamp later than every existing file.
  - Every new table runs `enable row level security`, `revoke all ... from anon`, and explicit grants to `authenticated` (select only, unless the task says otherwise; writes go through the RPCs).
  - Functions use `set search_path = ''` and fully qualified names, and identify the caller with `app_private.current_user_id()`.
  - Private helpers live in `family_private` (or `app_private`), set up with the same revoke and grant pattern as `expense_classification_private` in `20261003112707_..._add_expense_merchant_classification.sql`.
  - For every public RPC, `revoke all ... from public, anon` and then `grant execute ... to authenticated`.
  - Errors are raised with `raise exception ... using errcode = ...`: `'42501'` for forbidden, `'P0002'` for not found, `'23514'` for invalid input, `'23505'` for "already in a family".
- **SQL tests:**
  - One pgTAP file per task in `supabase/tests/`, following `expense_tabs_rls.sql`: `begin; select plan(n);`, insert users into `auth.users`, act as a user with `set local role authenticated` plus `request.jwt.claims`, then `select * from finish(); rollback;`.
  - Use a UUID prefix unique to your file.
  - `npm run test:db` replays every migration in a disposable Docker container. It never touches the live project.
- **Types:** `src/lib/database.types.ts` is updated by hand. Match its existing formatting and add exactly what the migration adds. Only the Supabase implementations may import it.
- **UI tasks:** run the app (with `FAMILY_ENABLED=true` in `.env.local`) and attach screenshots at 390 px and 1280 px, in light and dark mode, to the PR. If the live database doesn't have the migrations yet, say so and screenshot whatever states are reachable.
- **Copy:** short, plain sentences. Say "family", "parent" and "kid" in the UI.
- **Checks:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:db` for any task with SQL.

### How to add a repository method

The account repository is the worked example: `src/lib/account/repository.ts`, `src/lib/supabase/repositories/account.ts` and `src/test/fakes/account.ts`. A new method changes these three places in the same PR:

1. **Interface** (`src/lib/<domain>/repository.ts`): the method, with domain types only. Finance methods take the acting `userId` first.
2. **Supabase implementation** (`src/lib/supabase/repositories/<domain>.ts`): `const supabase = await createClient()`, map rows to domain types, and on failure `throw translateDatabaseError(error, "<generic message>")` from `src/lib/supabase/errors.ts`. A refactor (R06–R09) keeps the exact errors the old `src/lib/data/` function threw instead. Test it in `<domain>.test.ts` beside it, mocking `createClient` with `fakeSupabase` as `account.test.ts` does; add any builder method the fake lacks to `src/test/fake-supabase.ts`.
3. **Fake** (`src/test/fakes/<domain>.ts`): the same method on plain in-memory state (`Map`s or arrays) that tests seed and read directly.

A new repository also adds its key to `Repositories` and `getRepositories()` in `src/lib/repositories.ts`, and to `FakeRepositories` and `resetFakeRepositories()` in `src/test/fakes/repositories.ts`. Code calls `getRepositories().<key>.<method>(...)` inside the handler or tool, never at module level.

A route or MCP test swaps in every fake with one line, `vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));`, then calls `repositories = resetFakeRepositories()` in `beforeEach`, seeds the fakes (`repositories.account.currencies.set(user.id, "RON")`) and asserts on their state. Simulate a storage failure with `vi.spyOn(repositories.account, "getCurrency").mockRejectedValue(new Error("..."))`. See `src/app/api/account/route.test.ts`.

---

## Step 0: Storage and auth boundaries

These tasks change structure only. The app behaves exactly the same after each one.

### R01: Supabase import boundary

**Depends on:** nothing. **Files:** `eslint.config.mjs`.

- Add a `no-restricted-imports` rule that forbids `@supabase/*`, `@/lib/supabase/*` and `@/lib/database.types` everywhere, except in the folders listed under "Shared names → Repositories and auth → Boundary".
- Add a **temporary allowlist** with today's other importers. Each later step 0 task removes its own files from it:
  - `src/app/api/auth/route.ts`
  - `src/app/api/auth/google/route.ts`
  - `src/app/auth/confirm/route.ts`
  - `src/app/confirm-email/route.ts`
  - `src/app/api/mcp/route.ts`
  - `src/lib/auth.ts`
  - `src/lib/mcp/auth.ts`
  - the five files in `src/lib/data/`
  - the test files that need it today
- The error message points to the "Repositories and auth" section of this document.

**Done when** `npm run lint` passes, and the PR description shows that a Supabase import added to a component fails lint.

### R02: Repository pattern, starting with the account

**Depends on:** R01. **Files:**
- `src/lib/account.ts`, moved to `src/lib/account/types.ts`, with its imports updated;
- `src/lib/account/repository.ts` (new);
- `src/lib/supabase/repositories/account.ts` (moved from `src/lib/data/account.ts`);
- `src/lib/supabase/errors.ts`, `src/lib/repositories.ts` and `src/test/fakes/` (new);
- `src/app/api/account/route.ts` and its test, `src/lib/mcp/tools/account.ts`;
- the ESLint allowlist.

This task sets the pattern every other repository follows, so keep it small and clear.

- **`AccountRepository`:** `getCurrency(userId)` and `updateCurrency(user, currency)`, with the same behaviour as today's two functions.
- **`getRepositories()`:** server-only and per request. It returns `{ account }` for now; later tasks add their own keys.
- **`supabase/errors.ts`:** maps Postgres error codes to `DomainError`, as described under "Shared names".
- **Fakes:** an in-memory `AccountRepository` in `src/test/fakes/`, plus a helper that lets a route test swap in fakes with one line.
  - Choose the mechanism (for example `vi.mock` of `@/lib/repositories`, or a test-only setter) and use it in the account route test.
  - Write a 5–10 line "How to add a repository method" note under "Conventions" in this document, which every later task follows.
- Delete `src/lib/data/account.ts`.

**Done when** the account route and the MCP account tool behave exactly as before. Their tests run on the fakes, the Supabase implementation has its own test, and the allowlist is shorter.

### R03: SQL caller helper

**Depends on:** nothing. **Files:** one migration, `supabase/tests/app_current_user.sql`.

- Create the schema `app_private`, using the grants pattern from "Conventions".
- Add `app_private.current_user_id()`: it returns `uuid` and is `language sql stable set search_path = ''`, with the body `select auth.uid()`. Grant execute to `authenticated`.
- Existing policies keep `auth.uid()`. Moving them onto the helper is later, optional work.

**Done when** the pgTAP test shows that it returns the JWT's `sub`, and null when there are no claims.

### R04: Auth interface

**Depends on:** R01. **Files:**
- `src/lib/auth.ts`, moved to `src/lib/auth/index.ts`;
- `src/lib/auth/service.ts` and `src/lib/supabase/auth.ts` (new);
- `src/app/api/auth/route.ts`, `src/app/api/auth/google/route.ts`, `src/app/auth/confirm/route.ts`, `src/app/confirm-email/route.ts`, and their tests;
- `src/test/fakes/auth.ts` (new);
- the ESLint allowlist.

**`AuthService` methods:**
- `getCurrentUser()`
- `signInWithPassword(email, password)`
- `signUp(email, password, confirmationUrl)`
- `signOut()`
- `oauthSignInUrl("google", callbackUrl)`
- `completeEmailLink(link)`, where `link` is `{ code }`, `{ tokenHash, type }` (`/auth/confirm`) or `{ email, token, type: "email" }` (the 6-digit code in `/confirm-email`)

Results are plain domain objects, such as `{ ok: true }` or `{ ok: false, reason }`, with no Supabase types.

- `getAuthenticatedUser` stays exported from `@/lib/auth` and delegates to `getAuth().getCurrentUser()`. Route tests already mock it, so they keep working.
- Cookie refreshing stays in `src/lib/supabase/proxy.ts`, which is adapter code; `src/proxy.ts` is allowed to import it.

**Done when** every auth route keeps its status codes, messages and redirects, its tests use the fake auth, and the allowlist is shorter.

### R05: MCP sign-in through the auth interface

**Depends on:** R04. **Files:** `src/lib/mcp/auth.ts` and its test, `src/app/api/mcp/route.ts`, `src/lib/auth/service.ts`, `src/lib/supabase/auth.ts`, the ESLint allowlist.

- Add `AuthService.startSession(email, password)`. It returns `{ userId, email, run(fn) } | null`.
  - The Supabase implementation signs in with a fresh, non-persisted client, exactly as `mcp/auth.ts` does today.
  - `run` wraps `runWithSupabaseClient`, so repositories inside it act as that user.
- Basic auth parsing, session caching and throttling stay in `mcp/auth.ts`, unchanged.

**Done when** the MCP tests pass with the same behaviour, and neither `src/lib/mcp/auth.ts` nor the MCP route imports Supabase.

### R06: Expense tabs repository

**Depends on:** R02. **Files:**
- `src/lib/expenses/tab-repository.ts` (new);
- `src/lib/supabase/repositories/expense-tabs.ts` (moved from `src/lib/data/expense-tabs.ts`);
- the `expense-tabs` routes and the MCP expense-tab tools, with their tests;
- `src/test/fakes/`, `src/lib/repositories.ts`, the ESLint allowlist.

- Methods: `list(userId)`, `get(userId, id)`, `create(userId, input)`, `update(userId, id, input)` and `delete(userId, id)`, with today's behaviour.
- **Owner filters (this replaces F41 for this domain):** every query filters by owner explicitly. The adapter test asserts the filter for each method. F43 relies on this.

**Done when** the routes and tools behave exactly as before, their tests run on the fakes, and `src/lib/data/expense-tabs.ts` is gone.

### R07: Expenses repository and ledger use cases

**Depends on:** R06. **Files:**
- `src/lib/expenses/repository.ts` and `src/lib/expenses/service.ts` (new);
- `src/lib/supabase/repositories/expenses.ts` (moved from `src/lib/data/expenses.ts`);
- `src/lib/data/ledgers.ts`, moved into the service;
- the `expenses/**`, `dashboard` and `expense-tabs/[id]/expenses` routes and the MCP expense tools, with their tests;
- `src/test/fakes/`, `src/lib/repositories.ts`, the ESLint allowlist.

- **Repository:** `listMonth`, `listForTab`, `getDashboard`, `create`, `update` and `delete`, all taking `userId`. Pure analytics stays where it is in `src/lib/expenses/`.
- **Service:** `getMonthlyLedger` and `getExpenseTabLedger` move to `service.ts` and use the expense and tab repositories.
- **Owner filters (F41):** every query filters by owner explicitly, as in R06.

**Done when** everything behaves exactly as before, the tests run on the fakes, and `src/lib/data/expenses.ts` and `ledgers.ts` are gone.

### R08: Investments repository

**Depends on:** R02. **Files:**
- `src/lib/investments/repository.ts` and `src/lib/investments/service.ts` (new);
- `src/lib/supabase/repositories/investments.ts` (moved from `src/lib/data/investments.ts`);
- the `investments` and `investment-transactions/**` routes and the MCP investment tools, with their tests;
- `src/test/fakes/`, `src/lib/repositories.ts`, the ESLint allowlist.

- **Repository:** storage only (accounts and transactions).
- **Service:** the overview, which combines the repository, the existing quote adapter (`src/lib/investments/quotes/`, already an adapter, so follow the same style) and the aggregation. The domain limits (`MAX_ACCOUNTS`, `MAX_TRANSACTIONS_PER_ACCOUNT`) live in the service.
- **Owner filters (F41):** the `investment_transactions` queries filter through the owner's account explicitly.

**Done when** everything behaves exactly as before, the tests run on the fakes, and `src/lib/data/investments.ts` is gone.

### R09: Net worth repository

**Depends on:** R02. **Files:**
- `src/lib/net-worth/repository.ts` (new);
- `src/lib/supabase/repositories/net-worth.ts` (moved from `src/lib/data/net-worth.ts`);
- the `net-worth/**` routes and the MCP net-worth tools, with their tests;
- `src/test/fakes/`, `src/lib/repositories.ts`, the ESLint allowlist.

- The `create_net_worth_item_with_valuation` RPC call stays inside the Supabase implementation.
- The purchase-amount rule stays in `src/lib/net-worth/rules.ts`.
- **Owner filters (F41):** the `net_worth_valuations` queries filter through the owner's item explicitly.

**Done when** everything behaves exactly as before, the tests run on the fakes, and `src/lib/data/net-worth.ts` is gone.

### R10: Close the boundary

**Depends on:** R02–R09. **Files:** `eslint.config.mjs`, any leftover test files, this document.

- Remove the temporary allowlist. Only the boundary folders may import Supabase, and only tests under `src/lib/supabase/` may use `src/test/fake-supabase.ts`.
- Delete `src/lib/data/`, which should be empty by now.
- Check that "Conventions" still describes how the code really works, and fix it if not.

**Done when** lint passes with no allowlist, and `src/lib/data/` no longer exists.

## Step 1.1: Database foundations

### F01: Family feature flag

**Depends on:** R02 (it edits the same account files). **Files:** `src/lib/features.ts` (new), `src/lib/account/types.ts`, `src/app/api/account/route.ts` and its test, `.env.example`, `README.md`, `.github/workflows/ci.yml`.

- Add `isFamilyEnabled()`, which returns `process.env.FAMILY_ENABLED === "true"` and is server-only.
- Add `features: { family: boolean }` to `AccountData` and to the `GET /api/account` response. `PATCH` returns it too.
- Document `FAMILY_ENABLED=false` in `.env.example` and in the README's env list.

**Done when** the account route tests cover the flag on and off, and nothing else changes.

### F02: Permission catalogue

**Depends on:** nothing. **Files:** `src/lib/permissions.ts` (new), `src/lib/permissions.test.ts` (new), `src/lib/validation/family.ts` (new).

- Export the module keys, levels and level order, the allowed levels per module, defaults and presets from "Shared names".
- Export the types `FamilyRole = "parent" | "kid"`, `ModuleKey`, `PermissionLevel` and `Permissions` (a record with every module).
- Export `can(member, module, level)`, where `member` is `{ role, permissions } | null`. `null` means no family and always passes.
- Export `normalizePermissions(partial)`, which fills missing modules with `off`.
- In `validation/family.ts`, export `permissionsSchema` (Zod; rejects unknown modules and levels a module doesn't allow), `familyNameSchema`, `usernameSchema`, `displayNameSchema` and `inviteCodeSchema` (which normalizes as described under "Invite codes").

**Done when** the tests cover every module × level combination for `can`, the parent and no-family shortcuts, the presets, and every schema's accept and reject cases. The catalogue table is snapshot-tested.

### F03: Families and members tables

**Depends on:** F02 (for the module and level names), R03. **Files:** one migration, `supabase/tests/family_tables.sql`, `src/lib/database.types.ts`.

- Create the schema `family_private` (with the grants pattern), plus `families`, `family_members` and `member_permissions` exactly as in "Shared names".
- `member_permissions` gets a check constraint listing the allowed `(module, level)` pairs.
- Add an index on `family_members(family_id)`.
- Enable RLS on all three tables with **no policies yet**, so `authenticated` can read nothing.

**Done when** the SQL tests prove that:
- a user can't have two memberships;
- an unknown module, or a level the module doesn't allow, is rejected;
- deleting a family cascades to its members and permissions;
- `authenticated` can't read or write any of the three tables directly.

### F04: Profile username and display name

**Depends on:** nothing. **Files:** one migration, `supabase/tests/profile_identity.sql`, `src/lib/database.types.ts`.

- Add `profiles.username` and `profiles.display_name` with the format checks from "Shared names". `username` is unique.
- The owner can still read and update their own row through the existing policies. `username` is set only by the server in F29, so add a trigger that refuses changes to `username` from the `authenticated` role.

**Done when** the SQL tests prove the format checks, the uniqueness rule, and that a user can change `display_name` but not `username`.

### F05: Membership invariants

**Depends on:** F03. **Files:** one migration, `supabase/tests/family_invariants.sql`.

Add triggers that hold no matter how a row is written:
- `family_members.family_id` and `user_id` can never change.
- The family's creator must have a `parent` membership in that family. Check it with a deferred constraint trigger, so `create_family` can insert the family and the membership in one transaction.
- The creator's membership can't be deleted or demoted, except when the whole family is deleted.
- `member_permissions` rows may only exist for `kid` members.

**Done when** the SQL tests, running as `postgres` so RLS doesn't hide anything, prove each rule and show that deleting the whole family still works.

### F06: Helpers, read policies, `get_my_membership` and `get_family`

**Depends on:** F04, F05. **Files:** one migration, `supabase/tests/family_read_access.sql`, `src/lib/database.types.ts`.

- Add the `family_private` helpers from "Shared names". They're `security definer` and `stable`, so policies can call them without recursing into `family_members`.
- **Policies:** members can select their own family's `families` row and its `family_members` rows. Parents can select every `member_permissions` row in their family; kids can select only their own.
- `get_my_membership()` returns the row described in "Shared names", with `permissions` as JSON with every module filled in (missing rows count as `off`).
- `get_family()` returns `{ family: { id, name, createdAt }, members: [...] }`, where each member has `memberId`, `userId`, `role`, `isCreator`, `displayName` (`profiles.display_name`, falling back to the username, then the part of the email before the `@`), `username` and `joinedAt`. Parents also get `lastActiveAt` and `permissions` for every member; a kid gets them only for themselves. It returns `null` when the caller has no family. The profile row may be missing, so use a left join.

**Done when** the SQL tests, covering two families, each with a creator, a second parent and two kids, prove that:
- a non-member sees nothing;
- a kid can't see a sibling's permissions or anyone's `lastActiveAt`;
- a parent sees everything in their own family and nothing in the other;
- `get_my_membership()` returns zero rows for a user without a family.

### F07: `create_family`

**Depends on:** F06. **Files:** one migration, `supabase/tests/family_create.sql`.

- `create_family(p_name)` trims and validates the name, refuses with `23505` when the caller is already in a family, then inserts the family (`creator_id = app_private.current_user_id()`) and a `parent` membership. It returns the family id.

**Done when** the SQL tests cover a valid create, a blank or too-long name, a second create by the same user, and that the caller becomes the creator and a parent.

### F08: Invites table, create, list and revoke

**Depends on:** F07. **Files:** one migration, `supabase/tests/family_invites.sql`, `src/lib/database.types.ts`.

- Add `family_invites` as in "Shared names", with RLS on and no direct access.
- `create_family_invite(p_role, p_permissions, p_code_hash)`:
  - For parents only.
  - `p_permissions` is required for kid invites and must be null for parent invites. Validate it against the catalogue.
  - Set `expires_at` to 48 hours for parents and 7 days for kids.
- `list_family_invites()` returns the family's invites that aren't used, revoked or expired: `invite_id, role, permissions, created_by_name, created_at, expires_at`.
- `revoke_family_invite(p_invite_id)` is for parents, and only for invites of their own family.

**Done when** the SQL tests prove that:
- a kid can't create, list or revoke invites;
- a parent can't revoke another family's invite;
- the expiry is set by role;
- a kid invite with invalid permissions is refused.

### F09: Invite preview and redeem

**Depends on:** F08. **Files:** one migration, `supabase/tests/family_join.sql`.

- `preview_family_invite(p_code_hash)` returns the family name, the inviter's display name, the role, the permissions and the expiry for a valid invite. Otherwise it returns zero rows; the reason is never revealed.
- `redeem_family_invite(p_code_hash)`:
  - Refuses with `23505` when the caller is already in a family.
  - Locks the invite row (`for update`), checks that it's valid, inserts the membership (and, for kids, the permission rows), and marks it `used_at`/`used_by`.
  - Returns the member id.

**Done when** the SQL tests cover:
- expired, revoked, used and unknown codes;
- two users redeeming the same code: the second gets an error;
- a kid invite creating the right permission rows;
- a parent invite creating no permission rows.

### F10: `set_member_permissions` and `touch_last_active`

**Depends on:** F06. **Files:** one migration, `supabase/tests/family_member_updates.sql`.

- `set_member_permissions(p_member_id, p_permissions)` is for parents of the same family, only on `kid` members. It validates the JSON and replaces that kid's rows.
- `touch_last_active()` sets the caller's `last_active_at = now()` only when it's null or older than 5 minutes. It does nothing for users without a family.

**Done when** the SQL tests prove that:
- a kid can't change their own or a sibling's permissions;
- a parent can't change a parent's or another family's permissions;
- the update replaces every module;
- `touch_last_active` doesn't write twice within 5 minutes.

### F11: Account notices

**Depends on:** F03. **Files:** one migration, `supabase/tests/account_notices.sql`, `src/lib/database.types.ts`.

- Add `account_notices` as in "Shared names", with RLS on. Users can select their own rows; there's no direct write access.
- `get_my_notices()` returns the caller's notices where `seen_at` is null, oldest first.
- `dismiss_notice(p_notice_id)` sets `seen_at` on the caller's own notice.
- Notices are written only by the F12 functions.

**Done when** the SQL tests prove that users only see and dismiss their own notices.

### F12: Remove a member and delete the family

**Depends on:** F10, F11. **Files:** one migration, `supabase/tests/family_removal.sql`.

- `remove_family_member(p_member_id)`:
  - For the creator only, and never for themselves.
  - Deletes the membership, which cascades to its permissions.
  - Inserts a `removed_from_family` notice for the removed user.
- `delete_family(p_confirm_name)`:
  - For the creator only.
  - `p_confirm_name` must equal the family name, ignoring case and surrounding spaces.
  - Inserts a `family_deleted` notice for every other member, then deletes the family. Everything cascades.
  - Personal finance rows are untouched.

**Done when** the SQL tests prove that:
- a second parent and a kid can't remove anyone or delete the family;
- the creator can't remove themselves;
- a wrong confirmation name is refused;
- notices are written;
- after deletion, the former members' `get_my_membership()` is empty and their expenses still exist.

### F13: Managed kid accounts in the database

**Depends on:** F10. **Files:** one migration, `supabase/tests/family_managed_kid.sql`, `src/lib/database.types.ts`.

- **Columns:** add `profiles.managed_by_family` and `profiles.must_change_password`, as in "Shared names". Extend F04's trigger so the `authenticated` role can't change either column directly. Only the server's admin implementation (F28) and the two functions below set them.
- **`add_managed_kid(p_user_id, p_permissions)`** inserts a kid membership and permission rows. It is for parents, and only when all of the following hold:
  - the target's `profiles.managed_by_family` equals the caller's family id;
  - the target has no membership yet;
  - the permissions are valid.

  This stops a parent from adding an arbitrary existing user as their kid.
- **`complete_password_change()`** sets the caller's own `must_change_password` to false.
- **`require_password_change(p_member_id)`** sets it to true for a kid in the caller's family. It is for parents only, and F32 uses it as the permission check before resetting a password.

**Done when** the SQL tests cover:
- `add_managed_kid` with a matching account, an account marked for another family, an unmarked account, an account that's already a member, and a kid caller;
- that a user can't set either column directly;
- `complete_password_change` touching only the caller's own row;
- `require_password_change` refused for a parent target, another family's kid, and a kid caller.

## Step 1.2: Bearer tokens

### F14: Accept `Authorization: Bearer` requests

**Depends on:** R04. **Files:** `src/lib/supabase/auth.ts`, `src/lib/supabase/server.ts`, their tests, `src/lib/http/route.test.ts`.

All the work happens inside the Supabase implementation of `AuthService`. Routes, repositories and the interface don't change.
- When a request carries `Authorization: Bearer <token>` (read it with `next/headers`), `getCurrentUser()` validates the token with `supabase.auth.getClaims(token)`.
- `createClient()` returns a client built from that token for the rest of the request: the publishable key, `global.headers.Authorization`, and no persisted session. Repositories then act as that user automatically.
- Cookie behaviour stays the same, and MCP isn't touched.

**Done when** the tests cover a cookie, a valid bearer, an expired or invalid bearer (401), and a bearer request whose repository calls go through the token client.

## Step 1.3: Permissions in the app

### F15: Family repository and `getCurrentMember`

**Depends on:** F02, F06, R02. **Files:** `src/lib/family/repository.ts`, `src/lib/supabase/repositories/family.ts`, `src/lib/family/current-member.ts` (all new), the matching fake in `src/test/fakes/`, `src/lib/repositories.ts`, their tests.

- `FamilyRepository` starts with `getMembership()` (wrapping `get_my_membership`) and `getFamily()` (wrapping `get_family`). Later tasks add their own methods in the same three places: interface, Supabase implementation, fake.
- Export the domain types `CurrentMember` (`{ memberId, familyId, familyName, role, isCreator, permissions }`) and `FamilyData` (the shape of `get_family()`) from the repository file.
- `src/lib/family/current-member.ts` exports `getCurrentMember()`, cached per request with React `cache`. It returns `null` without any query when the flag is off, and `null` when the user has no family.

**Done when** the tests cover the flag off (the fake records no call), no family, a parent and a kid, and the Supabase implementation's mapping and error translation.

### F16: `withPermission` and the finance routes

**Depends on:** F15, R06–R09. **Files:** `src/lib/http/route.ts` (or a new `src/lib/http/permission.ts`), every finance route under `src/app/api/` and their tests.

- Add `withPermission(module, level, handler, options)`. It behaves like `withUser`, but first checks `can(await getCurrentMember(), module, level)` and returns 403 `{ error: "You don't have access to this." }` when the check fails.
- Apply it to the finance routes:

  | Routes | Module | Level |
  | --- | --- | --- |
  | `expenses/**`, `expense-tabs/**`, `dashboard` | `expenses` | `edit` |
  | `investments`, `investment-transactions/**` | `investments` | `edit` |
  | `net-worth/**` | `net_worth` | `edit` |

  `account` stays on plain `withUser`.

**Done when** the tests show that a kid with `investments: off` gets 403 from the investments routes, a kid with `expenses: edit` gets the normal response, and users without a family and parents see no change. The protected-routes test still passes.

### F17: MCP respects kid permissions

**Depends on:** F16, R05. **Files:** `src/lib/mcp/define-tool.ts`, `src/lib/mcp/tools/*.ts`, the MCP tests.

- Give `defineTool` an optional `module` field, and tag every finance tool with the same module as its REST route.
- Before running a tool, check the caller's membership the same way as F16. MCP runs every tool inside the session's `run` (R05), so `getCurrentMember` acts as the MCP user there. A refusal returns the existing tool error shape with "You don't have access to this."
- The advertised tool surface doesn't change, so `tool-surface.test.ts` stays green without updating the snapshot.

**Done when** the tests show a kid with `investments: off` refused by the investments tools and allowed by the expense tools, and that nothing changes for users without a family.

### F18: Account response carries the membership; `useCan`

**Depends on:** F15. **Files:** `src/lib/account/types.ts`, `src/app/api/account/route.ts` and its test, `src/hooks/use-can.ts` (new) and its test.

- Add `membership: { role, isCreator, familyName, permissions } | null` to `AccountData` and to the GET and PATCH responses. It's always `null` while the flag is off.
- Add `useCan(module, level)`, built on `useAccount` and `can`. While the account is loading, it returns `false`.

**Done when** the route and hook tests cover a missing membership, a parent and a kid.

### F19: Navigation and page guards

**Depends on:** F18. **Files:** `src/components/layout/nav-items.ts` and its test, `sidebar-nav.tsx`, `mobile-tab-bar.tsx`, `more-sheet.tsx`, the page files under `src/app/(app)/`, `src/components/layout/permission-gate.tsx` (new).

- Give each finance nav item its module. The navigation hides items the user can't reach, and a section with no visible items disappears, as it already does.
- Add `<PermissionGate module level>`, which shows "This part of the app is turned off for you. Ask a parent." instead of the page.
- Wrap the expenses, investments and net-worth pages, and the dashboard (module `expenses`), in it. A kid with Expenses off sees the gate on Home too; the home dashboard per role (roadmap 8.1) fixes that later.

**Done when** the nav test covers a kid with only `expenses` enabled. Include screenshots at 390 and 1280 px of the navigation for that kid and of the gate message.

## Step 1.4: Create and join

### F20: `GET` and `POST /api/family`

**Depends on:** F07, F15. **Files:** `src/app/api/family/route.ts` (new) and its test, `FamilyRepository` (`createFamily`), `src/lib/api/keys.ts`, `src/app/api/protected-routes.test.ts`.

- `GET` returns `get_family()` as `{ family: FamilyData | null }`.
- `POST { name }` validates with `familyNameSchema`, calls `create_family`, and returns the new `FamilyData` with status 201. It returns 409 "You're already in a family." when the caller already belongs to one.
- Both answer 404 while the flag is off.
- Add `FAMILY_API_KEY` to `keys.ts`.

**Done when** the route tests cover the flag off, no family, a member, a valid create, an invalid name (422) and an existing family (409).

### F21: Invites API

**Depends on:** F08, F20. **Files:** `src/app/api/family/invites/route.ts` and `invites/[id]/route.ts` (new) and their tests, `src/lib/family/invite-code.ts` (new) and its test, `FamilyRepository` (`createInvite`, `listInvites`, `revokeInvite`).

- `invite-code.ts` generates codes and hashes them as described under "Invite codes".
- `GET` lists the pending invites.
- `POST { role, permissions? }` creates a code and returns `{ inviteId, code, url, expiresAt }` with status 201. The code appears only in this response. `permissions` is required for `kid`.
- `DELETE /[id]` revokes an invite.
- A kid gets 403.

**Done when** the tests cover code generation (alphabet, length, normalization), each route's success path, a kid caller, and a kid invite sent without permissions (422).

### F22: Join API with rate limiting

**Depends on:** F09, F20. **Files:** `src/app/api/family/join/route.ts` and `join/preview/route.ts` (new) and their tests, `FamilyRepository` (`previewInvite`, `redeemInvite`), `src/lib/http/rate-limit.ts` (new) and its test.

- `rate-limit.ts` is a small in-memory limiter: 10 failed attempts per user per 15 minutes. The app runs as a single process on the VPS, so memory is enough. Don't change the MCP limiter.
- `POST /preview { code }` returns `{ familyName, inviterName, role, permissions, expiresAt }`, or 404 "This code isn't valid anymore." Failures count toward the limit.
- `POST /join { code }` redeems the code and returns the new `FamilyData`. It returns 409 when the caller is already in a family, and 429 when they're over the limit.
- Codes travel in request bodies, never in query strings.

**Done when** the tests cover a valid code, an invalid code, the limit triggering, and an existing family.

### F23: Settings sub-pages

**Depends on:** F18. **Files:** `src/app/(app)/settings/` (layout and new pages), `src/components/settings/settings-nav.tsx` (new).

- Add a small tab-style navigation shared by every settings page: **Account** (today's page), **Family**, **My permissions**, and **Manage family**, which only parents see.
- The family tabs appear only when `features.family` is on.
- `/settings/family`, `/settings/permissions` and `/settings/family/manage` start as placeholder pages. `manage` redirects non-parents to `/settings/family`.

**Done when** the account settings page works as before. Include screenshots at 390 and 1280 px with the flag on and off.

### F24: Create or join, when you have no family

**Depends on:** F20, F22, F23. **Files:** `src/app/(app)/settings/family/page.tsx`, `src/components/family/create-family-form.tsx` and `join-family-form.tsx` (new).

- With no family, `/settings/family` shows two cards: "Create a family" (a name field) and "Join with a code" (a code field).
- Joining first calls preview, then shows a confirmation: the family name, who invited you, your role, and "Parents in this family will see your expenses, investments and net worth." The user then confirms or cancels.
- After success, refresh the account and family caches.

**Done when** both flows work, including field errors. Include screenshots of the empty state, the confirmation and the error state.

### F25: The `/join/[code]` link and keeping it through sign-in

**Depends on:** F24, R04 (it edits the auth routes R04 converts). **Files:** `src/app/join/[code]/page.tsx` (new), `src/app/(auth)/login/page.tsx`, `src/components/auth/auth-form.tsx`, `src/app/api/auth/google/route.ts`, `src/app/auth/confirm/route.ts`, and a shared `safeNextPath` moved out of the confirm route into `src/lib/http/origin.ts`, with tests.

- `/join/[code]` sends a signed-out user to `/login?next=/join/<code>`. A signed-in user sees the same confirmation as F24, with the code filled in.
- **Keep `next` through every sign-in path:**
  - the login page reads it;
  - the email/password form redirects to it;
  - the Google route passes it to the callback;
  - the signup confirmation link keeps it.
- Every `next` value passes through `safeNextPath`, so only same-site paths are accepted.

**Done when** the tests cover `safeNextPath` (external URLs and protocol-relative paths are refused) and the Google route forwarding `next`. Include screenshots of `/join/<code>` signed out and signed in.

### F26: Family members page

**Depends on:** F20, F23. **Files:** `src/app/(app)/settings/family/page.tsx`, `src/components/family/family-members.tsx` (new).

- With a family, `/settings/family` shows the family name and the members grouped into **Parents** and **Kids**.
- Each member shows their display name, their username if they have one, a "Creator" badge, and when they joined.
- This is the first version of the family tree, with no relationships drawn.

**Done when** screenshots at 390 and 1280 px show a family with two parents and two kids.

### F27: My permissions page

**Depends on:** F18, F23. **Files:** `src/app/(app)/settings/permissions/page.tsx`, `src/components/family/permission-list.tsx` (new; F37 reuses it).

- Lists every module with the user's level in plain words, such as "Expenses: on" or "Family finance: can't see".
- Parents see "Parents can use every part of the app."
- Kids also see "Your parents can see: your expenses, investments and net worth, and when you last used the app."
- With no family: "You're not in a family yet."

**Done when** screenshots show the kid, parent and no-family versions.

## Step 1.5: Kid accounts

### F28: `AuthAdmin` and its Supabase implementation

**Depends on:** R04, F04, F13. **Files:** `src/lib/auth/admin.ts`, `src/lib/supabase/auth-admin.ts` (new) and its test, `src/lib/auth/index.ts` (`getAuthAdmin()`), `src/lib/supabase/config.ts`, `src/test/fakes/auth.ts`, `.env.example`, `README.md`, `.github/workflows/ci.yml`.

**`AuthAdmin` methods:**
- `createUser({ email, password, username, displayName, managedByFamily, mustChangePassword })`: creates the auth user (already confirmed) and its profile row with those columns.
- `deleteUser(userId)`.
- `setPassword(userId, password)`.
- `findEmailByUsername(username)`: returns the email or `null`.

**Implementation:**
- It uses `SUPABASE_SECRET_KEY`. The variable is server-only and optional: the app starts without it, and `getAuthAdmin()` throws a clear error when it's missing.
- The client never persists or refreshes a session.
- Add a comment that this bypasses RLS: callers must check the caller's permission first, as F29, F30 and F32 do.
- Add a CI placeholder value, and document the variable in the README's VPS env list.

**Done when** the tests cover a missing key, each method's Supabase calls, and a fake `AuthAdmin` in `src/test/fakes/auth.ts`.

### F29: Create a kid account

**Depends on:** F13, F28, F20. **Files:** `src/app/api/family/kids/route.ts` (new) and its test, `src/lib/family/service.ts` (new, `createKidAccount`) and its test, `FamilyRepository` (`addManagedKid`).

`POST { displayName, username, password, permissions }`, for parents only. The service runs these steps in order:
1. Check that the caller is a parent, with `getCurrentMember()`. Return 403 otherwise.
2. Validate the input. The password follows the login rule: 8–128 characters.
3. Check that the username is free with `findEmailByUsername`. Return 409 "That username is taken."
4. Call `getAuthAdmin().createUser` with:
   - the email `<username>@kids.ifam.invalid`;
   - `managedByFamily` set to the caller's family id;
   - `mustChangePassword: true`.
5. Call `FamilyRepository.addManagedKid` **as the parent**, which runs the SQL check from F13.
6. If step 5 fails, call `deleteUser` for the account you just created, then return the error.

Before writing code, check that Supabase Auth accepts the `.invalid` domain with a one-off admin call on a throwaway username, and delete that user afterwards. If it's refused, stop and ask George for a domain to use instead.

**Done when** the service tests, using the fakes, cover success, a taken username, a kid caller (403), and the clean-up when `addManagedKid` fails.

### F30: Sign in with a username

**Depends on:** F28. **Files:** `src/app/api/auth/route.ts` and its test, `src/components/auth/auth-form.tsx`.

- In login mode the field becomes "Email or username": the schema accepts an email or a valid username. Signup still requires an email.
- For a username, the route gets the email with `getAuthAdmin().findEmailByUsername`, then calls `getAuth().signInWithPassword` as today.
- An unknown username returns the same 401 message as a wrong password, so usernames can't be probed.
- MCP is unchanged and still signs in by email.

**Done when** the tests cover an email login (unchanged), a username login, an unknown username and a wrong password.

### F31: Forced password change

**Depends on:** F13, F18. **Files:** `src/app/api/account/password/route.ts` (new) and its test, `src/app/change-password/page.tsx` (new), `src/app/(app)/layout.tsx`, `src/lib/account/types.ts`, `src/lib/account/repository.ts` and its implementation and fake, `src/app/api/account/route.ts`, `src/lib/auth/service.ts` and `src/lib/supabase/auth.ts`.

- `AccountRepository` gains `getMustChangePassword(userId)` and `completePasswordChange()` (which wraps the RPC). `AuthService` gains `updatePassword(password)`.
- The account response includes `mustChangePassword`, and the `(app)` layout redirects to `/change-password` while it's true.
- `POST /api/account/password { password }`, which any signed-in user may call, does two things:
  1. `getAuth().updatePassword(password)`;
  2. `completePasswordChange()`.

  The flag lives in `profiles`, so neither the admin client nor a session refresh is needed.
- The page is a single "Choose a new password" form, with a confirmation field.

**Done when** the tests cover the flag in the account response, the route updating the password and clearing the flag, and a password that's too short. Include a screenshot of the page.

### F32: A parent resets a kid's password

**Depends on:** F29. **Files:** `src/app/api/family/members/[id]/password/route.ts` (new) and its test, `FamilyRepository` (`requirePasswordChange`).

`POST { password }`:
1. Call `FamilyRepository.requirePasswordChange(memberId)` **as the parent**. The SQL function refuses anyone who isn't a parent of that kid, so it doubles as the permission check. It returns the kid's user id.
2. Only then call `getAuthAdmin().setPassword`.

**Done when** the tests cover success, resetting a parent's password (403), another family's member (404), a kid caller (403), and that `setPassword` is never called when step 1 fails.

### F33: Add a real email to a username account

**Depends on:** F29. **Files:** `src/app/api/account/email/route.ts` (new) and its test, `src/lib/auth/service.ts`, `src/lib/supabase/auth.ts`, the auth fake, `src/app/(app)/settings/page.tsx`.

- `AuthService` gains `updateEmail(email, confirmationUrl)`. `PATCH { email }` calls it with `/auth/confirm?next=/settings`.
- On the Account settings page, accounts whose email ends in `@kids.ifam.invalid` see "Add an email address" instead of their generated address.

**Check first:** if "Secure email change" is on in the Supabase Auth settings, the change must also be confirmed at the old, generated address, which can never receive mail. Find out how the live project is set up and describe it in the PR. If it's on, stop and ask George whether to turn it off or to do the change through `AuthAdmin` after confirming the new address.

**Done when** the tests cover the request and the validation. Include a screenshot of the settings section.

## Step 1.6: Family settings

### F34: Track last activity

**Depends on:** F10, F15. **Files:** `src/lib/http/route.ts`, `FamilyRepository` (`touchLastActive`), the tests.

- After authentication, when the flag is on and `getCurrentMember()` returns a member, `withUser` calls `touchLastActive()` without waiting for it, and ignores errors.
- An in-process map skips the call when the same user touched in the last 5 minutes.

**Done when** the tests show one call per user per 5 minutes, no call when the flag is off, and that a failure doesn't affect the response.

### F35: Members API and deleting the family

**Depends on:** F10, F12, F20. **Files:** `src/app/api/family/members/[id]/permissions/route.ts` and `members/[id]/route.ts` (new), `src/app/api/family/route.ts` (adds `DELETE`), `FamilyRepository` (`setMemberPermissions`, `removeMember`, `deleteFamily`), their tests.

- `PATCH .../permissions { permissions }` calls `setMemberPermissions` and returns the updated `FamilyData`.
- `DELETE /members/[id]` calls `removeMember` and returns 204.
- `DELETE /api/family { confirmName }` calls `deleteFamily` and returns 204.
- The SQL errors arrive as `DomainError`s (403, 404 or 422) from the Supabase implementation.

**Done when** each route has a test for success, for a forbidden caller (403) and for bad input.

### F36: Notices API and the popup

**Depends on:** F11. **Files:** `NoticeRepository` (interface, Supabase implementation, fake; `listUnseen`, `dismiss`), `src/lib/repositories.ts`, `src/app/api/account/notices/route.ts` and `notices/[id]/dismiss/route.ts` (new) and their tests, `src/components/family/account-notice-dialog.tsx` (new), `src/app/(app)/layout.tsx`.

- `GET` returns the unseen notices. `POST .../dismiss` marks one as seen.
- The `(app)` layout shows the oldest notice in an `AppDialog`:
  - "The family X was deleted. Your own expenses, investments and net worth are still here."
  - "You were removed from the family X. Your own data is still here."
- **OK** dismisses the notice and shows the next one, if there is one.

**Done when** the route tests pass. Include screenshots of both messages.

### F37: Manage family: members and permissions

**Depends on:** F27, F35. **Files:** `src/app/(app)/settings/family/manage/page.tsx`, `src/components/family/manage-members.tsx` and `edit-permissions-dialog.tsx` (new).

- A table of members with name, role, "Creator" badge and last active. "Last active" reads as "Never", "Just now", "3 hours ago" or "12 Oct", using the app calendar in `src/lib/calendar.ts`.
- Each kid has an **Edit permissions** button. It opens a dialog with presets and per-module controls; each control lists only the levels that module allows. Saving calls F35.

**Done when** editing a kid's permissions changes what that kid sees on their next request. Include screenshots of the table and the dialog.

### F38: Manage family: invites

**Depends on:** F21, F37. **Files:** `src/components/family/manage-invites.tsx` and `create-invite-dialog.tsx` (new), the manage page.

- **Invite someone** opens a dialog: choose the role (parent or kid). For a kid, choose a preset and optionally adjust the modules.
- The result shows the code in large text, the link, **Copy** buttons, and the expiry. It also warns: "Anyone with this code can join as a <role>. Share it only with them."
- Below it, the pending invites list, with who created each one, when it expires, and **Revoke**.

**Done when** creating, copying and revoking work. Include screenshots.

### F39: Manage family: create a kid and reset a password

**Depends on:** F29, F32, F37. **Files:** `src/components/family/create-kid-dialog.tsx` and `reset-password-dialog.tsx` (new), the manage page.

- **Add a kid** opens a dialog with name, username, temporary password and permissions (preset plus modules). On success it shows "Ana can sign in with the username ana and this password. They'll choose a new one the first time."
- Each kid row gets **Reset password**.

**Done when** both work against the real API locally, once the migrations are applied. Include screenshots.

### F40: Manage family: remove a member and delete the family

**Depends on:** F35, F37. **Files:** `src/components/family/remove-member-dialog.tsx` and `delete-family-dialog.tsx` (new), the manage page.

These are for the creator only. Other parents don't see the buttons, and the API refuses them anyway.
- **Remove** on each member except the creator opens a `ConfirmDialog`: "Remove Ana from the family? Ana keeps their account and their own data."
- **Delete family** sits in a "Danger zone" card. Its dialog asks the creator to type the family name and explains what's deleted (the family, its members and invites, and later its to-dos, calendar and so on) and what isn't (everyone's personal finance).

**Done when** both flows work. Include screenshots.

## Step 1.7: Family finance

### F41: Filter every finance read by owner (folded into step 0)

**Nothing to do here.** R06–R09 make every finance query filter by owner explicitly while they move it into a repository, and their adapter tests assert it. The number is kept so the other references stay valid.

### F42: Dashboard function takes a user

**Depends on:** R07. **Files:** one migration, a pgTAP test, `src/lib/supabase/repositories/expenses.ts`, `src/lib/database.types.ts`.

- Recreate `get_expense_dashboard` with an extra final argument, `p_user_id uuid default app_private.current_user_id()`. It stays `security invoker`, so RLS still decides what's visible.
- Keep the old grants.
- `ExpenseRepository.getDashboard` passes its `userId`.

**Done when** the SQL test shows the default behaving as before and another user's id returning nothing under today's policies.

### F43: Widen the finance read policies

**Depends on:** F06, R06–R09. The migration is applied to the live project only after R06–R09 are deployed (see "Applying migrations"). **Files:** one migration, `supabase/tests/family_finance_rls.sql`.

- Add `family_private.can_view_finance_of(owner uuid)`. It's true when any of these holds:
  - `owner = app_private.current_user_id()`;
  - the caller is a parent in the owner's family;
  - the caller is a kid in the owner's family with `family_finance` at `view`.
- Recreate **only the select policies** of `expenses`, `expense_tabs`, `investment_accounts`, `investment_transactions`, `net_worth_items` and `net_worth_valuations` to use it. Insert, update and delete policies don't change.
- List the current policies first and keep their names.

**Done when** the SQL tests prove that:
- a parent reads a kid's and the other parent's rows in every table;
- a kid without Family finance reads only their own;
- a kid with it reads everyone's in the family;
- another family reads nothing;
- **nobody can insert, update or delete someone else's rows.**

### F44: The `member` parameter on finance reads

**Depends on:** F43, F15. **Files:** the finance GET routes and their tests, `src/lib/family/current-member.ts`.

- **Resolving the member:** add `resolveViewedUser(memberIdParam)`:
  - With no param, it returns the caller.
  - Otherwise it looks the member up with `FamilyRepository.getFamily()` and checks that the caller is a parent, or a kid with `family_finance` at `view`.
  - It returns that member's user id, or throws 404.
- **Routes:** the finance GET routes (dashboard, expenses month, expense tabs and tab expenses, investments, investment transactions, net worth) accept `?member=<memberId>` and add `viewing: { memberId, displayName, readOnly: boolean }` to their responses.
- **Writes:** write routes never read the parameter and always act on the caller.

**Done when** the tests cover a parent viewing a kid, a kid without permission (404), an unknown member (404), and that the responses without the parameter are unchanged apart from the added `viewing` field.

### F45: Member picker and read-only mode

**Depends on:** F44. **Files:** `src/components/family/viewing-picker.tsx` (new), the finance pages and their add, edit and delete controls, `src/lib/api/keys.ts`.

- A "Viewing: Me / <member>" picker shows on the finance pages for anyone allowed to view others. It's stored in the URL as `?member=`.
- When `readOnly` is true, hide every add, edit, delete and import control, and show a small "You're viewing Ana's expenses" bar.
- SWR keys include the member, so caches don't mix.

**Done when** a parent can switch between members on every finance page and can't start any change. Include screenshots.

### F46: Family view for expenses

**Depends on:** F45. **Files:** `src/lib/expenses/service.ts` and the analytics modules, the dashboard and expenses pages and routes, their tests.

- Add `?member=all` ("Family") for expenses: the dashboard and the month list combine every member the caller can see.
- **Totals:** members can use different currencies, so totals are grouped by currency, such as "1,240 RON · 85 EUR", with no conversion. List rows show the member's name.
- **Data:** fetch per member through `ExpenseRepository` and combine in `src/lib/expenses/service.ts`.

**Done when** the unit tests cover combining members and grouping by currency. Include screenshots of the family dashboard and list.

### F47: Family view for investments and net worth

**Depends on:** F45. **Files:** the investments and net-worth pages, `src/lib/investments/service.ts`, the net-worth service or routes, and tests.

- `?member=all` shows one section per member, using their existing overview, in read-only mode.
- Add combined totals per currency only where the overview already reports a single currency. Note in the PR where you didn't.

**Done when** the tests and screenshots cover a family of three.

## Release

### F48: Turn it on

**Depends on:** everything above. **Files:** `docs/family-hub-roadmap.md` (mark phase 1 done), `README.md`.

A checklist for George, with the agent preparing the PR:
1. Apply the remaining migrations to the live project, **F43 last**.
2. Set `SUPABASE_SECRET_KEY` and `FAMILY_ENABLED=true` in `/etc/expense-tracker/.env.production` on the VPS.
3. Deploy, then run a smoke test:
   - create a family;
   - invite your spouse with a parent code;
   - add a kid by username;
   - sign in as the kid and change the password;
   - check the kid's navigation and the parent's member picker;
   - delete a test family and see the popup.
4. Once it has run without problems for a while, a follow-up PR removes the flag and the code paths for the flag being off.

## Not scheduled (needs a decision first)

- **A parent leaving on their own.** This would need a `leave_family()` function for non-creator parents, plus a button. The roadmap recommends allowing it.
- **Handing over the creator role.** This would need a `transfer_family_creator(p_member_id)` function for the creator, targeting another parent, so the creator can leave without deleting the family.
