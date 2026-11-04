# Simpler ways: investments

**Done in U9 (4 November 2026):** proposal 1 (`investment-api.tsx`, `use-investment-writes.ts`, `afterInvestmentChange` removed from `invalidate.ts`, the lint rule on) and the order-time zone question (order times are Bucharest time, in the form and everywhere shown). Left: proposals 2 and 3 (they wait for the shared loading gate in the layout report) and 4 (the route isn't rebuilt).

Looked at `src/components/investments/**` (10 files, ~1,000 lines), `src/app/(app)/investments`, `src/app/api/investments`, `src/app/api/investment-transactions`, `src/lib/investments/**` (~900 lines), `src/lib/validation/investment.ts` and `src/lib/mcp/tools/investments.ts`, with the `find-shapes` script and by reading the components in full. **The module is already fairly lean.** 4 proposals, about 50 lines; the one worth doing is **an `investment-api.ts` plus hook** (proposal 1), which U9 needs for D6 anyway. The rest are small.

## Map

| File | Lines | Role |
| --- | --- | --- |
| `investments-panel.tsx` | 197 | `InvestmentsPanel` picks `SingleInvestmentsPanel` or `FamilyInvestmentsPanel` from `useViewing().family`. |
| `broker-section.tsx`, `asset-selector.tsx`, `asset-detail.tsx`, `transaction-list.tsx` | 89–172 | One card per broker; tapping an asset opens its detail inline (orders and "Add order"). |
| `add-investment-dialog.tsx`, `add-order-dialog.tsx`, `order-fields.tsx`, `remove-order-dialog.tsx` | 80–140 | Writes. `order-fields.tsx` holds the shared fields and `submitInvestmentOrder` (`apiRequest` POST); `remove-order-dialog.tsx` calls `apiRequest` DELETE. Both refresh with `afterInvestmentChange`. |
| `src/lib/investments/*` | ~900 | Aggregation, valuation and presentation; the service is shared by REST and MCP. |

Counts: 2 component files call `apiRequest` (audit D6, listed in `docs/lint-rules.md`); 3 `isLoading && !data` / `error && !data` ladders; the Single/Family split is the same as net worth's.

## Proposals

| # | Proposal | Lines saved | Risk | Files |
|---|---|---|---|---|
| 1 | An `investment-api.ts` (create order, remove order) plus a hook that refreshes the right keys | ~15, D6 closed | Low | 5 |
| 2 | One loading/error gate instead of three hand ladders | ~10 | Low | 2 |
| 3 | Share the Single/Family switch with net worth | ~6 | Low | 2 |
| 4 | Use `RouteContext` in `investment-transactions/[id]` | ~1 | Low | 1 |

### 1. An API object plus hook for orders

**Why.** U9's brief (D6). `submitInvestmentOrder` already is half an API object: move it and the DELETE from `remove-order-dialog.tsx` into `src/components/investments/investment-api.tsx` (`createOrder`, `removeOrder`), with a provider so `/dev/preview/investments` can add and remove orders in memory. Not optimistic: an order can fail for reasons the user must see (an oversell; audit P6, and the Conventions list in `docs/lint-rules.md`), so the hook only refreshes `INVESTMENTS_API_KEY`, `NET_WORTH_API_KEY` and the asset's transactions after the server answers, as `afterInvestmentChange` does today.

**Before** (`remove-order-dialog.tsx`)
```tsx
await apiRequest<Record<string, never>>(`/api/investment-transactions/${encodeURIComponent(transaction.id)}`, { method: "DELETE" });
await afterInvestmentChange(mutate, detailKey);
```

**After**
```tsx
await orders.remove(transaction.id, detailKey);   // useInvestmentWrites(): API call, then the refreshes
```

**Files.** New `investment-api.tsx`; `order-fields.tsx`, `add-order-dialog.tsx`, `add-investment-dialog.tsx`, `remove-order-dialog.tsx`; `afterInvestmentChange` moves out of `src/lib/api/invalidate.ts`; turn on `local/no-fetch-in-components` for the folder. **Lines saved.** ~15. **Risk.** Low. **Proof.** `src/app/api/investment-transactions/**/route.test.ts` (unchanged server), the dialog tests, a preview fixture; `npm test`, `npm run lint`.

### 2. One loading/error gate

**Why.** `SingleInvestmentsPanel`, `FamilyInvestmentsPanel` and `AssetDetail` each write `if (isLoading && !data) return <DataLoading …/>; if (error && !data) return <DataError …/>; if (!data) return <DataLoading …/>`. The same ladder is in 14 places across the app; a shared gate is proposed in the layout report. Here it saves ~10 lines.

### 3. Share the Single/Family switch with net worth

**Why.** `InvestmentsPanel` and `NetWorthPanel` are the same five lines (`const { family } = useViewing(); return family ? <Family… /> : <Single… />`). Under U9's Money section the two pages sit side by side; one `ViewingSwitch` (or simply rendering both panels from the page with the check in the page) keeps them alike. Small; do it only if U9 touches both pages.

### 4. `RouteContext` in `src/app/api/investment-transactions/[id]/route.ts`

**Why.** One inline `{ params: Promise<{ id: string }> }`; see the expenses report, proposal 6.

## Found on the way

- **The order form asks for quantity, unit price and amount.** `positiveDecimal` for all three in `src/lib/validation/investment.ts`; the amount is usually quantity × price (plus fees). Prefilling the amount from the other two would save typing on a phone. A product question for U9 (fees and rounding), not a simplification.
- **Order times use the browser's zone** (`order-fields.tsx`, `localDateTimeValue()` with `toISOString().slice(0, 16)`, deliberately local; `docs/lint-rules.md` notes it under `no-iso-date-slice`). Audit D9 asks for one zone rule; settle it in U9.

## Tidy-ups

- `InvestmentCalculationError`, `FamilyInvestmentTotal`, `InvestmentValuePresentation`, `INVESTMENT_TRANSACTION_SIDES`, `InvestmentCalculationIssueCode` and `FamilyInvestmentsMember` are exported and only used in their own files: drop `export` where nothing outside needs the type.

## Considered and rejected

- **Merging `AddInvestmentDialog` and `AddOrderDialog`**: they already share `OrderFields` and `submitInvestmentOrder`; what is left differs (broker, instrument and currency only for a new investment).
- **Optimistic orders**: refused by the Conventions list (orders can fail for reasons the user must see).

## Already simple

- `src/lib/investments/service.ts` is shared by REST and MCP; `aggregate.ts` and `valuation.ts` are pure and tested.
- The five redundant `apiFetcher` arguments the audit listed were removed in U1.
