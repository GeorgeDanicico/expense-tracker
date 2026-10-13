# UI Styling Refactor Plan

## Summary and boundaries

Make Simple Ledger look and feel like a professional finance tool: denser layouts, smaller controls, a clear type scale, consistent surfaces, and a small library of reusable UI primitives so screens stop styling themselves inline.

This builds on the [frontend UX refactor](./frontend-ux-refactor-plan.md) (cream/clay palette, Home/Expenses/More navigation, three dashboards). It keeps that palette and information architecture and changes **how** things are drawn, not **what** is shown.

In scope:

- Theme rewrite: tokens, text styles, recipes, and sizes as the single source of styling.
- Smaller, consistent buttons, inputs, tabs, badges, tables, and dialogs.
- A `src/components/ui/` primitive library, and splitting large screen components into smaller ones.
- Migrating every screen to the primitives.
- Guardrails (lint rules plus a dev-only style gallery) so the system stays consistent.

Out of scope: API routes, database, validation, financial calculations, SWR keys, URL state, copy changes beyond labels touched by the refactor, new dependencies, and dark mode. Tokens will be structured so dark mode can be added later.

Stack stays **Chakra UI v3.36**, **Lucide**, **Geist**, and **Next 16**. Read the relevant guides in `node_modules/next/dist/docs/` before touching layouts or fonts (see `AGENTS.md`).

## Current state: why the UI feels heavy

Findings from `src/components/ui/theme.ts`, `src/app/globals.css`, and the 54 component files:

| Problem | Evidence | Effect |
|---|---|---|
| Every control is forced to 44px | `minH: "2.75rem"` in the button/input/select recipes **and** `.chakra-button { min-height: 44px }` in `globals.css`; `minH="11"` repeated 25× in components | `size="sm"` (36px) and `size="xs"` (32px) are silently overridden, so every button renders at "large" size |
| Styling lives in components, not the theme | 94× `borderRadius="xl"`, 58× `fontWeight="600"`, 27× `letterSpacing`, 99× `fontSize="xs\|sm"` | Inconsistent rhythm, and any adjustment means editing dozens of files |
| Global `!important` overrides | `h1`, `h2`, `h3` sizes and weights forced in `globals.css` | `Heading size` cannot be used, and the theme cannot control titles |
| Palette hijacking | `purple` is remapped to near-black (`colorPalette="purple"` used 24× to mean "primary") | Misleading code; Chakra's default `purple` badges render clay-tinted |
| Raw colours in components | Hex values in `app-shell`, `auth-form`, `expense-list`, `offline/page`; `orange.700`, `red.50`, `blue.700`, etc. scattered | Colour isn't themeable, and status/category colours drift |
| Duplicated dialog boilerplate | 11 files build `Dialog.Root → Backdrop → Positioner → Content → CloseTrigger` by hand, with 10 redundant `Backdrop bg` overrides | Inconsistent padding, close buttons, footers, and mobile behaviour |
| Two metric components | `StatCard` and `MetricStrip` both render label + 24px value | Large numbers everywhere, and no hierarchy between hero and secondary metrics |
| Oversized files | `net-worth-panel` (308 lines), `add-net-worth-item-dialog` (267), `add-expense-dialog` (241), `expense-tab-dialog` (240), `monthly-dashboard` (223), `add-investment-dialog` (220), `expense-list` (215), `app-navigation` (215) | Hard to restyle consistently; presentation and state are mixed |
| Icon sizes vary | Lucide `size` uses 14, 15, 16, 17, 18, 20, 21, 22, 25 | Visual noise; icons misalign with text |
| Full-width primary buttons in forms | `Save expense` and others stretch across the dialog | Reads as a mobile prototype on desktop |

## Design direction

Reference points: Linear, Stripe Dashboard, and Mercury. Quiet surfaces, hairline borders, small, confident controls, and numbers as the visual focus.

Principles:

1. **Density with breathing room.** Use smaller controls and type, and spacing that follows a strict 4px grid.
2. **Hierarchy through weight and size, not boxes.** Use fewer bordered cards and more section headers and dividers.
3. **One primary action per view.** Every other action is secondary (outline) or tertiary (ghost).
4. **Numbers are the content.** Amounts use tabular numerals, are right-aligned in tables, and only the headline figure on a screen is large.
5. **The theme owns style.** Components choose a variant and size; they never set radius, font weight, or colour literals.

## Target design tokens

### Sizing scale (controls)

| Size | Height | Font | Padding X | Icon | Use |
|---|---|---|---|---|---|
| `xs` | 28px | 12px | 8px | 14px | Table row actions, inline filters, chips |
| `sm` (**default**) | 32px | 13px | 12px | 16px | Most buttons, inputs, selects, tabs |
| `md` | 36px | 14px | 14px | 16px | Primary page action, auth form, mobile dialog submit |

Remove `lg`/`xl` from use. The previous rule ("every target ≥ 44 × 44px") is replaced with:

- **Fine pointer (desktop):** visual size equals hit area. 28–32px exceeds WCAG 2.2 AA target size (24 × 24).
- **Coarse pointer (touch):** keep the smaller visual size but expand the hit area to 40px with a transparent `::before` (`@media (pointer: coarse)`) in the button/icon-button recipe base. Bottom navigation and the More sheet keep 44px+ targets.
- Inputs, selects, and textareas stay at **16px font on mobile** to prevent iOS focus zoom. Only their height shrinks.

### Typography (text styles)

Define Chakra `textStyles` and stop setting `fontSize`/`fontWeight` ad hoc:

| Text style | Size / line-height | Weight | Use |
|---|---|---|---|
| `pageTitle` | 20/28 (mobile 18/26) | 600 | `<h1>` in `PageHeader` |
| `sectionTitle` | 14/20 | 600 | Card and section headings |
| `body` | 14/20 | 400 | Default text |
| `bodySm` | 13/18 | 400 | Tables, lists, dialogs, sidebar |
| `label` | 12/16 | 500 | Field labels, metric labels, column headers (sentence case, no tracking) |
| `caption` | 12/16 | 400, `fg.muted` | Helper text, timestamps, meta lines |
| `amountHero` | 28/34 (mobile 24/30) | 600, tracking −0.02em | One headline figure per screen (month total, net worth, portfolio value) |
| `amount` | 16/22 | 600 | Secondary metrics |
| `amountSm` | 13/18 | 500 | Table cells and list rows |

All `amount*` styles set `font-variant-numeric: tabular-nums`. Remove uppercase column headers with `letterSpacing="0.06em"` and use `label` in sentence case.

### Colour tokens

Keep the existing palette and restructure it as semantic tokens:

- `bg.canvas`, `bg.surface`, `bg.subtle` (hover/zebra `#F9F8F5`), `bg.selected`
- `fg.default`, `fg.muted`, `fg.subtle` (placeholder `#8C8981`), `fg.accent`
- `border.default` (`#E6E4DC`, slightly lighter than now), `border.strong` (`#D3D0C6`, inputs)
- `status.positive|negative|warning|info` with `.fg`, `.bg`, `.border`. This adds a proper **warning** token to replace `orange.700`.
- `category.<key>.fg|bg` for the 11 expense categories, moved out of `category-visual.tsx`.
- A real `brand` colour palette (`solid`, `contrast`, `fg`, `subtle`, `muted`, `emphasized`, `focusRing`) for primary actions. **Stop overriding `purple`, `red`, and `green`**; use `colorPalette="brand"` / `"danger"`.

### Shape, elevation, spacing

- Radii: `control` 6px (buttons, inputs, tabs), `card` 10px, `dialog` 12px, `badge` 4px; `full` only for avatars and status dots.
- Shadows: `xs` = `0 1px 2px rgb(41 40 36 / 5%)` on cards; `overlay` = the current dialog shadow. No other shadows.
- Spacing: card padding 16px (`4`), dense cards 12px (`3`); page section gap 16px mobile and 20px desktop; form field gap 12px; dialog padding 20px desktop and 16px mobile.
- Icons: 14px (`xs` controls, inline meta), 16px (default), 18px (navigation). Stroke 1.75 everywhere.

## Tasks

### Task 1 — Rebuild the theme as the single source of styling

- [x] Split `src/components/ui/theme.ts` into `src/components/ui/theme/`: `tokens.ts`, `semantic-tokens.ts`, `text-styles.ts`, `recipes/*.ts`, `slot-recipes/*.ts`, `index.ts` (exports `ledgerSystem`, keeping the import path working for `provider.tsx` and `month-toolbar.test.tsx`).
- [x] Implement the colour, typography, radius, shadow, and sizing tokens above.
- [x] Override recipes: `button` (variants `solid`, `outline`, `ghost`, `subtle`, `danger`; sizes `xs`/`sm`/`md`; default `sm`, `outline`), `input`, `textarea`, `nativeSelect`, `field`, `tabs` (`line` and `subtle` variants at 32px), `segmentGroup`, `badge`, `table`, `card`, `dialog`, `alert`, `stat`.
- [x] Remove all `minH: "2.75rem"` / `minW` from recipes and add the coarse-pointer hit-area expansion to the button base.
- [x] Strip `globals.css` to resets, font smoothing, skip link, `sr-only`, the mobile 16px input rule, and reduced motion. **Delete every `!important` heading/size rule** and the `.chakra-button` min-size rules.
- [x] Use `Geist_Mono` (already loaded) only where needed. Amounts stay in Geist Sans with tabular numerals.

**Acceptance:** `size="xs|sm|md"` renders 28/32/36px on desktop; the `<h1>` size comes from `textStyle`; `globals.css` has no `!important` outside reduced motion; the existing tests pass.

### Task 2 — Build the UI primitive library

Create small, typed wrappers in `src/components/ui/` (one component, or one compound component, per file; each under about 120 lines):

| Primitive | Replaces | Notes |
|---|---|---|
| `Card`, `Card.Header`, `Card.Body`, `Card.Footer` | `Surface` + ad-hoc `Box p="4"` headers | Header slot = title + optional actions; variants `outline` (default) and `subtle` (no border, `bg.subtle`) |
| `PageHeader` | current `PageHeader` | Title, optional `description`, `actions` slot; actions collapse into a row under the title on mobile |
| `SectionHeader` | inline `Heading as="h2"` + flex rows | Title, optional meta text, actions |
| `IconButton` | `Button` + `aria-label` + icon | Required `aria-label`, sizes `xs`/`sm`, optional tooltip on desktop |
| `AppDialog` | hand-built dialog trees in 11 files | `title`, `description`, `trigger`, `footer`, `size`; owns backdrop, positioner (bottom sheet on mobile, centred on desktop), close button, scrolling body |
| `ConfirmDialog` | `delete-expense-button`, `remove-order-dialog`, archive flows | Tone `danger`; "Cancel" + destructive action; inline error |
| `FormField` | `Field.Root` + label + `(optional)` + `ErrorText` | Props `label`, `optional`, `error`, `hint` |
| `FormActions` | full-width submit buttons | Right-aligned `Cancel` (ghost) + submit (solid) on desktop; equal-width pair on mobile |
| `Stat`, `StatGroup` | `StatCard`, `MetricStrip` | Sizes `hero` / `md` / `sm`; optional delta via `ValueWithChange` |
| `Amount` | scattered `formatCurrency` + `Text fontWeight="600"` | `value`, `currency`, `size`, `tone` (`auto` colours signed values) |
| `DataTable` styling | per-cell `py`/`fontSize`/`letterSpacing` props | Lives in the table recipe: 40px rows, `label` headers, `bg.subtle` hover, numeric column alignment helper |
| `ListRow` | mobile expense/transaction rows | Leading icon, title, meta, trailing amount/actions |
| `EmptyState` | three local empty states | Icon, title, description, optional action; uses Chakra `EmptyState` |
| `InlineAlert` | 34 `Alert.Root` usages | Compact 13px alert with status tones |
| `StatusBadge` / `CategoryBadge` | `Badge` + per-call `borderRadius`/`px`/`py` | Tones map to `status.*` / `category.*` tokens |
| `SegmentedControl` | dashboard view tabs, stats-filter presets | Chakra `SegmentGroup`, 28/32px |
| `Toolbar` | month toolbar, list filters row | Consistent gap/wrap behaviour for filter rows |

- [x] Export from `src/components/ui/index.ts`.
- [x] Add `src/app/dev/ui/page.tsx`, a style gallery that renders every primitive, size, and tone. It returns `notFound()` when `NODE_ENV === "production"`. (Placed outside the `(app)` group so it renders without signing in.)
- [x] Add `src/app/dev/preview/[screen]/page.tsx` (also development-only): renders Home, Expenses, Investments, Net worth, and Settings inside the app shell with fixture data, so screens can be reviewed without a Supabase session.

**Acceptance:** Every primitive renders in the gallery; none of them takes raw colour, radius, or font-weight props.

### Task 3 — App shell and navigation

- [x] Split `app-navigation.tsx` into `sidebar-nav.tsx`, `mobile-tab-bar.tsx`, `more-sheet.tsx`, and a shared `nav-items.ts`.
- [x] Sidebar: width 208 → **220px**, nav items 44 → **32px** tall, `bodySm` labels, 16px icons, active state = `bg.selected` + `fg.default` text with a 2px clay indicator. The account block becomes one compact row (avatar initial + email truncated + sign-out `IconButton` with tooltip).
- [x] Mobile header: 56 → **48px** (plus safe area), brand at 14px semibold. The page title appears in the header only when scrolled past `PageHeader` (optional, later).
- [x] Mobile tab bar: 56 → **52px** items, 18px icons, 11px labels; active = accent colour without a filled pill.
- [x] More sheet uses `AppDialog` (bottom placement) and the same `NavItem` rows.
- [x] Replace the hex colour in `Brand` with a token.
- [x] Main container: max width 1200px stays; padding 16px mobile and 24px desktop; top padding 20px desktop.

**Acceptance:** Navigation looks identical in structure but lighter; `aria-current`, the skip link, focus trap, and safe areas behave as before.

### Task 4 — Expenses screen

- [x] Split `expense-list.tsx` into `expense-filters.tsx`, `expense-table.tsx`, `expense-mobile-list.tsx`; use `EmptyState`.
- [x] Split `add-expense-dialog.tsx` into `expense-form.tsx` + `add-expense-dialog.tsx` (uses `AppDialog`, `FormField`, `FormActions`).
- [x] `PageHeader`: `Add expense` = `solid size="sm"` (`md` on mobile), `Export` = `ghost` with icon.
- [x] Expense tabs: `line` tabs at 32px height and 13px; `New tab` = `IconButton xs` + label on desktop.
- [x] Month toolbar: a single 32px row: `‹ October 2026 ›` button group + compact month input + `Go` as `xs`. On mobile it stays one row by hiding the label visually (keep `aria-label`).
- [x] Metrics: `StatGroup` with **Total as `hero`**, Transactions and Average as `sm`, inside one `Card` (no extra border rows).
- [x] Table: 40px rows, sentence-case `label` headers, `CategoryBadge` in subtle tone, `Amount size="sm"` right-aligned, delete as `IconButton xs ghost` shown at reduced opacity until row hover/focus (always visible on touch).
- [x] Filters row: search input `sm` with `fg.subtle` icon token (no hex), category select `sm`, result count as `caption`.
- [x] Apply the same treatment to `custom-expense-tab.tsx`, `expense-tab-filters.tsx`, and `expense-tab-dialog.tsx` (split filters form out of the dialog).

**Acceptance:** About 30% more rows are visible above the fold on a 390 × 844 viewport and on 1280 × 800, compared with the baseline screenshots.

### Task 5 — Home dashboards

- [x] View switcher (Summary/Monthly/History) becomes a `SegmentedControl` aligned with the page title on desktop, full-width under it on mobile.
- [x] `summary-dashboard`: one `hero` stat (month total) + three `sm` stats; trend and leading-category cards use `Card` with `SectionHeader`; footer links become a `ghost xs` link group in the card headers ("View all →").
- [x] `monthly-dashboard` (223 lines): extract `MonthlyStats`, `TopExpenses`, `MonthComparison` sections.
- [x] `history-dashboard` + `stats-filter`: presets as `SegmentedControl`, custom range in a compact `Toolbar`; `Apply` = `xs solid`.
- [x] Charts (`monthly-bar-chart`, `daily-spending-chart`, `category-breakdown`): 6px bar thickness, `border.default` tracks, `caption` axis/labels, values as `amountSm`; colours from tokens only.
- [x] Remove `stat-card.tsx` and `metric-strip.tsx` after migration.

**Acceptance:** Each dashboard has exactly one hero figure; no card is taller than its content; tabs and filters stay usable at 320px.

### Task 6 — Investments and Net worth

- [x] `net-worth-panel` (308 lines): split into `net-worth-summary.tsx`, `net-worth-group.tsx`, `net-worth-entry-row.tsx`; headline uses `amountHero`; status badge uses `StatusBadge` (`warning` tone replaces `orange.700`).
- [x] Net-worth dialogs (`add-net-worth-item`, `edit-net-worth-item`, `add-net-worth-valuation`): migrate to `AppDialog` / `FormField` / `FormActions`; extract shared `net-worth-item-fields.tsx` used by add and edit.
- [x] `investments-panel`, `broker-section`, `asset-detail`, `asset-selector`, `transaction-list`: `Card` + `SectionHeader`; asset rows as `ListRow` on mobile; transaction table uses the table recipe; gains/losses via `Amount tone="auto"` / `ValueWithChange`.
- [x] `add-investment-dialog`, `add-order-dialog`: `AppDialog` + shared fields; `remove-order-dialog` → `ConfirmDialog`.

**Acceptance:** Positive/negative/warning colours come only from `status.*` tokens; all forms share identical label, spacing, and action layouts.

### Task 7 — Settings, auth, offline, PWA

- [x] Settings: grouped `Card`s with `SectionHeader` + description, form rows label-left/control-right on desktop.
- [x] Auth form: 360px centred card, `md` controls, logo mark from token colour; preserve the login/signup/confirmation flows.
- [x] Offline page, `offline-status`, `install-instructions`: `InlineAlert` / `EmptyState`; remove the hex colour.
- [x] `data-state.tsx`: `DataLoading` uses a `Skeleton` that matches the target layout instead of a centred spinner; `DataError` uses `EmptyState` + `sm` retry button; `DataRefresh` becomes an inline `caption` + `xs` button.
- [x] Bump the offline-shell cache version because the shell appearance changes.

### Task 8 — Guardrails and cleanup

- [ ] ESLint `no-restricted-syntax` rules for files outside `src/components/ui/`:
  - JSX attributes `color`/`bg`/`borderColor` with hex string literals.
  - `colorPalette="purple"` (and any palette not in the theme).
  - `borderRadius` on `Button`, `Input`, `NativeSelect.Field`, `Textarea`, `Dialog.Content`.
  - `minH="11"` / `minH="14"` on controls.
- [ ] Remove `Surface` once all usages migrate (or alias it to `Card` temporarily).
- [ ] Add an icon size constant (`ICON = { xs: 14, sm: 16, nav: 18 }`) and replace numeric Lucide sizes.
- [ ] Check that no component file outside `ui/` exceeds about 200 lines; record exceptions with a reason.
- [ ] Update `README.md` with a short "UI conventions" section linking the gallery.

**Acceptance:** `npm run lint` enforces the rules; `rg '#[0-9A-Fa-f]{6}' src/components src/app --glob '!**/theme/**'` returns only `manifest.ts`/`layout.tsx` metadata.

## Delivery order

Ship as small PRs so each one is reviewable with before/after screenshots:

1. **Theme foundation** (Task 1). Expect a visible shrink everywhere; fix any layout breakage only.
2. **Primitives + gallery** (Task 2). No screen changes yet.
3. **Shell & navigation** (Task 3).
4. **Expenses** (Task 4).
5. **Dashboards** (Task 5).
6. **Investments & Net worth** (Task 6).
7. **Settings, auth, offline, data states** (Task 7).
8. **Guardrails & cleanup** (Task 8). Lint rules land last so earlier PRs don't fail on untouched files; alternatively, add them as warnings in PR 2 and promote them to errors here.

PR 1 can be merged on its own and already delivers the "smaller buttons" improvement, because removing the forced 44px minimum makes the existing `size="sm"` usages take effect.

## Validation

- [ ] Before/after screenshots in `docs/ui-styling/screenshots/` for: Summary, Monthly, History, Expenses (main + custom tab), add-expense dialog, delete confirm, Investments, asset detail, Net worth, net-worth dialog, Settings, login, More sheet, offline. Capture at 320, 390, 768, and 1280px.
- [ ] Keyboard pass: tab order, visible focus ring on every control, dialog focus trap and restore, Escape closes sheets.
- [ ] Touch pass on iOS Safari and Android Chrome (installed PWA): hit areas ≥ 40px on coarse pointers, no input zoom, safe areas, keyboard doesn't hide dialog actions.
- [ ] Contrast: `fg.muted` and `fg.subtle` on `bg.surface`/`bg.canvas` ≥ 4.5:1 for text (≥ 3:1 for placeholder/icons); status tones ≥ 4.5:1.
- [ ] 200% zoom and 320px width: no horizontal page scroll; amounts never truncate.
- [ ] Reduced motion respected.
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` pass after every PR.
- [ ] Confirm no changes under `src/app/api/`, `src/lib/` (except new UI constants if any), `supabase/`, or validation modules.
