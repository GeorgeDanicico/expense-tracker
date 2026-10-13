# UI styling refactor — screenshots

Captured with the in-app browser. Authenticated screens were rendered through the
development-only fixture preview (`/dev/preview/<screen>`), so the data is sample
data, not a real ledger. `before-*` images come from `main` (the preview route was
copied into a throwaway checkout of `main`); `after-*` images come from this branch.
Login and offline are the real routes.

| Screen | Before | After |
|---|---|---|
| Summary | 1280, 390 | 1280, 768, 390, 320 |
| Monthly | — | 1280 |
| History | — | 1280 |
| Expenses (main) | 1280, 390 | 1280, 768, 390, 320 |
| Expenses (custom tab) | — | 1280 |
| Add expense dialog | — | 1280 |
| Delete confirmation | — | 1280 |
| Investments | 1280 | 1280, 390 |
| Asset detail | — | 1280 |
| Net worth | 1280 | 1280, 390 |
| Net-worth edit dialog | — | 1280 |
| Settings | 1280 | 1280 |
| Login | 1280, 375 | 1280, 390 |
| More sheet | 390 | 390 |
| Offline | 1280 | 1280 |

Rows of expenses fully visible above the fold (fixture data):

| Viewport | Before | After |
|---|---|---|
| 1280 × 800 | 4 | 9 |
| 390 × 844 (above the tab bar) | 0 | 3 |

Not captured: the full 320/768 matrix for every screen (only Summary and Expenses),
and screenshots from real devices.
