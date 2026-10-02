# Frontend UX Refactor Plan

## Summary and boundaries

Create a calmer, more compact frontend with Claude-inspired colors, smaller typography, simpler navigation, and three focused expense dashboards.

Confirmed decisions:

- Mobile navigation: **Home, Expenses, More**.
- Home dashboards: **Summary, Monthly, History**.
- Analytics use existing API responses.
- Preserve database tables, UI table structure, filters, row ordering, and actions. Shared table colors and typography may change.
- Preserve operation payloads, validation, defaults, calculations, authentication, exports, and investment/net-worth behavior.

Use the existing Chakra UI, Lucide, Geist, and SWR stack. No backend changes, database migrations, new chart library, budgets, forecasting, or offline transaction storage.

## Tasks

### Task 1 — Define the shared visual system

- [ ] Replace the default Chakra system with shared semantic tokens for colors, typography, surfaces, borders, controls, and focus states.
- [ ] Use this Claude-inspired palette. Clay and cream reference the [published Claude palette](https://prefetch.io/brands/claude/); supporting colors are application choices.

| Role | Color | Use |
|---|---|---|
| Canvas | `#F4F3EE` | Application background |
| Surface | `#FFFFFF` | Forms, dialogs, cards |
| Primary text | `#292824` | Content and amounts |
| Secondary text | `#625F58` | Necessary supporting information |
| Border | `#DEDCD3` | Quiet separators |
| Clay | `#D97757` | Chart accents and brand details |
| Dark clay | `#A64B32` | Links, selected labels, focus outline |
| Selected surface | `#F5E8E1` | Active navigation |
| Primary action | `#292824` | Buttons with white text |
| Positive / error | `#37634A` / `#A33732` | Explicit status feedback |

- [ ] Keep Geist Sans. Use rem equivalents of 14px body text, 13px labels, 12px secondary text, 22px mobile/26px desktop page titles, 16px section titles, and 24px key amounts.
- [ ] Keep editable input text at 16px on mobile to avoid focus zoom.
- [ ] Use 400/500/600 font weights; tabular numerals for monetary values.
- [ ] Use 8px control radii, 12px card/dialog radii, 16px mobile page padding, and 24px desktop padding.
- [ ] Remove decorative gradients, glowing accents, blurred backgrounds, oversized icon tiles, and shadows on ordinary cards. Retain a subtle overlay shadow.
- [ ] Keep interactive targets at least 44 × 44px.

**Acceptance:** Shared styling is consistent, smaller, readable, and meets contrast requirements without shrinking touch targets.

### Task 2 — Simplify navigation and the application shell

- [ ] Replace the five mobile destinations with **Home**, **Expenses**, and **More**.
- [ ] Home continues to use `/dashboard`; Expenses continues to use `/expenses`.
- [ ] More opens an accessible sheet containing Investments, Net worth, Settings, account email, and Sign out.
- [ ] Highlight More when visiting Investments, Net worth, or Settings. Close the sheet after navigation.
- [ ] On desktop, use a compact 208px sidebar: Home and Expenses first; Investments and Net worth below a separator; Settings and account actions at the bottom.
- [ ] Remove the “WORKSPACE” heading, brand tagline, decorative avatar card, and redundant mobile sign-out control.
- [ ] Use a compact mobile header showing Simple Ledger.
- [ ] Add a skip-to-content link and retain `aria-current`.
- [ ] Respect top/bottom safe areas and reserve enough content space for fixed navigation.
- [ ] Preserve existing URLs and direct links.

**Acceptance:** Mobile shows exactly three primary destinations; all existing sections remain reachable within two taps.

### Task 3 — Remove repetitive copy and visual clutter

- [ ] Use straightforward titles: Home, Expenses, Investments, Net worth, Settings.
- [ ] Remove uppercase eyebrow labels and generic subtitles such as “Track patterns, understand spending…” and “Newest transactions appear first.”
- [ ] Remove helper text that repeats its label, date selector, or value.
- [ ] Remove empty “No note” placeholders and their reserved vertical space; preserve actual notes.
- [ ] Replace nested grey metric boxes with plain label/value groups where possible.
- [ ] Retain field labels, validation messages, currency units, period boundaries, quote freshness, valuation warnings, and the currency-label-only explanation.
- [ ] Apply the same treatment to loading, empty, error, and offline states.

**Acceptance:** Supporting text explains a meaningful fact or next action; repetitive grey subtitles are removed.

### Task 4 — Improve Expenses and dialog presentation

- [ ] Combine the selected month, previous/next controls, month picker, and existing Go action into one compact toolbar.
- [ ] Keep Add expense prominent and Export secondary.
- [ ] Replace three large summary cards with a compact total/count/average strip.
- [ ] Preserve expense search, category filtering, desktop columns, mobile rows, notes, ordering, and deletion behavior.
- [ ] Standardize dialog labels, spacing, buttons, close controls, and error presentation across expense, investment, and net-worth forms.
- [ ] Keep existing field order, required fields, defaults, date constraints, payloads, and submit handlers.
- [ ] On mobile, make dialog content scroll within available viewport height; ensure keyboard access to fields and submit buttons.
- [ ] Preserve focus trapping and restore focus to the opener on close.

**Acceptance:** Existing operations behave identically, with less surrounding chrome and usable forms on small screens.

### Task 5 — Introduce the three Home dashboards

- [ ] Add local **Summary**, **Monthly**, and **History** tabs below the Home title.
- [ ] Store the selected view in `view=summary|monthly|history`; missing or invalid values default to Summary.
- [ ] Store the Monthly selection in `month=YYYY-MM`; default to the current month.
- [ ] Retain existing History parameters: `period`, `granularity`, and `date`.
- [ ] An existing link with analytics parameters but no `view` opens History.
- [ ] Preserve view-specific parameters when switching tabs and support browser Back/Forward.
- [ ] Mount only the active dashboard’s data requests.
- [ ] Keep all three tabs visible at 320px width.

**Acceptance:** Each view answers a distinct spending question without adding primary navigation destinations.

### Task 6 — Build the Summary dashboard

- [ ] Replace the gradient hero with a compact current-month heading and the existing Add expense dialog.
- [ ] Show current-month total, transaction count, average expense, and largest expense using existing dashboard fields.
- [ ] Show a compact trend for the previous three completed months.
- [ ] Add a factual comparison between the latest two completed months: amount difference and percentage change.
- [ ] Show the leading category and its share of spending over the three completed months.
- [ ] Retain the five recent current-month expenses through the existing compact list.
- [ ] Provide “View expenses,” “Explore this month,” and “View history” links.

**Acceptance:** The opening dashboard quickly communicates current spending, recent activity, and historical direction.

### Task 7 — Build the Monthly dashboard

- [ ] Fetch the selected month using the existing monthly expenses API.
- [ ] Derive total, count, average, largest expense, and category totals locally.
- [ ] Add a daily spending chart, filling calendar days without records with zero.
- [ ] Add category amount/share bars and top-three-category concentration.
- [ ] Add the five largest recorded expenses as a simple ranked list.
- [ ] Fetch the preceding month only for this view and show total and category differences.
- [ ] Show comparisons only when both months are completed; otherwise display “Comparison available after this month ends.”
- [ ] Link to `/expenses?month=…` for the selected month.
- [ ] Reuse the existing Add expense dialog with the selected month and its current defaults.

**Acceptance:** Users can identify expensive days, dominant categories, and the transactions contributing most to a month’s total.

### Task 8 — Improve the History dashboard

- [ ] Keep the existing 3-month, 6-month, 1-year, 2-year, and custom month/day options, including the Apply action.
- [ ] Label preset ranges as previous **completed** months and show their date boundaries.
- [ ] Retain total, transaction count, average, category breakdown, and monthly trend.
- [ ] Add highest/lowest spending months and adjacent-month changes from the existing series.
- [ ] Include zero-spending months in averages and extrema.
- [ ] Show category percentage shares alongside amounts.
- [ ] Hide multi-month comparisons for a custom day or single month; label single-day averages as average expense rather than monthly average.
- [ ] Make month chart entries link to the corresponding monthly expense ledger.

**Acceptance:** Historical views provide useful comparisons while clearly explaining which dates they cover.

### Task 9 — Implement frontend analytics and reliable states

- [ ] Add pure frontend selectors for daily totals, category shares, ranked expenses, extrema, and comparisons.
- [ ] Use recorded expenses only. Treat zero records as “No recorded expenses,” without inferring missing financial activity.
- [ ] For a zero comparison baseline, show the absolute difference and “No percentage baseline”; never show Infinity.
- [ ] Use existing currency/date formatting and calendar helpers.
- [ ] Keep financial values fully readable; avoid truncating primary amounts.
- [ ] Use existing SWR keys and deduplication. Dashboard view parameters must not enter API request keys.
- [ ] On month/period changes, do not show retained data under the new selection’s label; show a loading state until matching data arrives.
- [ ] Keep unchanged-selection data visible during refresh, with an updating or refresh-failed indicator.
- [ ] Reuse existing expense cache updates and dashboard invalidation.

**Interface impact:** New view state and internal derived analytics types only. Existing API responses and operation contracts remain unchanged.

### Task 10 — Finish the remaining screens and PWA experience

- [ ] Apply shared tokens and compact headers to Investments, Net worth, Settings, authentication, and recovery screens.
- [ ] Replace the authentication marketing panel with a centered form; preserve login/signup behavior and confirmation messages.
- [ ] Preserve investment/native-currency groupings, valuation details, warnings, and operation controls.
- [ ] Update manifest, viewport theme color, and icon backgrounds to match the palette; retain the Simple Ledger identity.
- [ ] Provide an unobtrusive offline status and recovery action. Preserve entered form values when requests fail.
- [ ] Keep the existing offline fallback and private-data caching policy.
- [ ] Refresh the offline-shell cache version when its appearance changes.
- [ ] Provide install instructions within More only when running in a browser: supported browser install action when available, or platform-specific guidance. Hide them in installed standalone mode.

**Acceptance:** Browser and installed PWA experiences share the same visual system and remain usable with safe areas, keyboards, and connectivity interruptions.

## Validation and completion

- [ ] Test derived analytics with empty months, one expense, zero baselines, ties, leap years, year boundaries, and category totals.
- [ ] Verify URL defaults, existing analytics links, custom day/month filters, tab switching, Back/Forward, and monthly drill-down.
- [ ] Check 320px, 390px, tablet, and desktop layouts; 200% zoom; keyboard navigation; screen-reader labels; reduced motion; and contrast.
- [ ] Give charts visible values and accessible textual equivalents. Do not depend on color or hover alone.
- [ ] Verify installed iOS/Android safe areas, keyboard behavior, More-sheet focus, offline fallback, and recovery.
- [ ] Exercise existing expense creation/deletion/export, investment operations, net-worth operations, currency saving, and authentication.
- [ ] Confirm no table structure, database schema, API contract, validation rule, or financial calculation changed.
- [ ] Run lint, typecheck, existing tests, and the production build during implementation.
- [ ] Record before/after screenshots of all dashboards, navigation, and representative forms.

Implement tasks in order, with frontend analytics tests alongside Tasks 6–9. Read the relevant installed Next.js guides before code changes. Completion requires all tasks and acceptance checks above; there is no data migration or backend rollout.
