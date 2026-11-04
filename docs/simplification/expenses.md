# Simpler ways: expenses

**Status (U10, 4 November 2026):** proposal 7 (`useNow`) done in U10 (`src/hooks/use-now.ts`, used by reminders, Home, the week view and recent imports).

Looked at the expenses module as U8 will rebuild it: `src/components/expenses/**` (import included), `src/components/dashboard/**`, `src/app/(app)/expenses/**`, `src/app/api/expenses/**`, `src/app/api/expense-tabs/**`, `src/lib/expenses/**`, `src/lib/validation/expense.ts`, `src/lib/mcp/tools/expenses.ts` and the expense half of `src/lib/api/invalidate.ts`: 83 files, about 5,200 lines of components and 1,900 of `src/lib/expenses`. Method: the `find-shapes` script, then reading every component and the files it paired them with. **7 proposals, about 150 lines in all.** The one most worth doing is **one ledger panel instead of two** (proposal 1), because U8 rebuilds that screen anyway; the most urgent is not a simplification but a bug found on the way: **the add-expense form dates every new expense on the last day of the month** (see "Found on the way").

**Done in U8 (4 November 2026):** proposals 1, 2, 3, 4 and 6, the B4 fix and the tidy-ups
(`IMPORT_PAGE_HREF` and `DeleteExpenseButton` are gone; `afterExpenseChange` too). Proposal 5 was
done in U6. Proposal 7 (`useNow`) touches reminders and the calendar, so it is left to U10. The
saved-tab filters now sit behind the Filters chip, so the figures come first on a phone.

## Map

| Area | Files | Notes |
| --- | --- | --- |
| Page | `src/app/(app)/expenses/page.tsx` (159) | Header actions, viewing chips, saved tabs, the two panels, the tab dialog. |
| Main ledger | `main-expenses-panel.tsx` (65), `family-expenses-panel.tsx` (69) | Same skeleton; token similarity 1.0 by the script. |
| List | `expense-list.tsx` (87) → `expense-table.tsx` (94, `lg` and up) + `expense-mobile-list.tsx` (45, below `lg`) | Both lists are rendered and one is hidden with CSS, so every row (and its delete button) is in the DOM twice. |
| Writes | `add-expense-dialog.tsx` + `expense-form.tsx`, `delete-expense-button.tsx`, `expense-tab-dialog.tsx`, `custom-expense-tab.tsx` (tab delete) | Each calls `apiRequest` inline, then an `after…` helper in `src/lib/api/invalidate.ts` (audit D6). |
| Cache | `src/lib/api/invalidate.ts` (193; ~120 are expenses) | `withExpenseAdded` / `withExpenseRemoved` hand-update two keys per month (`expensesApiKey`, `mainExpensesApiKey`) and every `/api/expenses?` key (B4). |
| Dashboards | `summary-`, `monthly-`, `history-`, `family-summary-dashboard.tsx` and 12 parts | Summary and Monthly each have their own `AddExpenseDialog`; Monthly repeats the Expenses month toolbar and totals. |
| Import | `import/*` (10 files, ~1,700) | Already the API-object style (`import-api.tsx`), driven by `/dev/preview/import`. |

Counts: 2 panels with one skeleton; 2 cache keys for the same month's ledger; 2 hand-written `TabRouteContext` types (19 across the repo, 14 routes already use `RouteContext`); 1 MCP schema that re-writes the patch schema; 3 copies of `useNow` across the repo (one here).

## Proposals

| # | Proposal | Lines saved | Risk | Files |
|---|---|---|---|---|
| 1 | One `LedgerPanel` for the main and family ledgers | ~55 | Low | 3 |
| 2 | Move expenses to an `expense-api.ts` plus hook, and drop the expense half of `invalidate.ts` | ~40 net, plus B4 fixed | Medium | 8 |
| 3 | One cache key per month ledger (drop `context=main` on the client) | ~10, and one place to update | Medium | 4 |
| 4 | Render one expense list per breakpoint, not two | ~0 lines; half the rows in the DOM | Low | 2 |
| 5 | Build MCP `update_expense`'s schema from `expensePatchSchema` | ~8 | Low | 2 |
| 6 | Use `RouteContext` in the two expense-tab routes | ~4 | Low | 2 |
| 7 | Share `useNow` (with reminders and the calendar) | ~12 across the repo | Low | 3 |

### 1. One `LedgerPanel` for the main and family ledgers

**Why.** `main-expenses-panel.tsx` and `family-expenses-panel.tsx` are the same component: the same `useSWR(mainExpensesApiKey(month, viewing.member), { keepPreviousData: false })`, the same month toolbar, the same loading / error / refresh ladder, the same two cards. They differ in the stat values (one amount, or `CurrencyAmounts` per currency) and whether rows can be deleted. U8 rebuilds this screen, so do it there.

**Before** (both files)
```tsx
const { data, error, isValidating, mutate } = useSWR<ExpensesData>(mainExpensesApiKey(month, viewing.member), { keepPreviousData: false });
const matching = data?.month === month ? data : undefined;
return (<Stack gap="4"><MonthToolbar … />{!matching ? (error ? <DataError …/> : <DataLoading …/>) : (<> … </>)}</Stack>);
```

**After**
```tsx
export function LedgerPanel({ month, currency }: { month: string; currency: string }) {
  const viewing = useViewing();
  const { data, … } = useSWR<ExpensesData | FamilyExpensesData>(mainExpensesApiKey(month, viewing.member), { keepPreviousData: false });
  const totals = data && "totals" in data ? data.totals : undefined;   // the family view
  …<Stat size="hero" label="Total" value={totals ? <CurrencyAmounts totals={totals} … /> : <Amount value={data.total} … />} />
}
```

**Files.** `main-expenses-panel.tsx`, `family-expenses-panel.tsx` → one file; `src/app/(app)/expenses/page.tsx`. **Lines saved.** ~55. **Risk.** Low: one branch on the response shape, which the API already distinguishes. **Proof.** `src/app/(app)/expenses/page.test.tsx`, `src/app/api/family-expenses.test.ts`, the preview at `/dev/preview/expenses` with "Me" and "Family"; `npm run typecheck`, `npm test`, `npm run lint`.

### 2. Move expenses to an API object plus a hook

**Why.** Audit D6 and U8's brief. Today 4 component files call `apiRequest` (`expense-form.tsx`, `delete-expense-button.tsx`, `expense-tab-dialog.tsx`, `custom-expense-tab.tsx`) and the cache updates live far away in `src/lib/api/invalidate.ts` (`withExpenseAdded`, `withExpenseRemoved`, `afterExpenseCreated`, `afterExpenseDeleted`, `afterTabSaved`, `afterTabDeleted`, `afterExpenseChange`, `isTabLedgerKey`: ~110 lines). Following `todo-api.tsx` + `use-todo-board.ts`: an `ExpenseApi` type with `create`, `remove`, `saveTab`, `removeTab`, a `restExpenseApi`, a provider for `/dev/preview`, and a `useExpenseWrites()` hook that owns the optimistic updates with SWR's `mutate(key, update, { optimisticData, rollbackOnError })`. B4 goes away on the way, because the hook can skip `member=` keys and revalidate them instead (audit B4's fix). The preview can then save expenses instead of failing against the real API.

**Files.** New `src/components/expenses/expense-api.tsx` and `use-expense-writes.ts`; the 4 components; `invalidate.ts` loses its expense half; `screen-preview.tsx` gains `ExpenseApiProvider`; turn on `local/no-fetch-in-components` for `src/components/expenses` and `src/app/(app)/expenses`. **Lines saved.** ~40 net (the provider boilerplate is ~10 lines; see the layout report's proposal for a shared `createApiContext`). **Risk.** Medium: cache behaviour across Home, Expenses and the tab ledgers. **Proof.** A new hook test in the style of `src/components/todos/todo-board.test.tsx` (optimistic add, rollback, family keys untouched); `src/app/(app)/expenses/page.test.tsx`; `npm test`, `npm run lint`.

### 3. One cache key per month ledger

**Why.** The same month is cached twice: `expensesApiKey(month)` (`/api/expenses?month=…`, used by the Monthly dashboard) and `mainExpensesApiKey(month)` (the same plus `&context=main`, used by Expenses). The only difference is that `context=main` clamps a future month to the current one and adds `effectiveMonth`; the client already clamps with `resolveMainExpenseMonth`. So every write updates both keys (`afterExpenseCreated` makes two `mutate` calls) and a fetch on one screen doesn't warm the other. When U7 moves Monthly under Money, use one key for both.

**Files.** `src/lib/api/keys.ts`, `monthly-dashboard.tsx`, the two panels, `invalidate.ts` (or the new hook). **Lines saved.** ~10, and one key to keep right. **Risk.** Medium: an SWR key change (allowed here because the screens change together; the API can keep accepting `context=main`). **Proof.** `src/app/api/expenses/month-limit.test.ts` keeps the server rule; `npm test`.

### 4. Render one expense list per breakpoint

**Why.** `ExpenseList` renders `ExpenseTable` (`display={{ base: "none", lg: "block" }}`) and `ExpenseMobileList` (`display={{ base: "block", lg: "none" }}`) together. In the browser at 390 px every expense row and every "Delete …" button exists twice (28 delete buttons for 14 expenses). It saves no lines, but halves the DOM on the longest list in the app, and U12's swipe rows only need to exist once. Either pick with `useIsPhone()` (already in `src/hooks`) or make the mobile list the only list and let it widen.

**Files.** `expense-list.tsx`, possibly `expense-table.tsx`. **Risk.** Low (a first paint before `useIsPhone` resolves must not flash; render the phone list by default). **Proof.** `src/app/(app)/expenses/page.test.tsx`; the preview at 390 and 1280 px.

### 5. Build MCP `update_expense`'s schema from the patch schema

**Why.** `src/lib/mcp/tools/expenses.ts` writes out `updateExpenseSchema` field by field (description, amount, category, subtype, expenseDate, notes), which is `expensePatchSchema` in `src/lib/validation/expense.ts` plus `id` and an "at least one change" refine. Export the patch schema and `.extend({ id: idSchema() })` it. The advertised shape must stay the same.

**Files.** `src/lib/validation/expense.ts`, `src/lib/mcp/tools/expenses.ts`. **Lines saved.** ~8. **Risk.** Low. `expensePatchSchema` has a `superRefine` (subtype against category); in the installed zod 4.6.7, `.extend()` on it works and keeps the refinement (checked with `node -e`: a refine that always fails still fails after `.extend({ b: z.string() })`). That adds the subtype check to MCP's patch, which `update_expense` leaves to the database today, so compare the error text in the tool tests. **Proof.** `src/lib/mcp/tool-surface.test.ts` and its snapshot, `src/lib/validation/expense.test.ts`.

### 6. Use `RouteContext` in the two expense-tab routes

**Why.** `src/app/api/expense-tabs/[id]/route.ts` and `[id]/expenses/route.ts` each declare `type TabRouteContext = { params: Promise<{ id: string }> }`. Next 16 generates `RouteContext<"/api/expense-tabs/[id]">` (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`, "Route Context Helper"); 14 routes already use it and CI runs `npx next typegen` before `npm run typecheck`.

**Lines saved.** ~4 here, ~19 declarations across the repo. **Risk.** Low. **Proof.** `npm run typecheck`. A lint rule would keep it (see the audit's candidate rules).

### 7. Share `useNow`

**Why.** `recent-imports.tsx:41`, `family-calendar/week-view.tsx:38` and `reminders/use-reminders.ts:25` each write a minute-ticking `useNow`. The reminders one takes an interval; the week view's can be off and starts as `null` (to avoid a hydration mismatch). One `src/hooks/use-now.ts` with `(intervalMs = 60_000, enabled = true)` covers all three.

**Lines saved.** ~12 across the repo. **Risk.** Low: keep the week view's `null` start. **Proof.** `src/components/reminders/*.test.tsx`, `src/components/family-calendar/family-calendar.test.tsx`, `import-ui.test.tsx`.

## Found on the way (bugs, not simplifications)

- **Fixed in U6:** the fast expense form starts on today, or on the last day of a past month shown.
- **New expenses default to the last day of the month.** `expense-form.tsx` sets `defaultValue={maxDate}`, and `maxDate` is `lastDayOfMonth(range.month)`, so on 4 November the date field says 30 November (seen in the browser at `/dev/preview/dashboard` and `/dev/preview/expenses`). Anyone who doesn't change it records a future-dated expense. Default to `getBucharestToday()` when the selected month is the current one, else the month's last day. U6 rewrites the form; fix it there, or sooner as its own small PR.
- **Saved-tab filters take the whole first screen on a phone.** On `?tab=…` the Date scope, Search, Category and Subtype fields plus Apply and Reset come before the total; the first figure is below the fold at 390 px. A U8 layout point, not code.

## Tidy-ups

- `IMPORT_PAGE_HREF` (`import-statement-button.tsx`) and `afterExpenseChange` (`invalidate.ts`) are exported but only used in their own files: drop `export`.
- `expenseAmountSchema` is exported and only used in `expense.ts`: drop `export`, or keep it if U6's shared schema needs it.
- `DeleteExpenseButton` types the response as `{ success: true }`; D4's 204 convention (phase 18) would make it `void`.

## Considered and rejected

- **A `send(method, url, body)` helper around `apiRequest`**: 30 `JSON.stringify` bodies across components, but each call site keeps the same length; the API object in proposal 2 removes most of them anyway.
- **Merging `SummaryDashboard` and `FamilySummaryDashboard`**: the family one groups by currency and member and has charts of its own; they would drift. U7 replaces Home, so leave both until then.
- **Folding the month toolbar's "Go" form into the stepper**: a design decision for U8 (the mockup), not a simplification.

## Already simple

- The routes (`expenses`, `expense-tabs`) follow `withPermission` → `parseId` / `parseBody` → one call → `json`.
- `src/lib/validation/expense.ts` already refuses a third decimal (audit B1 is fixed on `main`).
- The import screens (`import/*`) already use the API-object style with a preview fixture.

## Leads outside this target

- `isLoading && !data` / `error && !data` ladders: 14 in components and pages (see the layout report).
- `if (!form.pending) onOpenChange(next)`: 15 dialogs guard closing by hand (see the layout report, for U4's `AppDialog`).
