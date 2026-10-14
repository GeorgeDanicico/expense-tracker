# Simplified Investments panel implementation plan

Prepared 12 September 2026 for the current Simple Ledger Next.js application.

## Decision

Use two application tables only:

1. `investment_accounts` identifies the user's broker: initially `xtb` or `banca_transilvania`.
2. `investment_transactions` stores every executed buy or sell.

An investment is derived from transactions with the same account, instrument and currency. There is no separate investments, assets, prices or FX table. The Next.js server queries the two tables, performs the portfolio aggregation, obtains development prices from a mock third-party adapter, and returns presentation-ready data. The browser formats and displays that result.

Statement parsing and importing are outside this plan.

This is a good fit for the current application and expected personal data volume. It keeps the database easy to understand and lets the calculation rules evolve in TypeScript. It also has several deliberate consequences:

- Adding an investment creates its first transaction. An empty investment cannot exist without a third table.
- Deleting the last transaction removes that asset from the broker automatically.
- EUR, USD and RON values remain separate. The UI must never add different currencies into one total.
- Mock prices are not persisted. If the mock adapter has no price for an instrument, stored transactions still work but its simulated current value is unavailable.
- This model tracks invested assets, not uninvested broker cash, deposits, dividends, fees or taxes.

## Two necessary data rules

The proposed fields need two precise conventions to keep calculations correct.

First, each transaction needs a `side` of `buy` or `sell`. A delete means “this recorded order was wrong and should be removed”; a sell means “the asset was sold.” Without `side`, the backend cannot calculate the remaining quantity or cost basis after sales.

Second, `currency`, `unit_price` and `amount` must all use the instrument's quoted currency. For example, a USD-listed stock stores its unit price and transaction amount in USD even when the XTB cash account settles in EUR. This makes the stored cost comparable with a current USD market price without adding FX data.

That choice means this version does not preserve the exact EUR cash movement for a USD order. Supporting both figures later would require an additional settlement amount and settlement currency. It should not be hidden inside the one `amount` field because that would mix incompatible currencies.

Use a stable instrument code, such as `VWCE.DE`, rather than a broad description such as `S&P 500`. The code identifies one security and listing and becomes the lookup key for the mock adapter. A user-friendly name can come from the mock response or a small code-level label map; it does not require another database table.

## Architecture

```text
                       Supabase
           investment_accounts + transactions
                            |
                            v
              Next.js server-only data layer
        query rows -> aggregate -> request mock quotes
                            |
                            v
              authenticated route handlers
                            |
                            v
       SWR + small interactive React components
        broker groups -> asset buttons -> detail
```

### Where aggregation should happen

Perform aggregation in the Next.js server layer, not in the browser and not in Postgres functions for this version.

The server should fetch the signed-in user's bounded transaction set in one query, group it with `Map` by `(account_id, instrument, currency)`, process each group chronologically, and merge one mock quote per unique instrument. This gives every screen the same calculation, keeps raw transaction history out of the overview response, and avoids complex SQL views or database functions.

The browser should only select an asset, submit forms, format returned decimal strings, and render states. It should never recalculate authoritative quantities, cost basis or gain independently.

Postgres aggregation would become worthwhile if transaction counts become large, the same figures are needed by several independent services, or measured response times show that transferring a user's rows is a problem. None of those conditions applies to the first personal-use version.

This phase makes no outbound market-data request. The backend queries Supabase and calls an injected in-memory mock adapter. A future real provider can implement the same interface without changing aggregation, API responses or UI components.

## Database schema

### `investment_accounts`

This table contains one broker row per user.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `uuid` | Primary key used by transactions. |
| `user_id` | `uuid` | Owner; references `auth.users(id)`. |
| `broker_id` | `text` | `xtb` or `banca_transilvania`. |

Add `unique (user_id, broker_id)` because this version models one logical account for each broker. If multiple XTB accounts are needed later, remove that uniqueness rule and add an account label at that time.

### `investment_transactions`

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `uuid` | Primary key; a manual order gets a new UUID. |
| `investment_account_id` | `uuid` | References `investment_accounts(id)`. |
| `instrument` | `text` | Stable instrument/listing code, for example `VWCE.DE`. |
| `currency` | `text` | Three-letter instrument currency, for example `EUR`, `USD` or `RON`. |
| `side` | `text` | `buy` or `sell`. |
| `amount` | `numeric(28,10)` | Positive total order value in `currency`. |
| `quantity` | `numeric(28,10)` | Positive number of units; fractional units are supported. |
| `unit_price` | `numeric(28,10)` | Execution price of one unit in `currency`. |
| `executed_at` | `timestamptz` | Execution date and time. |

Do not repeat `broker_id` in this table. `investment_account_id` already determines the broker, and storing both would allow contradictory values. The API may accept `brokerId` for convenience, then resolve it to the user's account row before inserting.

Add database checks for supported broker IDs, `side in ('buy', 'sell')`, uppercase three-letter currency codes, non-empty instruments, and positive amount, quantity and unit price. Add an index on `(investment_account_id, instrument, currency, executed_at, id)` to support grouping and deterministic order processing.

The standalone import process may supply a deterministic UUID as `id` so that replaying the same source row is idempotent. This is only a write contract; parsing remains outside the Investments implementation.

### Ownership and Supabase access

Enable RLS on both tables. Grant `select`, `insert` and `delete` only to `authenticated`; grant nothing to `anon`. Explicit grants are required because current Supabase projects may not expose new tables to the Data API automatically.

- Account policies compare `investment_accounts.user_id` with `(select auth.uid())`.
- Transaction policies use an `exists` check through `investment_accounts` so a user can access a transaction only when they own its account.
- No update policy is needed for the first version. Correcting an order means delete and add again.
- The Next.js server must use the signed-in user's Supabase client. A service-role key is unnecessary and must not be exposed.

Add RLS tests with two users and an anonymous role. Verify allowed reads/inserts/deletes for the owner and rejected cross-user access.

## Server-side calculation contract

Use a decimal library for all arithmetic. Supabase/PostgREST numeric values and API financial values should remain strings at system boundaries; convert them to decimal objects only inside the calculation module.

For each `(account, instrument, currency)` group, sort transactions by `(executed_at, id)` and apply weighted-average cost:

```text
Buy:
  quantity = quantity + bought quantity
  remaining cost = remaining cost + buy amount

Sell:
  average cost = remaining cost / quantity before sale
  removed cost = average cost * sold quantity
  quantity = quantity - sold quantity
  remaining cost = remaining cost - removed cost
  realized gain = sell amount - removed cost
```

Reject a manual sell whose quantity exceeds the position available at that point in time. An imported invalid history should return a clear calculation error for the affected asset instead of silently producing a negative holding.

After merging a mock quote in the same currency:

```text
average cost       = remaining cost / remaining quantity
current value      = remaining quantity * current unit price
unrealized gain    = current value - remaining cost
unrealized gain %  = unrealized gain / remaining cost * 100
```

Return these asset values in the instrument currency. Build broker summaries as currency buckets, for example:

```text
XTB
  EUR  €4,200.00
  USD  $1,380.00

Banca Transilvania
  RON  8,750.00 RON
```

There is no single XTB or portfolio total when more than one currency is present. The UI should show “Totals by currency,” never an arithmetically invalid combined figure.

## Mock third-party price adapter

Create a small server-only contract:

```ts
type Quote = {
  instrument: string;
  price: string;
  currency: string;
  asOf: string;
  displayName?: string;
  source: "mock";
};

interface ThirdPartyQuoteAdapter {
  getQuotes(instruments: string[]): Promise<Map<string, Quote>>;
}
```

Implement `MockThirdPartyQuoteAdapter` behind this interface:

- Keep deterministic mock records for representative XTB and Banca Transilvania instruments in a server-only fixture module.
- Return values through the asynchronous adapter interface so the server flow behaves like a future network integration.
- Return only requested instruments and deduplicate repeated codes.
- Add a small artificial delay in development tests only when loading behavior needs verification; production code should return immediately.
- A missing mock instrument returns `priceStatus: 'unavailable'` without preventing transaction data from loading.
- If a mock quote currency differs from the stored transaction currency, return `priceStatus: 'currency_mismatch'` and do not calculate value or gain.
- Include `source: 'mock'` in the response and visibly label every simulated value as **Mock price** in the UI.

Do not add server caching for the mock. Keep authenticated investment responses private and uncached. Select the adapter in one composition module so a real implementation can replace the mock later without edits to route handlers or calculation code.

## API contracts

### `GET /api/investments`

1. Authenticate the user.
2. Query their accounts and transactions in one joined/bounded request.
3. Aggregate every asset on the server.
4. Request mock quotes for unique active instruments through the adapter.
5. Return broker groups, currency subtotals and compact asset summaries.

The overview response should not include the transaction arrays:

```ts
type InvestmentsOverview = {
  brokers: Array<{
    accountId: string;
    brokerId: "xtb" | "banca_transilvania";
    totalsByCurrency: Array<{
      currency: string;
      currentValue: string | null;
      remainingCost: string;
      unrealizedGain: string | null;
    }>;
    assets: Array<{
      instrument: string;
      displayName: string;
      currency: string;
      quantity: string;
      averageCost: string | null;
      currentPrice: string | null;
      currentValue: string | null;
      unrealizedGain: string | null;
      priceAsOf: string | null;
      priceStatus: "current" | "unavailable" | "currency_mismatch";
      priceSource: "mock" | null;
    }>;
  }>;
};
```

### `GET /api/investment-transactions`

Accept `accountId`, `instrument` and `currency` as validated query parameters. Query and return only that asset's transactions. The frontend calls this endpoint only after the user clicks its asset button.

### `POST /api/investment-transactions`

Accept `brokerId`, `instrument`, `currency`, `side`, `amount`, `quantity`, `unitPrice` and `executedAt`.

Normalize `instrument` and `currency` to uppercase, validate numeric inputs with Zod, upsert the user's broker account when necessary, validate chronological sell quantity, and insert the transaction. If the account insert succeeds but transaction validation later fails, an unused account row is harmless and is hidden from the overview until it has a transaction.

### `DELETE /api/investment-transactions/[id]`

Delete only when the transaction belongs to the authenticated user's account. Before deletion, recalculate the affected chronological history and reject a deletion that would make a later sell exceed the available quantity. Return `204` on success.

Deletion is intentionally permanent in this minimal model. An imported row can reappear if the separate import process writes it again, so that process must decide how user deletions are respected.

All handlers follow the application's current conventions: Zod validation, stable JSON error bodies, `Cache-Control: private, no-store, max-age=0`, and numeric values encoded as strings.

## Frontend design

### Investments page

Add `/investments` to the authenticated navigation. The page contains:

1. A compact title and **Add investment** action.
2. One broker section for XTB and one for Banca Transilvania when each has data.
3. Currency subtotal cards inside each broker section.
4. A row of asset buttons showing symbol, quantity, current value and currency.
5. No open asset detail on first load.
6. A detail panel that appears only after an asset button is clicked.

Assets should look like tabs but use ordinary button/list semantics while no asset is selected. Once selected, apply a clear visual selected state and connect the button to its detail region with `aria-controls`. This avoids an invalid tab widget with no initially selected tab.

### Asset detail

The selected panel shows:

- instrument name and exact symbol;
- quantity and native currency;
- average acquisition price;
- current price and quote time/status;
- remaining cost, current value and unrealized gain;
- realized gain when sell transactions exist;
- **Add order** action;
- transaction history ordered newest first.

Show a skeleton only inside the newly opened detail region while its transaction history loads. Keep the broker summary and other asset buttons usable.

### Add investment

Because investments are derived, **Add investment** creates the first order:

1. Choose XTB or Banca Transilvania.
2. Enter the exact instrument/listing symbol.
3. Choose the instrument currency.
4. Enter the first Buy order: quantity, unit price, amount and execution date/time.
5. Check whether the mock adapter recognizes the instrument, but allow any valid instrument code to be saved when no mock price exists.
6. Save, close the dialog and reveal the new asset under its broker.

The first order is always a buy because no units are available to sell yet.

### Add and remove an order

**Add order** opens from an asset detail panel. Broker, instrument and currency are displayed and locked; the user enters side, quantity, unit price, amount and date/time. After saving, revalidate both the overview and the selected transaction history.

Each order row/card has a **Remove** action. The confirmation identifies the side, quantity, symbol and date, and explains that totals will be recalculated. After deletion, refresh both SWR keys. If it was the last order, close the detail panel because the asset no longer exists.

## Suggested file structure

```text
src/app/(app)/investments/page.tsx
src/app/api/investments/route.ts
src/app/api/investment-transactions/route.ts
src/app/api/investment-transactions/[id]/route.ts

src/components/investments/investments-panel.tsx
src/components/investments/broker-section.tsx
src/components/investments/asset-selector.tsx
src/components/investments/asset-detail.tsx
src/components/investments/transaction-list.tsx
src/components/investments/add-investment-dialog.tsx
src/components/investments/add-order-dialog.tsx
src/components/investments/remove-order-dialog.tsx

src/lib/data/investments.ts
src/lib/investments/aggregate.ts
src/lib/investments/quotes/types.ts
src/lib/investments/quotes/mock-third-party.ts
src/lib/investments/quotes/mock-data.ts
src/lib/investments/quotes/get-adapter.ts
src/lib/validation/investment.ts
```

Keep database access and quote adapters marked `server-only`. Keep the page mostly presentational and place client boundaries only around SWR, asset selection and dialogs.

## Mobile and accessibility behavior

- Use one broker section per row on small screens.
- Make asset buttons full-width stacked rows on phones; use a horizontally scrollable compact row on wider screens.
- Open asset detail inline below the selected row on desktop and as a full-width panel or full-screen dialog on narrow phones.
- Use at least 44 px touch targets for asset and order actions.
- Show transaction history as cards on phones and a compact table on desktop.
- Keep the currency visible beside every amount; do not rely on symbol alone for ambiguous currencies.
- Show gain/loss with text and sign as well as color.
- Move focus into dialogs and restore it to the triggering button after close.
- Announce saving, deletion and loading states, and prevent duplicate submissions.
- Preserve safe-area padding above the existing mobile navigation.

## Implementation tasks

### Task 1 — Freeze the minimal contract

Document the exact broker IDs, instrument-symbol convention, native-currency rule, amount semantics, weighted-average rule and buy/sell behavior. Add TypeScript DTOs with financial values represented as strings.

Acceptance: XTB EUR ETFs, XTB USD shares, fractional units and Banca Transilvania RON instruments have unambiguous example records and expected outputs.

### Task 2 — Create the two-table migration

Create only `investment_accounts` and `investment_transactions`, with checks, ownership relationship, uniqueness and the grouping index. Regenerate `src/lib/database.types.ts`.

Acceptance: valid fractional orders insert; unsupported brokers, invalid currencies, non-positive values and orphan transactions fail.

### Task 3 — Add grants, RLS and database tests

Grant only the required operations, add owner-scoped policies and test owner, second-user and anonymous access. Test the transaction ownership policy through its account.

Acceptance: users can select, insert and delete only their own records; anonymous and cross-user operations fail.

### Task 4 — Implement and test aggregation

Create a pure server-side aggregation module using decimal arithmetic and deterministic chronological processing. Cover buys, fractional quantities, multiple buys, partial/full sells, same-time orders, mixed currencies and invalid histories.

Acceptance: position quantity, remaining cost, average cost, realized gain and native-currency subtotals match fixtures exactly.

### Task 5 — Add the mock third-party adapter

Define the adapter contract, add deterministic XTB and Banca Transilvania mock quotes, inject the adapter into the server data layer, enforce currency matching and expose the mock source to the UI.

Acceptance: duplicate symbols produce one lookup, simulated values are visibly marked as mock, unavailable prices do not break the page, and a mismatched currency never produces a valuation.

### Task 6 — Build read APIs

Implement the overview and conditional transaction-history endpoints with authentication, bounded queries, stable DTOs and private response headers.

Acceptance: the overview contains aggregates without raw histories; the detail endpoint returns only the selected owned asset's rows.

### Task 7 — Build mutation APIs

Implement account upsert plus transaction insert, and guarded hard deletion. Validate request values and chronological sale rules on the server.

Acceptance: duplicate submissions are prevented in the UI, oversells fail clearly, cross-user mutations fail, and deletion cannot invalidate a later sale.

### Task 8 — Add the page and broker sections

Add the navigation destination, page shell, loading/error/empty states, broker sections and per-currency totals using the application's existing Chakra, SWR and data-state patterns.

Acceptance: XTB and Banca Transilvania are visibly separate, and no mixed-currency total appears.

### Task 9 — Add click-to-open asset details

Build the asset selector and conditional SWR detail request. Keep all assets closed initially and show only one detail panel within a broker at a time.

Acceptance: the initial page makes no transaction-history request; one click loads only the chosen asset; closing or switching selection behaves predictably.

### Task 10 — Add investment and order management UI

Build the combined first-order dialog, add-order dialog, responsive transaction history and remove confirmation. Revalidate the overview and detail after every mutation.

Acceptance: users can add multiple instruments to either broker, add fractional buy/sell orders and permanently remove an order from desktop or phone.

### Task 11 — Finish mobile, accessibility and error handling

Verify 320 px, tablet and desktop layouts, keyboard use, focus restoration, loading announcements, mock/unavailable price states and currency clarity.

Acceptance: the complete flow works without horizontal page overflow, small targets, color-only meaning or trapped focus.

### Task 12 — Verify the complete feature

Run aggregation unit tests, Supabase RLS tests, adapter and route tests, and browser tests for XTB and Banca Transilvania. Finish with lint, typecheck and a production build.

Acceptance: a user can create the first investment at either broker, add and remove orders, inspect an asset only after clicking it, and see native-currency holdings and totals consistently on desktop and mobile.

## Delivery order

1. **Foundation:** Tasks 1–4.
2. **Read-only panel:** Tasks 5, 6, 8 and 9.
3. **Manual management:** Tasks 7 and 10.
4. **Polish and verification:** Tasks 11 and 12.

This sequence keeps every milestone reviewable while preserving the two-table database throughout.
