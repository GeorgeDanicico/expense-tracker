# Simpler ways: layout

Looked at the app shell and navigation (`src/components/layout/**`, 11 files, ~970 lines with tests; `src/app/(app)/layout.tsx`), the shared primitives every screen leans on (`src/components/ui/**`, 26 files, ~1,270 lines), `src/hooks/**`, and the screen preview (`src/app/dev/preview/**`), with the `find-shapes` script and by reading the shell, the nav, the More sheet, the permission gate, `AppDialog`, `data-state.tsx` and the API-object files across modules. **The layout folder itself is lean; the payoff is in small shared pieces that every screen task (U4–U11) would otherwise copy again.** 6 proposals, about 150 lines across the app. The one most worth doing is **a `pending` prop on `AppDialog`** (proposal 1), because U4 rewrites `AppDialog` anyway and 15 dialogs work around its absence.

## Map

| File | Lines | Role |
| --- | --- | --- |
| `app-shell.tsx` | 58 | Sidebar (`md` and up), a phone header with only the brand, `main`, the bottom tab bar. Safe areas already handled (`env(safe-area-inset-*)`). |
| `nav-items.ts` | 92 | `NAV_ITEMS`, `NAV_SECTIONS`, `TAB_BAR_ITEMS`, `MORE_SECTIONS`, `MORE_ITEMS`, `navigationFor(membership)`. |
| `mobile-tab-bar.tsx`, `more-sheet.tsx`, `sidebar-nav.tsx`, `nav-item.tsx`, `nav-badge.tsx` | 55–104 | The bars and the More sheet (an `AppDialog`). |
| `permission-gate.tsx`, `use-navigation.ts`, `sign-out-button.tsx` | 44, 10, 91 | Access, nav for the user, sign-out. |
| `src/components/ui/app-dialog.tsx`, `confirm-dialog.tsx`, `data-state.tsx` | 125, 70, 112 | Dialogs; loading, error and refresh states. |
| `src/app/dev/preview/**` | — | Screens with fixtures; four in-memory API fixtures. |

Counts across `src`: 15 dialogs write `onOpenChange={(next) => { if (!form.pending) onOpenChange(next); }}`; 14 `isLoading && !data` / `error && !data` ladders plus the `!matching ? (error ? <DataError/> : <DataLoading/>)` form in the ledger panels; 6 files build a toggle chip from `Button` + `aria-pressed`; 4 API-object files repeat the same 10-line context, provider and hook (4–5 more coming in U8–U11); `MORE_SECTIONS` and `MORE_ITEMS` are computed twice (constants used only by tests, and again inside `navigationFor`).

## Proposals

| # | Proposal | Lines saved | Risk | Files |
|---|---|---|---|---|
| 1 | `AppDialog` takes `pending` and refuses to close while it's true | ~30 | Low | 16 |
| 2 | One `DataGate` for the loading / error ladder | ~45 | Low | ~14 |
| 3 | A `ToggleChip` primitive in `src/components/ui` | ~35 | Low | 7 |
| 4 | `createApiContext(rest)` for the API objects | ~25 now, ~45 after U11 | Low | 4 (+5) |
| 5 | Drop `MORE_SECTIONS` / `MORE_ITEMS`; `navigationFor` is the one source | ~10 | Low | 2 |
| 6 | Shared preview fixture helpers (`delay`, `find`, an in-memory store) | ~20 | Low | 4 |

### 1. `AppDialog` with `pending`

**Why.** A dialog shouldn't close while its request is in flight. `AppDialog` doesn't know about that, so 15 dialogs (9 in `src/components/family`, plus `mcp-tokens.tsx`, `event-dialog.tsx`, `scope-dialog.tsx`, `log-expense-dialog.tsx`, `todo-dialog.tsx`, `reminder-dialog.tsx`) wrap `onOpenChange` by hand. `ConfirmDialog` already takes `pending`. U4 turns `AppDialog` into a bottom sheet with "don't close a dirty form"; the pending guard belongs in the same place.

**Before**
```tsx
<AppDialog open={open} onOpenChange={(next) => { if (!form.pending) onOpenChange(next); }} …>
```

**After**
```tsx
<AppDialog open={open} onOpenChange={onOpenChange} pending={form.pending} …>
```

**Lines saved.** ~30 (2 per dialog). **Risk.** Low. **Proof.** A new `src/components/ui/app-dialog.test.tsx` ("doesn't close while pending"; there is no dialog test today), the family dialog tests; `npm test`. A candidate lint rule keeps the hand guard from coming back.

### 2. One `DataGate`

**Why.** Screens repeat:
```tsx
if (isLoading && !data) return <DataLoading label="Loading your net worth…" />;
if (error && !data) return <DataError retry={() => void mutate()} />;
if (!data) return <DataLoading label="Loading your net worth…" />;
```
in 14 places (`investments-panel.tsx` ×2, `asset-detail.tsx`, `net-worth-panel.tsx` ×2, `settings/page.tsx`, `settings/family/page.tsx`, `settings/family/manage/page.tsx`, `manage-invites.tsx`, `recent-imports.tsx`, and more), with the loading label written twice each time.

**After**
```tsx
const result = useSWR<NetWorthOverview>(netWorthApiKey(member));
return <DataGate result={result} loading="Loading your net worth…">{(data) => …}</DataGate>;
```
`DataGate` lives in `src/components/ui/data-state.tsx` next to `DataLoading`, `DataError` and `DataRefresh`, and can show the refresh bar too. U4 can add the skeleton fade the plan wants in one place.

**Lines saved.** ~45. **Risk.** Low: same components, same labels. **Proof.** Each screen's existing tests; `npm test`.

### 3. `ToggleChip`

**Why.** `Chip` is defined identically in `event-dialog.tsx:76`, `member-chips.tsx:16` and `todo-filters.tsx:16`; `viewing-picker.tsx`, `reminder-dialog.tsx` (`LeadTimeChips`) and `permissions-editor.tsx` build the same `Button` with `aria-pressed`, `variant={pressed ? "solid" : "outline"}`, `colorPalette={pressed ? "brand" : undefined}`. At 390 px these chips are 32 px tall; U4's touch sizes and press feedback need one recipe, and U6's category chip is another of them.

**Lines saved.** ~35. **Risk.** Low. **Proof.** The calendar, board, reminder and viewing tests (they query by role and `aria-pressed`).

### 4. `createApiContext`

**Why.** `todo-api.tsx`, `reminder-api.tsx`, `calendar-api.tsx` and `import-api.tsx` end with the same block:
```tsx
const TodoApiContext = createContext<TodoApi>(restTodoApi);
export function TodoApiProvider({ api, children }: { api: TodoApi; children: ReactNode }) { return <TodoApiContext.Provider value={api}>{children}</TodoApiContext.Provider>; }
export function useTodoApi() { return useContext(TodoApiContext); }
```
U8–U11 add five more (expenses, investments, net worth, family, settings). One `createApiContext(restTodoApi)` returning `[TodoApiProvider, useTodoApi]` makes each new module three lines of wiring.

**Lines saved.** ~25 now, ~45 after U11. **Risk.** Low (named exports stay). **Proof.** `screen-preview.tsx` still wraps the screens; `npm run typecheck`, `npm test`.

### 5. One source for the More items

**Why.** `nav-items.ts` exports `MORE_SECTIONS` and `MORE_ITEMS` (used only by `nav-items.test.ts`), and `navigationFor` computes the same thing again with the permission filter. U5 rewrites this file for Home, Money, +, Planning, More; keep one function and test it per kind of user.

### 6. Shared preview fixture helpers

**Why.** `src/app/dev/preview/{calendar,reminder,todo,import}-fixtures.ts` each define `delay`, `find(id)` (throwing a 404 `ApiError`) and a seeded in-memory store. U8–U11 add four more fixtures; one `memory-store.ts` saves ~20 lines now and more later. Dev-only code.

## Found on the way (for U3, U5, U7, U13)

- **The bottom bar's active state is exact-match.** `mobile-tab-bar.tsx` uses `pathname === href`, so on `/expenses/import` (or `/expenses?tab=…` under another path) the Expenses tab isn't highlighted; the sidebar uses `isActivePath`. Use `isActivePath` in U5.
- **Home is behind the expenses permission.** `dashboard/page.tsx` wraps everything in `PermissionGate module="expenses"`, so a kid whose parent turns Expenses off opens the app to "This part of the app is turned off for you. Ask a parent." U7's "today" Home must render reminders and to-dos without that permission.
- **The phone header holds only the logo** (48 px plus the safe area) on every screen; U5's shrinking header or a page title there gives that space back.
- **The More sheet is a centred `AppDialog`** that ends at the bottom of the screen; U4's bottom sheet makes it a real one.
- **Touch targets:** at 390 px no control in `/dev/ui` reaches 44 px (measured: 28, 32 and 36 px), and some inputs are 12–14 px text, which makes iOS zoom. U4's recipe work.
- **The preview leaves itself.** Switching an expense tab, the Home view (Summary / Monthly / History) or a settings tab pushes the real URL (`/expenses?tab=…`, `/dashboard?view=…`), which needs a session. Query strings on the preview URL work instead (`/dev/preview/expenses?tab=tab-car`, `/dev/preview/dashboard?view=monthly`). The preview also has no kid mode and no family, permissions or MCP screens. U3 should add those before mocking.
- **The preview needs a visible pane.** React 19.2 reveals streamed Suspense boundaries on `requestAnimationFrame`; in a hidden browser tab the page stays on its skeletons. Not an app bug (a real phone shows the page), but worth knowing when screenshotting.

## Tidy-ups

- `MEMBER_COLORS`, `MEMBER_FOREGROUNDS`, `SubmitOptions`, `PHONE_QUERY`, `SIGN_OUT_UNSUBSCRIBE_TIMEOUT_MS`, `ViewingState` are exported but used only in their own files.

## Considered and rejected

- **A `send(method, url, body)` wrapper for `apiRequest`**: 30 `JSON.stringify` bodies, but no line saved per call; the API objects absorb them.
- **A server layout for the session redirect** (audit P12): phase 16's work, not layout simplification.

## Already simple

- `navigationFor` and `useNavigation`: one function decides what each user sees.
- `useApiForm` (39 files) and `useAccount`: the patterns the proposals above extend.
