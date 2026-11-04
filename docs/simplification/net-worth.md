# Simpler ways: net worth

**Done in U9 (4 November 2026):** proposals 1 (`NET_WORTH_CATEGORIES`), 2 (no `onSuccess` props) and 3 (`net-worth-api.tsx`, `use-net-worth-writes.ts`, optimistic dated values), the value inputs on `AmountInput`, and the single "incomplete" message. The "Add value" date bug was already fixed (`ValuedOnField`, tested). Left: proposals 4 and 5 (the layout report's gate, and routes that aren't rebuilt).

Looked at `src/components/net-worth/**` (10 files, ~870 lines), `src/app/(app)/net-worth`, `src/app/api/net-worth/**`, `src/lib/net-worth/**` (~690 lines) and `src/lib/mcp/tools/net-worth.ts`, with the `find-shapes` script and by reading every component. 5 proposals, about 60 lines. The one most worth doing is **one list of categories** (proposal 1); the most urgent item is a bug: **"Add value" defaults its date to the last observation, so saving it without a look replaces that observation** (see "Found on the way").

## Map

| File | Lines | Role |
| --- | --- | --- |
| `net-worth-panel.tsx` | 164 | `NetWorthPanel` picks Single or Family (as investments does); `groupedEntries` sorts the groups by a hand-written category order. |
| `net-worth-summary.tsx`, `net-worth-attention.tsx`, `net-worth-group.tsx`, `net-worth-entry-row.tsx`, `net-worth-value.tsx` | 15–77 | Display. |
| `add-net-worth-item-dialog.tsx`, `edit-net-worth-item-dialog.tsx`, `add-net-worth-valuation-dialog.tsx`, `net-worth-item-fields.tsx` | 98–171 | Writes, each with `apiRequest` inline and `afterNetWorthChange` (D6; 3 files in `docs/lint-rules.md`). |
| `src/lib/net-worth/*` | ~690 | `calculation.ts` (323) and the service shared by REST and MCP. |

Counts: the asset and liability categories are written out in 4 places; all 3 dialogs take an `onSuccess` that every caller passes as `() => undefined`; 2 hand ladders for loading and errors; 3 inline route context types.

## Proposals

| # | Proposal | Lines saved | Risk | Files |
|---|---|---|---|---|
| 1 | One category table (kind, label, order) in `src/lib/net-worth/types.ts` | ~20 | Low | 4 |
| 2 | Drop the `onSuccess` prop nobody uses | ~12 | Low | 5 |
| 3 | A `net-worth-api.tsx` plus hook, optimistic for valuations | ~15, D6 closed | Medium | 5 |
| 4 | One loading/error gate (layout report) | ~8 | Low | 1 |
| 5 | Use `RouteContext` in the three `[id]` routes | ~3 | Low | 3 |

### 1. One category table

**Why.** The categories live in four places that must agree: `NET_WORTH_SUGGESTED_CATEGORIES` (`src/lib/net-worth/types.ts`), the sort order in `groupedEntries` (`net-worth-panel.tsx:34`, which adds `investments`), the labelled options in `categoryOptions` (`add-net-worth-item-dialog.tsx:22`), and the list in `edit-net-worth-item-dialog.tsx:46`. One table answers all four.

**Before**
```ts
const categoryOrder = ["investments", "cash", "property", "jewelry", "debt"];          // panel
const suggestedCategories = entry.kind === "liability" ? ["debt"] : ["cash", "property", "jewelry"]; // edit dialog
```

**After**
```ts
export const NET_WORTH_CATEGORIES = [
  { key: "investments", kind: "asset", label: "Investments", automatic: true },
  { key: "cash", kind: "asset", label: "Cash" },
  { key: "property", kind: "asset", label: "Property" },
  { key: "jewelry", kind: "asset", label: "Jewelry" },
  { key: "debt", kind: "liability", label: "Debt or mortgage" },
] as const;
```

**Files.** `types.ts`, `net-worth-panel.tsx`, both item dialogs. **Lines saved.** ~20. **Risk.** Low: the labels and order stay the same. **Proof.** The net worth component and calculation tests; `npm run typecheck`, `npm test`.

### 2. Drop the `onSuccess` prop nobody uses

**Why.** `AddNetWorthItemDialog`, `AddNetWorthValuationDialog` and `EditNetWorthItemDialog` each require `onSuccess: () => void` and call it after saving; the only callers (`net-worth-panel.tsx:64`, `net-worth-entry-row.tsx:68–69`) pass `() => undefined`. The dialogs already close themselves and refresh the cache.

**Lines saved.** ~12. **Risk.** Low. **Proof.** `npm run typecheck`, the dialog tests.

### 3. An API object plus hook

**Why.** U9 (D6). `createItem`, `updateItem`, `archiveItem`, `addValuation` in `src/components/net-worth/net-worth-api.tsx`, a preview provider, and a hook. Valuations nearly always succeed, so the plan allows them to be optimistic (`mutate(NET_WORTH_API_KEY, …, { optimisticData, rollbackOnError })`); items need the server's computed totals, so refresh after the answer.

**Risk.** Medium: the optimistic valuation must recompute the totals the same way `calculation.ts` does, or simply show the row as "saving" and refresh; prefer the second. **Proof.** `src/app/api/net-worth/**/route.test.ts`, a hook test for rollback; `npm test`.

### 4 and 5

See the layout report (loading/error gate) and the expenses report, proposal 6 (`RouteContext`: `net-worth/items/[id]`, `items/[id]/valuations`, `valuations/[id]`).

## Found on the way (bugs and copy)

- **"Add value" defaults to the last observation's date.** `add-net-worth-valuation-dialog.tsx:89`: `defaultValue={entry.valuedOn ?? getBucharestToday()}`. In the preview the Savings account opens with "Valued on 01/10/2026", and the dialog says a value on the same date *replaces* that observation. So the quickest path (type the new balance, Save) overwrites October's value instead of adding today's. Default to `getBucharestToday()`.
- **The incomplete total says the same thing three times:** a status badge "Incomplete", a hero figure "Partial", and "Partial known subtotal EUR …" (`net-worth-summary.tsx:21–31`), then a fourth line, "1 value need attention…" (also missing an "s"). One line is enough; a U9 copy point.
- **Value inputs use `step="any"`** (`add-net-worth-valuation-dialog.tsx:81`), so a third decimal goes to the server; U4's `AmountInput` covers it.

## Tidy-ups

- `CategoryOption`, `NetWorthItemState`, `NetWorthItemPatchInput`, `NetWorthSuggestedCategory`, `NetWorthEntryStatus`, `NetWorthChangeMeaning`, `NetWorthChangeTone`, `FamilyNetWorthMember` are exported and used only in their own files.
- `src/app/api/investments/route.ts` and `src/app/api/net-worth/route.ts` are identical in shape (14 lines each); fine as they are (explicit handlers are the convention).

## Considered and rejected

- **A shared "dated value" dialog for net worth and investments**: different rules (orders vs. observations).
- **Merging the Single and Family panels**: the family panel is read-only and per member; the split is clearer.

## Already simple

- `src/lib/net-worth/service.ts` is shared by REST and MCP; `calculation.ts` is pure and well tested.
