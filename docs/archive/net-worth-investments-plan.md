# Net worth and XTB investments: implementation plan

Prepared 7 September 2026. Planning only; no application or database changes made.

## Recommendation

Add two sections to Simple Ledger: **Net worth**, combining dated assets and liabilities, and **Investments**, tracking XTB accounts, stock/ETF holdings, cash and performance. Keep Next.js, Chakra UI, SWR and Supabase. Use XTB reports as the source for ownership, trades and cash; use Yahoo Finance as a replaceable source for market valuations.

Start with current holdings and cost basis, then add a reconciled transaction ledger. This provides useful totals early without presenting incomplete history as investment returns. Working assumption: long-only stocks/ETFs, including fractional quantities. CFD support is a separate extension pending confirmation of the user's instruments. Account currencies must be selected during setup; do not infer them from location or the app's EUR default.

## What the review established

The local checkout reviewed was `2212980`. It has Next.js 16.3.2, React 19, Chakra UI 3, SWR, Zod and Supabase. The navigation exposes Overview, Expenses and Settings. The typed schema contains expenses, categories and profiles; there are no investment accounts, holdings, quotes or dated balance records. Existing route handlers independently authenticate users and return private, non-cacheable financial responses. These patterns can be reused.

The current currency preference changes formatting and entry context; it does not perform FX conversion. Existing expenses contain amounts without an original currency or linked bank account. Consequently, historical bank balances and net worth cannot be reconstructed from the expense ledger alone. The XLSX utility generates exports; it is not a workbook importer.

I inspected Wealthfolio's source at commit [`61f8d810f525c3b95f2363b0d6932112b887df6f`](https://github.com/wealthfolio/wealthfolio/tree/61f8d810f525c3b95f2363b0d6932112b887df6f), whose package version is 3.9.0. Relevant findings:

| Reference | Useful pattern for this app |
| --- | --- |
| [Net-worth UI](https://github.com/wealthfolio/wealthfolio/blob/61f8d810f525c3b95f2363b0d6932112b887df6f/apps/frontend/src/pages/net-worth/net-worth-content.tsx) | Total, history, category breakdowns, drill-downs and stale valuation indicators. |
| [Net-worth model](https://github.com/wealthfolio/wealthfolio/blob/61f8d810f525c3b95f2363b0d6932112b887df6f/crates/core/src/portfolio/net_worth/net_worth_model.rs) | Explicit assets/liabilities, base currency and dated component values. |
| [Holdings UI](https://github.com/wealthfolio/wealthfolio/blob/61f8d810f525c3b95f2363b0d6932112b887df6f/apps/frontend/src/pages/holdings/holdings-page.tsx) | Account filtering, open/closed positions, mobile views and separate tracking modes. |
| [Import workflow](https://github.com/wealthfolio/wealthfolio/blob/61f8d810f525c3b95f2363b0d6932112b887df6f/apps/frontend/src/pages/activity/import/activity-import-page.tsx) | Upload, column mapping, instrument resolution, review and confirmation. |
| [Yahoo provider](https://github.com/wealthfolio/wealthfolio/blob/61f8d810f525c3b95f2363b0d6932112b887df6f/crates/market-data/src/provider/yahoo/mod.rs) | Isolated provider, search, prices, FX, corporate actions and rate-limit handling. |
| [Performance design notes](https://github.com/wealthfolio/wealthfolio/blob/61f8d810f525c3b95f2363b0d6932112b887df6f/docs/features/performance-semantics-design.md) | Distinguish cost-basis gains from cash-flow returns; incomplete transfer/history semantics can produce misleading returns. These are design notes, not evidence that every documented defect remains in current code. |

No dedicated XTB integration appeared in the searched `apps`, `crates` and `docs` source. This does not establish the coverage of separately operated broker-sync services. Wealthfolio's Rust services and React Router frontend are architecture references; implement the required concepts in the existing stack. The repository declares [AGPL-3.0](https://github.com/wealthfolio/wealthfolio/blob/61f8d810f525c3b95f2363b0d6932112b887df6f/LICENSE); use original implementation rather than transplanting source into this app.

## Product scope

### Net worth

- Summary: total assets, total liabilities, net worth and absolute change over the selected period.
- History: 1M, 3M, YTD, 1Y and All; offer an accessible table alongside the chart.
- Breakdown: bank/savings cash, brokerage cash, investments, property, other assets and debts. Brokerage cash is counted once, even if it also appears in an investment account's detail screen.
- Manual assets: name, category, currency, ownership share and dated valuation. Debts store positive outstanding principal and are subtracted; a property may link to its mortgage without subtracting the mortgage twice.
- Drill-down: account/item values, valuation dates, source and edit history.
- Data quality: distinguish latest market data, carried-forward manual valuations, unknown values and incomplete history. Start history at the first supported date, with gaps/partial totals where necessary.

Use dated bank-balance observations initially. Entering an expense must not automatically decrease these balances: existing expenses have no funding account, and a newer balance observation already includes spending. Connecting expenses to account cash movements is a later feature requiring explicit links and reconciliation.

Net-worth change is balance-sheet change, not investment return. A newly recorded asset can create a coverage change. Show that separately from economic growth when identifiable; suppress misleading percentage changes for zero or negative starting net worth.

### Investments

- XTB account setup: display name, currency, optional masked broker reference, reporting start date and tracking mode. Support multiple XTB currency accounts and mixed instrument currencies within an account.
- Overview: securities value, available cash, account total, remaining cost basis and unrealized gain. Add realized gain, dividend income and net contributions when transaction history supports them.
- Holdings: name, exchange, quantity, average acquisition cost, current price, currency, market value, unrealized gain and allocation weight. Preserve fractional shares.
- Instrument details: price history, quantity/cost history, trades and cash distributions. Distinguish instrument price performance from the user's investment performance.
- Activity ledger: buys, sells, deposits, withdrawals, transfers, dividends, withholding, fees, interest and FX exchanges. Model splits explicitly. Unknown event types require review.
- Actions: add/edit a manual entry, import XTB report, resolve symbols, refresh prices and inspect reconciliation differences.

First release excludes trade execution, CFD valuation, tax-return generation, options, simulations, ETF look-through and benchmark analytics. These are not required to deliver accurate net worth and stock/ETF tracking.

## XTB ingestion

XTB's [official help page](https://www.xtb.com/en/help-center/our-platforms-5/does-xtb-offer-investment-automation-tools) says API access ended on 14 March 2025. Its [reporting guide](https://intercom-help.eu/xtb/en/articles/141370-history-of-positions-and-cash-operations-web-platform-and-mobile-app) describes Excel exports of closed positions, cash operations and orders. Therefore the first integration should be file-based, with manual corrections. No XTB credentials need to be stored.

The exact current Romanian/account-specific export schema has not been verified against the user's files. Before implementing the parser, obtain an anonymized sample covering purchases, a partial sale, dividends/withholding, fees and cash movements. Check whether open-position quantities and acquisition costs require a separate report. Closed-position history alone cannot establish the current portfolio, and pending orders must never become trades.

Proposed workflow:

1. Select account and import type: current holdings or transaction history.
2. Upload Excel; detect report version, sheets, locale, account currency and covered dates. Add CSV support only for confirmed formats. Add ZIP-wrapped XLSX support if the actual export requires it.
3. Parse into staging rows, preserving source row/sheet, external IDs, original date text, timezone, quantities and original money values. Enforce upload, row and decompression limits; never execute workbook formulas or macros.
4. Normalize events. Treat trade execution records as trades and match their cash effects across sheets, so the same purchase is not booked twice. Preserve gross dividend, withholding and net credited amount with a consistency check.
5. Resolve XTB instrument codes to exchange-specific listings and Yahoo symbols. Review ambiguous matches.
6. Preview accepted rows, duplicates, unsupported rows, mapping decisions, fees, cash totals and expected position changes. Hard errors prevent committing affected data; any deliberate exclusions remain visible in the import summary.
7. Commit through a single database transaction with an idempotent batch key. Return inserted/skipped/conflicting counts and recompute affected dates.
8. Reconcile quantities and cash against XTB at the report date. Compare valuation only using aligned price/FX timestamps; Yahoo values need not equal XTB's live display.

Use unique broker event identity scoped to account/report stream when available. One order may have multiple fills, so order ID alone may not be unique. For missing IDs, compare normalized event fingerprints across overlapping imports, preserve multiplicity of identical genuine trades and require review of ambiguous duplicates. A file hash catches exact reuploads but is insufficient for overlapping reports.

Store import batch, parser version, source provenance and correction history. Provide an audited batch reversal/correction path followed by chronological recalculation. Keep normalized source rows private; retain original files only if the product needs them, with explicit retention behavior.

For a quick start, accept a dated opening snapshot containing quantities, cost basis and cash. Label missing acquisition FX/cost as unknown. Switching to full history must replace the snapshot-derived period in a reviewed migration or use a strict cutoff; never add reconstructed pre-cutoff transactions on top of the same opening positions.

If CFDs are needed, introduce a separate model for signed exposure, contract multipliers, margin, financing and broker-marked equity. Never count CFD notional exposure as net worth or value it as ordinary share quantity times Yahoo price.

## Yahoo Finance and FX

Use a server-only TypeScript provider around `yahoo-finance2`: search for instrument candidates, quote for latest data, chart for daily history and corporate-action information. The [maintainer documentation](https://github.com/gadicc/yahoo-finance2) identifies v4 as current, requires Node 22+, describes access as unofficial, and documents browser restrictions. Pin a tested release and standardize the app/deployment runtime on Node 24 LTS; the inspected shell runs Node 23.4.0, while production runtime is unverified.

Keep the provider contract small: `searchInstruments`, `getLatestQuotes`, `getDailyHistory`, `getCorporateActions` and `getFxRates`. Normalized results include listing ID, provider symbol, price, quote currency/unit, market timestamp, fetch timestamp and source. Keep provider details outside the portfolio calculation engine.

Suggested operating policy, subject to a deployment smoke test:

- Read stored prices immediately; refreshing a page should not depend on a successful Yahoo call.
- Start with refresh-on-demand, caching each listing for approximately 15 minutes. This is the app's fetch cadence, not a promise of real-time quotes.
- Fetch daily history once from the earliest supported holding date; incrementally update it and recheck a small trailing window for corrections.
- Add one protected scheduled worker for daily closes, FX and missed work. Durable jobs track progress/cursors, retries and locks; long backfills do not run inside page requests. Verify Yahoo access from the actual hosting environment before choosing the final scheduler.
- Deduplicate concurrent requests, batch supported quote calls, limit concurrency, use timeouts and exponential backoff. Preserve last-known-good values through rate limits and outages.
- Mark missing/stale quotes per instrument. A position with no usable valuation must produce an incomplete total, not silently become zero. Allow dated manual price overrides with visible provenance.

Store security identity separately from listing identity: ISIN can identify a security, but the same security may trade on multiple exchanges and in different currencies. Persist the XTB code, ISIN where available, exchange/MIC, listing currency and confirmed Yahoo mapping. Do not mechanically replace XTB suffixes. Validate share class, accumulating/distributing ETF variant and quote currency. Normalize pence (`GBp`/`GBX`) to GBP explicitly.

Every account, trade, fee, quote and valuation carries its original currency. Store FX with an explicit convention such as target-currency units per one source-currency unit. Use broker execution FX for transaction economics where provided and historical FX for historical base-currency valuations. For weekends use the last available prior rate, retaining its date; missing rates are unknown, never an assumed 1:1. Yahoo FX symbols can be the initial FX adapter, with manual rates and a replaceable provider boundary.

Set a separate reporting currency for the wealth module, initialized from the existing preference. Changing it recalculates displayed history using dated rates; it never relabels stored USD trades as EUR. A general migration of old expense currency semantics is a separate project because original currencies are not recorded.

Preserve raw vendor price data and adjustment metadata. Verify split semantics with real fixtures before multiplying historical quantities by historical quotes: some series are split-adjusted. Normalize prices and share counts to the same basis, apply corporate actions exactly once, and avoid dividend-adjusted prices when dividends are already counted in cash. Archived history remains valuable when provider coverage disappears.

## Data model and calculation rules

Use PostgreSQL `numeric`, for example `numeric(28,10)`, for quantities, money, prices and FX, with purpose-specific constraints. Use decimal arithmetic in the service layer and decimal strings in API contracts; conversion to JavaScript numbers is limited to display/chart boundaries. Round for display and broker reconciliation according to the relevant currency precision.

| Tables, staged across milestones | Purpose |
| --- | --- |
| `financial_accounts`, `wealth_settings` | Owner, type, institution, account currency, reporting currency and tracking mode. Keep distinct from the current user-profile `/api/account`. |
| `asset_valuations` | Dated manual cash, property, other-asset and debt observations linked to financial accounts; ownership share and provenance. |
| `securities`, `security_listings`, `broker_instrument_mappings` | Stable instrument identity, exchange/currency-specific listings, provider codes and confirmed XTB mappings. |
| `opening_positions`, `opening_cash_balances` | Dated source positions and cash used for initial holdings mode, with optional documented basis. |
| `investment_activities`, `activity_cash_legs` | Events and exact signed cash changes, including multi-currency FX legs and linked transfers. |
| `import_batches`, `import_rows` | Staging, parser versions, source IDs, validation, deduplication and audit trail. |
| `market_quotes`, `daily_prices`, `fx_rates`, `corporate_actions` | Provider observations independent of private ownership. |
| `account_daily_valuations` | Rebuildable historical totals, component values, quality flags and calculation version. |
| `position_lots`, `lot_disposals` | Add when transaction-based realized gains are implemented; derived from source events. |

The source of truth is manual observations/opening facts plus accepted activity records. Holdings, lots and daily aggregates are reproducible derived data. Backdated corrections invalidate results from the affected date. Currency changes invalidate corresponding reporting-currency aggregates. Derived results are published with a consistent calculation version so partially rebuilt history is not mixed with old values.

Core rules:

- Securities value = sum of quantity × compatible-basis price × quote-to-reporting FX.
- Investment account total = securities value + cash in all its currency balances.
- Net worth = bank cash + investment account totals + other owned assets − liabilities. Investment cash must not be added again separately.
- Unrealized gain = current position value − remaining acquisition basis. Unknown basis yields unavailable gain, not zero basis. Use trade-date FX for base-currency basis when available.
- Realized gain = net sale proceeds − basis of disposed lots. Propose FIFO for app analytics, display that convention, and reconcile differences with broker figures; this is not a tax-reporting claim.
- For a complete period, investment gain = ending account value − starting value − external inflows + external outflows. Dividends retained as cash are already in ending value and must not be added a second time.
- A bank-to-XTB transfer changes account locations but not consolidated net worth. Whether it is external for performance depends on the selected account/portfolio boundary.

Example fixture: deposit EUR 1,000; buy 10 shares at EUR 80 plus EUR 2 fee; mark at EUR 90. Cash is EUR 198, securities EUR 900, total EUR 1,098 and gain EUR 98 including the fee. A later EUR 500 deposit increases account value by EUR 500 and leaves investment gain unchanged.

Holdings-only mode can show valuation and gain versus known cost. It cannot establish reliable TWR/XIRR or performance before its first observation. Add time-weighted return and money-weighted return/XIRR only for scopes with complete flows and adequate valuation coverage; handle undefined/non-convergent XIRR explicitly. Defer benchmark comparisons until return definitions and currency basis are consistent.

## Integration into this repository

Continue the existing authenticated Next.js route-handler and SWR pattern. Put calculations and data access in server-only modules; the UI receives computed summaries. Relevant installed Next.js route-handler and data-fetching guides were read during this review.

Proposed files/directories:

```text
src/app/(app)/net-worth/page.tsx
src/app/(app)/investments/page.tsx
src/app/(app)/investments/import/page.tsx
src/app/(app)/investments/[accountId]/page.tsx
src/app/api/financial-accounts/...
src/app/api/net-worth/...
src/app/api/investments/...
src/app/api/imports/xtb/preview/route.ts
src/app/api/imports/[id]/commit/route.ts
src/app/api/market-data/search/route.ts
src/app/api/market-data/refresh/route.ts
src/components/net-worth/...
src/components/investments/...
src/lib/data/net-worth.ts
src/lib/data/investments.ts
src/lib/investments/{positions,cash,cost-basis,valuation,performance}.ts
src/lib/import/xtb/...
src/lib/market-data/{provider,yahoo,fx,refresh}.ts
src/lib/validation/investment.ts
supabase/migrations/...
```

Update the navigation, shared domain/database types and SWR keys. Use account/date/currency-scoped keys and invalidate both Investments and Net worth after a committed import or valuation change. Add compact mobile holdings cards; five primary navigation destinations need a narrow-screen check, with Settings moved into a menu if needed. Reuse Chakra surfaces and existing chart styling, selecting one chart implementation for the new history views during implementation.

Keep private APIs `private, no-store`. Market data may be shared across users in storage, but user portfolios, imports and account associations must remain owner-scoped. Authenticate all financial and refresh endpoints, rate-limit quote/search calls, and reject unowned account/import IDs. Do not expose a free-form provider URL proxy.

Enable RLS and explicit grants in each migration. Enforce ownership of parent account references using database constraints/policies, not only a supplied `user_id`. Shared market tables allow only intended reads and trusted ingestion writes. Manual overrides remain user-scoped. Aggregate views/functions must preserve caller authorization. These requirements follow [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security); [new-table API exposure is also changing](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), so grants must be explicit.

Ordinary user requests continue to use the authenticated client. A scheduled worker, if added, requires separate server-only credentials and a protected invocation path; the existing publishable-key configuration is not a background-job identity. Continue excluding private financial data from service-worker caching.

## Delivery order and acceptance gates

| Milestone | Deliverable | Exit criterion |
| --- | --- | --- |
| 0. Validate sources | Anonymized XTB samples, actual instruments/currencies, confirmed mappings, Yahoo deployment probe, supported runtime. | Known report coverage and a reconciliation fixture; prices/FX available for representative holdings. |
| 1. Wealth foundation | Accounts, dated manual assets/debts, reporting currency/FX, Net worth UI and basic history. | Totals match a hand-checked multicurrency balance sheet; missing values/coverage remain visible. |
| 2. Current investments | Opening holdings/cash, known cost basis, Yahoo prices, allocation and investment account roll-up. | Quantities/cash reconcile with XTB; both tabs agree and repeated refreshes do not alter ownership. |
| 3. XTB transactions | Preview/commit importer, symbol mapping, deduplication, cash ledger, lots and reconciliation. | Reimport is a no-op; overlapping reports preserve real fills; partial sales, fees, dividends and FX match fixtures. |
| 4. Historical analytics | Daily rebuilds, contribution-aware gain, valid TWR/XIRR, scheduled refresh and correction workflow. | Deposits are not profit; transfers, splits, outages and backdated corrections pass deterministic tests. |
| 5. Optional extensions | Benchmarks, dividend analytics, targets, richer categorization or separate CFD support. | Selected according to actual usage after core reconciliation is reliable. |

Milestones 1–2 are the first useful release. Complete milestone 3 before presenting transaction-derived profit as reliable. Calendar estimates should follow milestone 0: export completeness and historical instrument mapping are the largest unknowns.

Add meaningful automated tests for financial arithmetic/imports (a test runner is not currently configured), database ownership and transactional commits, and a browser journey from import to both tabs. Cover decimal fractions; equal-looking genuine fills; concurrent reimports; pending/cancelled orders; partial sales; dividend tax; FX direction; GBp normalization; splits; missing/stale quotes; snapshot-to-history transitions; internal transfers; and zero/negative performance baselines. RLS tests must use two distinct users and unauthenticated access.

At implementation time run the repository's `npm run check`, the new calculation/import tests, database tests and browser verification. Use recorded market responses for deterministic tests and one bounded live smoke check for deployment compatibility. This planning review did not run application tests or execute migrations.

Remaining inputs: the user's actual XTB instrument types and currencies, anonymized report samples, desired reporting currency, and hosting/scheduler environment. Defaults above let UI/domain work proceed; parser acceptance and price-provider reliability require those concrete checks.
