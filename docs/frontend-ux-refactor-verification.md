# Frontend UX refactor verification

Implemented against [the refactor plan](./frontend-ux-refactor-plan.md) on 2026-10-02. All ten implementation tasks are complete. Automated verification passes; the physical-device and assistive-technology checks listed below remain manual.

## Delivered behavior

| Plan tasks | Implementation |
|---|---|
| 1–3 | Shared cream/clay semantic tokens, compact Geist typography, readable monetary values, simpler headers and supporting copy, 208px desktop sidebar, Home/Expenses/More mobile navigation, skip link and safe-area spacing. |
| 4 | Compact month toolbar and metric strip; existing expense table, mobile rows, search, category filtering, ordering and actions retained. Search/category selections survive month changes. Dialogs scroll within the available viewport and retain entered values after failed requests. |
| 5–8 | URL-driven Summary, Monthly and History dashboards. Legacy analytics links open History; view-specific parameters survive tab changes and Back/Forward. Current-month summary, completed-month comparisons, daily recorded spending, category shares, ranked expenses, historical extrema and ledger drill-down use existing responses. |
| 9 | Pure analytics selectors with edge-case tests. Only the active dashboard mounts its requests; view state stays out of API keys. Changed selections hide old data while loading. Refreshes retain matching cached data and expose recovery controls. |
| 10 | Compact investment, net-worth, settings and authentication screens; matching icons and theme colors; offline status/retry; browser install action or platform guidance in More, hidden in standalone mode; offline-shell cache version 3. |

No changes were made to API routes, database/schema files, validation modules, investment/net-worth calculation modules, dependencies or operation payloads. Existing currency formatting, date helpers, authentication and financial calculations are reused. The only expense mutation change is retaining dashboard cache contents while requesting revalidation.

## Automated checks

The final source passed:

- `npm run lint`
- `npm run typecheck`
- `npm test`: 51 tests across 10 files, including 17 new frontend analytics/URL tests.
- `npm run build`: production build and all 26 routes generated successfully.
- `git diff --check`

New selector tests cover empty months, one expense, category aggregation and shares, deterministic ranking ties, zero percentage baselines, zero-spending months, extrema ties, leap years, ordinary February, year boundaries and custom day/month boundaries. URL tests cover defaults, invalid views, legacy analytics links, parameter preservation and API-key separation.

## Production browser checks

Playwright checks ran against the local standalone production server. Application-flow checks used synthetic account and financial fixtures plus intercepted API responses and writes; they do not represent live account transactions. Request examples, with synthetic authentication passwords redacted, are saved in [request-contracts.json](./frontend-ux/request-contracts.json).

The following passed without browser page errors:

- Exactly three mobile destinations; More navigation and active state; sheet focus trap; Escape dismissal and restored focus.
- Legacy History URLs, tab parameter preservation, Back/Forward, custom day/month Apply behavior, leap-month boundaries and chart-to-ledger links.
- Active-view request isolation, matching-selection loading states, empty months and suppression of unfinished-month comparisons.
- Expense search/category filters, persistence across month changes, export request/download filename, date defaults/constraints, retained form values after failed saves, creation and deletion.
- Investment creation, asset details, sell orders and order removal; net-worth creation, valuation, editing and archiving.
- Currency saving, signup confirmation, login and sign-out.
- Skip link, keyboard tab selection, accessible control names, visible chart values, 44px application touch targets, reduced motion and mobile editable text at 16px.
- Summary/Monthly/History at 320px, 390px, 768px and 1280px without document-level horizontal overflow. The daily chart intentionally scrolls horizontally.
- 200% text enlargement without document overflow; a 320 × 360 viewport simulating reduced keyboard space with scrollable forms and a reachable submit action.
- Offline banner, retained cached data during a failed refresh, retry recovery, a synthetic browser install event, and hidden install guidance in standalone display mode.

The separate offline check used the real production service worker, without API mocks. Its version-3 cache contained only `/offline`, `/icon-192.png` and `/icon-512.png`. An offline navigation to `/expenses` displayed the fallback, and reconnecting/retrying reached the real unauthenticated login guard. No private route or API response was cached by the service worker.

Verification harnesses remain temporary local artifacts under `tmp/`: `frontend-interactions.cjs`, `frontend-browser.cjs`, `frontend-accessibility.cjs` and `frontend-offline.cjs`. They use a separately installed local Playwright runtime and are not included in this PR; no test dependency was added to the application. Their screenshots and synthetic request examples are included with this report.

## Contrast

Calculated sRGB contrast ratios for the shared palette:

| Pair | Ratio |
|---|---:|
| Primary text / canvas | 13.28:1 |
| Secondary text / canvas | 5.73:1 |
| Dark clay / selected surface | 4.77:1 |
| Dark clay / white | 5.72:1 |
| White / primary action | 14.75:1 |
| Positive / white | 6.89:1 |
| Error / white | 6.67:1 |

Clay is used for decorative/chart accents; text uses the darker semantic colors. Charts expose amounts and textual labels alongside color.

## Screenshots

Artifacts use synthetic data. The baseline had one Home dashboard; its three baseline view links rendered that same screen.

| Screen | Before | After |
|---|---|---|
| Summary | [Baseline](./frontend-ux/screenshots/before-summary.png) | [Summary](./frontend-ux/screenshots/after-summary.png) |
| Monthly | [Baseline](./frontend-ux/screenshots/before-monthly.png) | [Monthly](./frontend-ux/screenshots/after-monthly.png) |
| History | [Baseline](./frontend-ux/screenshots/before-history.png) | [History](./frontend-ux/screenshots/after-history.png) |
| Expenses | [Baseline](./frontend-ux/screenshots/before-expenses.png) | [Expenses](./frontend-ux/screenshots/after-expenses.png) |
| Expense form | [Baseline](./frontend-ux/screenshots/before-expense-dialog.png) | [Form](./frontend-ux/screenshots/after-expense-dialog.png) |
| Investments | [Baseline](./frontend-ux/screenshots/before-investments.png) | [Investments](./frontend-ux/screenshots/after-investments.png) |
| Net worth | [Baseline](./frontend-ux/screenshots/before-net-worth.png) | [Net worth](./frontend-ux/screenshots/after-net-worth.png) |
| Settings | [Baseline](./frontend-ux/screenshots/before-settings.png) | [Settings](./frontend-ux/screenshots/after-settings.png) |
| Authentication | [Baseline](./frontend-ux/screenshots/before-login.png) | [Login](./frontend-ux/screenshots/after-login-browser.png) |

Additional captures: [More sheet](./frontend-ux/screenshots/after-more-sheet.png), [desktop navigation](./frontend-ux/screenshots/summary-1280.png), [320px Monthly](./frontend-ux/screenshots/monthly-320.png), [tablet History](./frontend-ux/screenshots/history-768.png), [investment form](./frontend-ux/screenshots/after-investment-dialog.png), [net-worth form](./frontend-ux/screenshots/after-net-worth-dialog.png), [200% text](./frontend-ux/screenshots/summary-200-percent.png), [short keyboard viewport](./frontend-ux/screenshots/expense-dialog-keyboard-height.png), [failed refresh](./frontend-ux/screenshots/refresh-failed.png), and [real offline fallback](./frontend-ux/screenshots/offline-production.png).

## App icon

The existing notebook/checkmark identity was edited with the built-in `image_gen` tool in opaque image-edit mode. The output was resized into [512px](../public/icon-512.png), [192px](../public/icon-192.png), [Next icon](../src/app/icon.png), [Apple icon](../src/app/apple-icon.png) and [favicon](../src/app/favicon.ico) assets. The existing [SVG icon](../public/icon.svg) was recolored to match. No image-generation API key or application dependency was used.

Exact image-edit prompt:

> Use case: precise-object-edit. Asset type: Simple Ledger PWA app icon. Edit the attached existing square app icon, keeping its recognizable white spiral-bound ledger notebook silhouette and centered checkmark, their proportions and composition. Replace the purple decorative gradient background with a completely flat warm cream #F4F3EE background. Replace purple areas of the checkmark and notebook backing with flat dark clay #A64B32 and clay #D97757. Keep the notebook white #FFFFFF with crisp clean edges and subtle border #DEDCD3. Remove glows, decorative gradients and shadows. Flat calm app icon, no text, no added objects. Full-bleed opaque square background, no rounded outer corners, notebook and checkmark inside central 70% maskable safe area. Preserve Simple Ledger identity.

## Remaining manual verification

- Install on physical iOS and Android devices and verify actual safe-area insets, native keyboard/visual-viewport behavior, browser install UI, launch icons and offline recovery.
- Exercise VoiceOver or NVDA to verify spoken chart labels, tab announcements and sheet/form navigation. Browser checks verified accessible names and keyboard behavior, but did not run a screen reader.
- Exercise authenticated operations and export contents against a chosen live/test account. Browser checks verified frontend requests and responses using fixtures, while existing API tests passed unchanged.

These are verification limits, not omitted implementation tasks. No migration or backend rollout is required.
