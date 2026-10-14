# Code Cleanup and Deep-Modules Plan

## Summary and boundaries

Make the codebase easier to read and change **without changing what the app does**. The approach has three parts:

1. **Remove dead code.** Delete unused components, exports, constants, and dependencies.
2. **Deepen modules.** Replace logic copied across many files with a few modules that have small interfaces and hide a lot of behavior. Today the expense, investment, and net-worth code repeats the same auth, validation, error, date, and form-state logic in every route and dialog.
3. **Simplify tests.** Use shared fakes and fixture builders, give each test one behavior, and write test names as sentences. Each guarantee should be tested in one place, not copied into every route test.

In scope: `src/lib/**`, `src/app/api/**`, the non-visual logic in `src/components/**` and `src/app/(app)/**` (hooks, data fetching, form submission), tests, and tooling configuration.

Out of scope: visual and styling changes, database schema and migrations, new features, copy changes, and new runtime dependencies.

### Invariants (must hold after every task)

- Every REST response keeps its **status code, JSON shape, error message, `fieldErrors` keys, and `Cache-Control: private, no-store, max-age=0` header**. The only exception is the field removal in Task 9, which needs an explicit decision.
- MCP tool **names, titles, descriptions, input shapes, annotations, and result payloads** stay the same.
- SWR keys, URL query parameters, and local behavior such as month clamping and tab redirects stay the same.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:db` all pass.

### Coordination with the UI styling refactor

The branch `claude/ui-styling-refactor-c2ffef` (worktree `.claude/worktrees/ui-styling-refactor-c2ffef`, 8 commits, ~150 files) rewrites most of `src/components/**`. It adds `AppDialog`, `ConfirmDialog`, `FormField`, `Stat`, and splits up `net-worth-panel` and `app-navigation`. To avoid conflicts:

- **Phase A (Tasks 0–8)** only touches `src/lib/**`, `src/app/api/**`, and tests. It can start now.
- **Phase B (Tasks 9–10)** touches component logic. Start it only **after the UI branch is merged**, and build on its primitives.

## Current state: what makes the code hard to read

These findings come from reading `src/lib`, `src/app/api`, the components, and the 29 test files.

| Problem | Evidence | Effect |
|---|---|---|
| Route boilerplate repeated | `PRIVATE_HEADERS` is redeclared in 18 files. The `getAuthenticatedUser()` + 401 block appears 21 times. The id check, JSON body parse, 422 `flatten()`, and try/catch → 500 sequence is repeated in every handler | Routes are shallow: about 40 lines of plumbing around one data call. A forgotten header or auth check would go unnoticed |
| Two identical error classes | `InvestmentMutationError` (data/investments.ts) and `NetWorthMutationError` (data/net-worth.ts) are character-for-character the same | Every route and `define-tool.ts` has to check both. Route tests redeclare the class inside `vi.hoisted` |
| Validation primitives copied | `decimalInputSchema` and the three-letter currency schema are duplicated in `validation/investment.ts` and `validation/net-worth.ts`. `isInvestmentCurrency` repeats the regex again. There are four separate `z.uuid()` id schemas | Rules can drift between domains |
| Domain rule in four places | The rule "purchase amount only for non-cash assets" lives in the net-worth schema, `updateNetWorthItemForUser`, and both net-worth dialogs | Changing the rule means four edits |
| Calendar arithmetic everywhere | `padStart(2, "0")` date building appears in `data/expenses.ts` (`nextDate`), `expenses/tab-filters.ts`, `frontend/expense-analytics.ts` (`monthIndex`, `monthFromIndex`, `daysInMonth`, `historyBoundaries`), and `utils/dates.ts`. Period → months maps are duplicated (`PERIOD_MONTHS`, `historyBoundaries`, `parseAnalyticsFilters`, the MCP `spendingSummarySchema`) | The same range is computed separately on server and client |
| Two notions of "now" | `getCurrentMonth()` uses the process's local time zone, `getApplicationCurrentMonth()` uses Europe/Bucharest, and `parseAnalyticsFilters` / `currentDateValue()` use UTC `toISOString()` | Hidden inconsistency near midnight and month boundaries |
| Data modules mix concerns | `data/expenses.ts` (367 lines) contains query building, pagination, in-memory search, *and* pure analytics shaping (`getAnalyticsRange`, `analyticsFromSummary`, `buildMonthKeys`) | Pure logic can only be tested through a Supabase fake |
| Repeated row mapping and casts | The investment column list is repeated 4 times. Three account queries each re-parse `broker_id`. There are 12 `as unknown as` casts in data modules. `ExpenseRow` is hand-written even though `Database` types exist | Long files, and type safety is weaker than it looks |
| REST and MCP duplicate use cases | "load tab → load its expenses → summarize" and "load month → summarize" are written once in the routes and again in the MCP tools | Two places to keep in sync |
| Route bypasses the data layer | `PATCH /api/account` calls Supabase directly | It is the only exception to the `lib/data` boundary |
| `lib/` organized by layer, not domain | `lib/frontend/expense-analytics.ts` holds domain analytics, `lib/utils/analytics.ts` holds URL parsing, `lib/types.ts` re-exports categories, and `data/expenses.ts` re-exports `summarizeExpenses` | Hard to know where code belongs, and there are two import paths for the same thing |
| Form state copied per dialog | About 8 dialogs each manage `pending` / `error` / `fieldErrors` and the `ApiError` mapping by hand, in two styles (`ActionState` object vs. separate `useState`s) | About 25 lines of repeated logic per dialog |
| Account data fetched 9 ways | `useSWR<AccountData>(ACCOUNT_API_KEY)` appears 9 times, with a fallback that is `DEFAULT_CURRENCY` in some places and the literal `"EUR"` in others | Small but noisy |
| Test fakes written per file | Each of `data/expenses.test.ts`, `data/expense-tab-expenses.test.ts`, `data/expense-tabs.test.ts`, and `api/expenses/month-limit.test.ts` builds its own fake Supabase query builder | Readers have to learn a new fake in every file |
| Dense or oversized tests | Some one-line tests make five assertions over different filters (`expense-tab-expenses.test.ts`). `net-worth/calculation.test.ts` is 174 lines with only 2 `it`s and large inline fixtures | Hard to see which behavior failed |
| Tooling picks up foreign files | `vitest` and `eslint` scan `.claude/worktrees/**` and `tmp/**`. Today `npm test` reports 8 failures and `npm run lint` reports about 22k problems, all from the worktree copy. `src` alone is green | The baseline looks red, which hides real regressions |

### Dead code found

| Item | Location | Evidence |
|---|---|---|
| `StatCard` component | `src/components/dashboard/stat-card.tsx` | No importers. `MetricStrip` replaced it, and its `icon` / `accent` props are ignored |
| `INVESTMENT_CURRENCY_EXAMPLES` | `src/lib/investments/types.ts` | No references |
| `buffer` dependency | `package.json` | Never imported since the initial commit |
| `summarizeExpenses` re-export | `src/lib/data/expenses.ts` | Only one test imports it through this path |
| Category re-exports | `src/lib/types.ts` | Gives a second import path for `EXPENSE_CATEGORIES`, `CATEGORY_LABELS`, and others |
| Exports used only in their own file | `CATEGORY_STYLES`, `DataUpdating`, `ValueChangeTone`, `INVESTMENT_DECIMAL_PLACES`, `NET_WORTH_DECIMAL_PLACES`, `ToolRegistrar`, `McpCredentials`, `McpSession`, `McpAuthResult`, `investmentBrokerIdSchema` | They widen the module surface for no reason. Make them module-private |
| `tabId` / `tabRevision` response fields | `ExpenseTabLedgerData` | Duplicates of `tab.id` / `tab.updatedAt` (see Task 9) |

Kept on purpose: `/confirm-email` looks like a duplicate of `/auth/confirm`, but the README documents it as the legacy six-digit OTP link. Keep it unless the Supabase email template has been confirmed to no longer use it.

## Target module map

`lib/` is organized by domain. Each domain exposes a small interface, and transport code (REST and MCP) stays thin.

```
src/lib/
  http/route.ts          withUser, parseBody, parseId, json, error mapping   (new, deep)
  errors.ts              DomainError (status + fieldErrors)                   (new)
  calendar.ts            ISO date/month arithmetic, application "today"      (from utils/dates.ts)
  validation/primitives.ts  idSchema, decimalString, currencyCode, calendarDate (new)
  expenses/
    categories.ts        unchanged
    analytics.ts         range resolution, summaries, month/tab/history analytics (pure)
    filters.ts           tab filters schema + URL (de)serialization
    url-state.ts         dashboard view/month/href helpers
    types.ts             Expense, Analytics, DashboardData, ExpensesData …
  investments/ …         unchanged layout; one Decimal helper shared with net-worth
  net-worth/
    rules.ts             purchaseAmountAllowed(kind, category)                 (new)
  data/                  Supabase I/O + use cases shared by REST and MCP
  mcp/                   unchanged shape (defineTool is already the model to follow)
```

`lib/mcp/define-tool.ts` is already a good example of a deep module: one `defineTool({...})` call hides schema advertising, parsing, not-found handling, and error mapping. The REST side should get the same treatment.

## Tasks

Each task is one PR. Each PR leaves the app working and passes all five checks.

### Task 0 — Fix the baseline and add characterization tests

Goal: a green baseline and a safety net before anything moves.

- `vitest.config.ts`: add `test.include: ["src/**/*.test.{ts,tsx}"]`.
- `eslint.config.mjs`: add `.claude/**` and `tmp/**` to `globalIgnores`.
- Add characterization tests that lock in the public contract:
  - **REST error contract.** A table-driven test runs every protected handler (all `src/app/api/**/route.ts` except `auth` and `mcp`) with no user and asserts `401`, `{ error: "Unauthorized" }`, and the no-store header. This also catches a route that forgets the wrapper in Task 2.
  - **MCP tool surface.** Snapshot `tools/list` (names, titles, descriptions, input schemas, annotations) from `createMcpServer`.
- Record the baseline output of `lint`, `typecheck`, `test`, `build`, and `test:db` in the PR description.

Done when `npm test` and `npm run lint` are green on `main`, and both characterization tests exist.

### Task 1 — Remove dead code

- Delete `components/dashboard/stat-card.tsx`. Skip this if the UI branch already deleted it.
- Delete `INVESTMENT_CURRENCY_EXAMPLES`.
- Remove `buffer` from `package.json` and the lock file, then confirm with `npm run build`.
- Drop the `summarizeExpenses` re-export from `data/expenses.ts` and point its test at `lib/expenses/summary`.
- Remove the category re-exports from `lib/types.ts` and update imports to use `@/lib/expenses/categories`.
- Make the in-file-only exports from the table above module-private.
- Optional one-off check: run `npx knip` (no new dependency) to confirm nothing else is unused, and list anything it finds in the PR.

Done when nothing removed has any reference left and all checks pass.

### Task 2 — One deep module for REST routes

Create `src/lib/http/route.ts`:

```ts
export const withUser = <Ctx>(handler: (req: NextRequest, user: AuthenticatedUser, ctx: Ctx) => Promise<Response>, options: { failure: string }) => …;
export function json(body: unknown, status = 200): NextResponse;          // always private/no-store
export async function parseBody<S extends z.ZodType>(req, schema, message): Promise<z.output<S> | Response>;
export function parseId(id: string, message: string): string | Response;
```

The module owns the following:

- The no-store header, set on every response.
- The 401 response.
- `request.json().catch(() => null)`.
- 422 responses with `flatten().fieldErrors`.
- 404 responses when a handler returns `null`.
- `DomainError` → its own status (from Task 3).
- Anything else → 500 with the route's `failure` message.

Then migrate all 18 route files. Route-specific messages are passed in as arguments, so every message stays exactly the same. `auth`, `health`, `mcp`, and the export route (binary body) keep their own handling and only reuse `json` / headers where that fits.

Typical result:

```ts
export const PATCH = withUser(async (request, user, context: TabRouteContext) => {
  const id = parseId((await context.params).id, "Invalid tab identifier.");
  const input = await parseBody(request, expenseTabSchema, "Check the highlighted details and try again.");
  return json({ tab: await updateExpenseTabForUser(user.id, id, input) ?? notFound("Expense tab not found.") });
}, { failure: "Unable to save expense tab." });
```

Done when no route file declares `PRIVATE_HEADERS` or calls `getAuthenticatedUser` directly, the Task 0 contract test passes, and the existing route tests pass unchanged.

### Task 3 — Unify domain errors

- Add `src/lib/errors.ts` with `class DomainError extends Error { status: 404 | 409 | 422; fieldErrors? }`.
- Replace `InvestmentMutationError` and `NetWorthMutationError` with `DomainError`.
- Update `define-tool.ts`'s `toolError` and the route wrapper to check only `DomainError`.
- Route tests stop redeclaring an error class inside `vi.hoisted` and import the real one instead.

Done when there is one error class and messages and statuses are unchanged.

### Task 4 — Shared validation primitives and domain rules

- Create `src/lib/validation/primitives.ts` with:
  - `idSchema` (`z.uuid()` with an optional message)
  - `decimalString({ label, allowZero, kind: "positive" | "nonnegative" })`, which keeps both current message texts
  - `currencyCode`
  - `calendarDate`
- Use these in `validation/investment.ts`, `validation/net-worth.ts`, `expenses/tab-filters.ts`, the route id checks, and the MCP tool schemas. `isInvestmentCurrency` reuses the same regex.
- Create `src/lib/net-worth/rules.ts` with `purchaseAmountAllowed(kind, category)`. Use it in `netWorthItemSchema`, `updateNetWorthItemForUser`, and both net-worth dialogs.
- Derive `NetWorthItemCreateInput`, `NetWorthItemPatchInput`, and `NetWorthValuationInput` from the zod schemas (`z.output<…>`) instead of hand-writing them.

Done when each rule and regex exists once and validation messages are byte-for-byte unchanged (existing tests plus one test per primitive).

### Task 5 — Deepen the calendar module

- Rename `lib/utils/dates.ts` → `lib/calendar.ts` and add small helpers:
  - `toIsoDate(y, m, d)` and `toIsoMonth(y, m)`
  - `addDays(date, n)`
  - `lastDayOfMonth(month)`
  - `monthsBetween(a, b)`
  - `ANALYTICS_PERIOD_MONTHS`
- Replace the hand-rolled versions in:
  - `data/expenses.ts`: `nextDate`, `buildMonthKeys`, `PERIOD_MONTHS`
  - `expenses/tab-filters.ts`: the `endExclusive` calculation
  - `frontend/expense-analytics.ts`: `monthIndex`, `monthFromIndex`, `daysInMonth`, and the date formatting in `historyBoundaries`
  - `utils/analytics.ts`: the period list
  - the MCP `spendingSummarySchema`: the period enum
- **Make the "now" sources explicit, but do not change them.** Rename `getCurrentMonth` → `getProcessLocalMonth`, and name UTC "today" uses explicitly, so the inconsistency is visible in code. Write it up as a follow-up decision (see *Decisions needed*).

Done when no `padStart(2, "0")` date building remains outside `calendar.ts` and the date tests (including the Bucharest boundary cases) pass.

### Task 6 — Separate pure expense analytics from I/O

- Move `getAnalyticsRange`, `analyticsFromSummary`, and `buildMonthKeys` out of `data/expenses.ts` into `lib/expenses/analytics.ts`.
- Merge them with `historyBoundaries` from `frontend/expense-analytics.ts`, because both compute the same date range for the history view. Use one `resolveAnalyticsRange(filters, currentMonth)` on both server and client.
- Move the rest of `lib/frontend/expense-analytics.ts` (`monthAnalytics`, `expenseTabAnalytics`, `categoryShares`, `categoryComparisons`, `seriesInsights`) into the same module. None of it is frontend-specific.
- Move `lib/frontend/expense-tab-state.ts` and `lib/expenses/tab-filters.ts` together into `lib/expenses/filters.ts`, and `lib/frontend/dashboard-state.ts` plus `lib/utils/analytics.ts` into `lib/expenses/url-state.ts`.
- Move the expense types out of `lib/types.ts` into `lib/expenses/types.ts`. Move `ActionState` to wherever Task 10 puts the form hook. Delete `lib/types.ts`.
- Move the tests along with their modules. Merge `frontend/expense-tab-analytics.test.ts` into `expenses/analytics.test.ts` as its own `describe`.

Done when `lib/frontend/` and `lib/utils/analytics.ts` no longer exist, `data/expenses.ts` contains only Supabase I/O, and every moved test passes unchanged except for import paths.

### Task 7 — Tidy the data modules

**`data/expenses.ts`**

- Split `queryExpensesForUser` into three private helpers:
  - `applyExpenseScope(query, options)` for membership, dates, category, and subtype
  - `fetchAllPages(buildQuery)` for the pagination loop and the completeness check
  - `matchesSearch(expense, term)`
- Keep the exported functions and their behavior identical, including the "empty membership returns `[]`" guard and the "fail on any page error" rule.
- Replace `ExpenseRow` with the generated `Database` row type.

**`data/investments.ts`**

- Add a `TRANSACTION_COLUMNS` constant to replace the 4 copies of the column list.
- Add one `toAccount(row)` with the `broker_id` guard to replace three copies.
- Merge `queryOwnedAccountForBroker` and `queryOwnedAccountById` into `queryOwnedAccount(userId, by: { id } | { brokerId })`.
- Add `toTransactionInsert(transaction)`.
- Remove `as unknown as` casts where the generated types allow it.

**`data/net-worth.ts`**

- Use the rule from Task 4.
- Use `toValuation` and the column constants consistently.
- Document that `createNetWorthItemForUser` gets ownership from `auth.uid()` inside the RPC. Today the unused `_userId` parameter hides this.

**`data/account.ts`**

- Add `updateAccountCurrencyForUser(user, currency)` and have `PATCH /api/account` call it.

Done when each file is shorter, the `as unknown as` count is lower (record it in the PR), and the data tests pass.

### Task 8 — Shared use cases for REST and MCP

Add use-case functions to the data layer so both transports call the same thing:

- `getMonthlyLedgerForUser(userId, month)` → `{ month, expenses, total, count, average }`. Used by `GET /api/expenses` and the MCP `list_expenses` tool.
- `getExpenseTabLedgerForUser(userId, tabId, filters)` → ledger or `null`. Used by `GET /api/expense-tabs/[id]/expenses` and the MCP `get_expense_tab_expenses` tool.

Each transport keeps only its own concerns: REST handles query-string parsing and the `effectiveMonth` field, and MCP handles defaults and tool shapes.

Done when no route or tool calls `summarizeExpenses` directly, and the REST and MCP outputs match the Task 0 snapshot and the existing tests.

### Task 9 — Frontend data access (after the UI branch merges)

- Add `useAccount()` in `src/hooks/use-account.ts`. It returns `{ account, currency }` with `DEFAULT_CURRENCY` as the fallback. Replace the 9 `useSWR<AccountData>(ACCOUNT_API_KEY)` calls and the literal `"EUR"` fallbacks.
- Add `src/lib/api/invalidate.ts` with named invalidation helpers that describe what to refresh after each mutation:
  - `afterInvestmentChange` → investments + net worth + the asset's transaction key
  - `afterNetWorthChange`
  - `afterExpenseChange(month)`
  - `afterTabChange`

  This replaces the cache-invalidation `mutate(...)` calls scattered across the dialogs. Retry buttons that call the bound `mutate()` stay as they are.
- Move the response types for each endpoint (for example `TabsResponse`, defined today inside the expenses page) next to their key in `lib/api/keys.ts`, so each key comes with its type.
- Extract `useExpenseTabRouting()` from `ExpensesContent` (active tab, redirect when the tab is missing, `changeTab`, `saveTab`, `returnToMain`).
- **Decision needed:** remove `tabId` / `tabRevision` from `ExpenseTabLedgerData` and compare `data.tab.id` / `data.tab.updatedAt` in `custom-expense-tab.tsx`. This changes an internal API response that only this client uses. Skip it if you want the REST shape strictly frozen.

Done when no component calls `useSWR` for the account directly and every mutation path goes through an `invalidate` helper.

### Task 10 — One form-submission hook (after the UI branch merges)

- Add `useApiForm()` (for example in `src/hooks/use-api-form.ts`). It returns `{ pending, error, fieldErrors, fieldError(name), submit(fn), reset() }`, ignores double submits, and maps `ApiError` to field errors.
- Migrate the dialogs to it:
  - `add-expense-dialog`
  - `auth-form`
  - `expense-tab-dialog`
  - `add-investment-dialog`
  - `add-order-dialog`
  - `remove-order-dialog`
  - the three net-worth dialogs
  - `delete-expense-button`
  - `custom-expense-tab` delete
- Delete `ActionState` / `INITIAL_ACTION_STATE`.
- Give `add-investment-dialog` and `add-order-dialog` one shared order-fields component and submit function, since they differ only in which fields are fixed. Reuse the UI branch's `FormField` and `AppDialog` for this.

Done when no component declares its own `pending` / `fieldErrors` state for an API call, and a manual check of each dialog shows the same validation messages, disabled states, and success behavior.

### Task 11 — Simplify the tests

Work through this alongside Tasks 2–10, and finish in this PR.

**Shared helpers in `src/test/`:**

- `fake-supabase.ts`: one small in-memory query builder covering only the operations the data layer uses (`select / eq / is / gte / lt / or / order / range / maybeSingle / single / insert / update / delete`). It records the filters that were applied. This replaces the four fakes written in individual files. Keep it under ~120 lines and give it its own short test.
- `route.ts`: `callRoute(handler, { method, url, body, params })` and `signedInAs(user)`. These replace the `jsonRequest` / `request` helpers and the `getAuthenticatedUser` mocks that every route test repeats.
- `builders.ts`: `anExpense()`, `aTab()`, `aTransaction()`, `aManualItem()`, `aValuation()`, each with defaults that can be overridden.

**Rules for every test file:**

- One behavior per `it`. Use `it.each` tables when the same behavior is checked against several inputs.
- Test names are sentences about behavior (for example "excludes expenses from adjacent years"), not implementation details.
- Separate arrange / act / assert with blank lines. No assertion lines that chain several cases.
- Test each guarantee in one place. Auth, headers, and the generic 500 response are covered by the Task 0 contract test and the `http/route` tests, so route tests keep only route-specific behavior.

**Specific rewrites:**

- `data/expense-tab-expenses.test.ts`: split the combined "subtype, no subtype, category and search" test into an `it.each` table. Use the shared fake and `anExpense()`. Merge into `data/expenses.test.ts` under `describe("getExpenseTabExpensesForUser")`.
- `net-worth/calculation.test.ts`: build fixtures with `aManualItem()` and split the 2 large tests into focused ones (currency separation, liabilities, comparisons, attention items).
- `investment-transactions/route.test.ts` and `net-worth/route.test.ts`: drop the redeclared error classes and the auth, header, and 500 cases that the wrapper tests now cover.
- `api/expenses/route.test.ts`: rename "returns the final stored classification after a database classifier" to describe what it actually checks (the response echoes the stored row, not the request), or fold it into the happy-path test.

Done when:

- No test file defines its own Supabase fake.
- The test count may go down, but no behavior loses coverage. Map every removed test to the test that now covers it in the PR description.
- Optionally, if you accept `@vitest/coverage-v8` as a dev dependency, line coverage of `src/lib` is not lower than at the Task 0 baseline.

### Task 12 — Repository hygiene (small)

- Move finished plan documents (`frontend-ux-refactor-*`, `investments-panel-plan`, `mcp-server-plan`, `expense-tabs-and-subtypes-plan`, `net-worth-*`) into `docs/archive/`, and fix any links to them.
- Decide what to do with the untracked `tmp/frontend-*.{cjs,py}` scripts: either move the useful ones to `scripts/` with a README line, or delete them locally.
- Update the README "project structure" section, if it has one, to the new `lib/` map.

## Delivery order

| Order | Task | Depends on | Touches components? |
|---|---|---|---|
| 1 | 0 Baseline + characterization tests | — | No |
| 2 | 1 Dead code | 0 | Only deletes `stat-card` |
| 3 | 3 Domain errors | 0 | No |
| 4 | 2 Route wrapper | 3 | No |
| 5 | 4 Validation primitives | 0 | Two net-worth dialogs (one-line change) |
| 6 | 5 Calendar | 0 | Import paths only |
| 7 | 6 Expense analytics / folders | 5 | Import paths only |
| 8 | 7 Data modules | 3, 4 | No |
| 9 | 8 Shared use cases | 2, 7 | No |
| — | *Merge the UI styling branch* | | |
| 10 | 9 Frontend data access | UI branch | Yes |
| 11 | 10 Form hook | UI branch, 9 | Yes |
| 12 | 11 Tests (final pass) | all above | No |
| 13 | 12 Hygiene | — | No |

Tasks 3–5 are independent of each other and can run in parallel if needed. Import-path changes (Tasks 5 and 6) will conflict with the UI branch in a mechanical way. If the UI branch is close to merging, do those two after it lands.

## Decisions needed

1. **"Now" consistency.** The app mixes process-local time, UTC, and Europe/Bucharest. Recommendation: after Task 5, switch everything to the application calendar (Bucharest) in a separate, explicitly tested **behavior** PR. This is not part of the cleanup, because it changes results near midnight.
2. **`tabId` / `tabRevision`** (Task 9). Remove them, or keep the REST shape frozen.
3. **Coverage tooling.** Add `@vitest/coverage-v8` as a dev dependency to prove there is no coverage loss, or rely on the per-test mapping in the Task 11 PR.
4. **`/confirm-email`.** Keep it (default), or check the Supabase email template and remove the legacy OTP route.

## Validation

For every PR:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Before merging any PR that touches data modules or RLS-relevant queries:

```bash
npm run test:db
```

For Phase B PRs, run a manual smoke test in the dev server:

- Add and delete an expense.
- Switch months, including the future-month clamp.
- Create, edit, filter, and delete a custom tab.
- Export the month.
- Add a buy and a sell order, and remove an order (including the oversell error).
- Add, edit, revalue, and archive a net-worth item.
- Change the currency in Settings.
- Sign out and sign back in.

Then confirm the MCP endpoint still lists the same tools (Task 0 snapshot) and that `get_account` and `list_expenses` return the same payloads.
