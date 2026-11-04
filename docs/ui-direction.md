# UI direction (phase 17, U3)

How every phase 17 screen should look and behave. George signed it off on 4 November 2026 (see
"Decisions" at the end); U4 built the theme and primitives from it.
It follows [ui-plan.md](ui-plan.md) ("How the app becomes mobile first", "The look") and the
screen audit ([ui-audit.md](ui-audit.md)). The signed-off HTML mockup (iFam Mobile Mockups, 4
November) was the starting point. This page and the mockups below record what changed from it and
what it didn't cover.

**See it:** `npm run dev`, then `/dev/preview/mockups` (an index with every tap count) and
`/dev/ui#motion`. Each mockup is phone first and responsive at 1280 px. Each has a caption with its
tap counts against the plan's targets and a "Reduced motion" switch. They use fixtures only: nothing
calls the API or saves anything.

| Mockup | URL (`/dev/preview/mockups/…`) | Screenshots (`docs/ui-styling/screenshots/`) |
| --- | --- | --- |
| Home | `home` | `u3-home-390.jpg`, `u3-home-1280.jpg` |
| Quick add: Expense, To-do, Reminder, Event | `quick-add-expense`, `quick-add-todo`, `quick-add-reminder`, `quick-add-event` | `u3-quick-add-<kind>-390/1280.jpg` |
| Money: Expenses | `money-expenses` | `u3-money-expenses-390/1280.jpg` |
| Planning: Reminders, To-dos | `planning-reminders`, `planning-todos` | `u3-planning-<page>-390/1280.jpg` |
| More | `more` | `u3-more-390/1280.jpg` |
| Settings: Account, Notifications, Family | `settings-account`, `settings-notifications`, `settings-family` | `u3-settings-<page>-390/1280.jpg` |

## Principles

- **Density.** A phone screen holds one task. Rows are at least 56 px tall with a 40 px icon tile.
  Lists have no lines between rows: space and soft surfaces separate things. Desktop shows more at
  once (two columns, 48 px rows) but keeps the same pieces.
- **Hierarchy.** Each screen has a title, then the one number or list that matters, then the rest.
  The month's total is the only hero number (28 px). Group labels are small uppercase
  captions, and section links ("Insights", "All reminders") are clay text, not buttons.
- **One primary action per screen.** The **+** (or **Add** / `N` on desktop) is the primary action
  everywhere. Screens add no Add button of their own. A sheet's main button is the one solid button
  in its action bar. Inside a page, at most one solid button (Family: Invite).
- **Progressive disclosure.** What most entries need is shown; the rest sits behind "More details" /
  "More options" (notes, subtype, tab, notify, location, repeat). Rare actions go behind `⋯` (import,
  export, manage tabs) or a filter chip. Done reminders fold under "Done · N".
- **Sheet or page.** A **sheet** is for something you finish in under a minute and return from: quick
  add, snooze choices, a row's edit form, a confirm. A **page** is for something you browse or come
  back to: a section, a settings page, import review. On desktop a sheet is a centred dialog.
- **Row actions.** On a phone, swipe right for the main action (Done), left for the other (Snooze,
  or Delete on expenses and to-dos). `⋯` (and long-press, U4) holds the same actions for anyone who
  doesn't swipe. On desktop, the action icons show on hover or focus. Deletes of single rows are
  undone from a toast (5 s), never confirmed. Families, accounts and kids keep a typed confirmation.
  Home's lists leave out `⋯`, since they're for glancing; tapping a row opens it.
- **Tap targets.** 44 px controls and rows on phones, from the theme recipes at the base breakpoint
  (chips stay 36 px tall with a 44 px hit area). Inputs use 16 px text so iOS doesn't zoom. The
  bottom bar and sheets clear the home indicator (`env(safe-area-inset-bottom)`).
- **Copy.** Short, plain and sentence case. Buttons say what they do ("Save expense", "Mark done").
  Toasts say what happened and offer one way back ("Expense deleted · Undo"). Defaults are stated, not
  asked ("Tomorrow, 9:00"). Errors say what to do next ("Couldn't save. Try again."). No exclamation
  marks, no "Oops".

## The look

**Same colours as today:** the `ledger`, member and category tokens, with no new hex values.

**Radius: four steps, the same at every breakpoint.** The signed-off desktop already used the phone
radii, so the plan's "a step up at the base breakpoint" becomes one step up everywhere.

| Step | Today | Proposed | Used for |
| --- | --- | --- | --- |
| `control` | 6 px | **10 px** | buttons, inputs, selects, segmented controls, sidebar links, icon tiles, row hover |
| `card` | 10 px | **16 px** | cards, grouped lists, toasts, the **+** button, desktop dialogs (today 12 px) |
| `sheet` | none | **22 px** | the top corners of a phone bottom sheet |
| `pill` | `full` | **9999 px** | chips, badges for deltas, the bottom bar's indicator, avatars |

**Spacing per breakpoint** (Chakra steps; 4 = 16 px):

| | Phone (base) | Desktop (`md` / `lg`) |
| --- | --- | --- |
| Page side padding | 4 | 6 / 8 |
| Page top | 3 | 6 |
| Between cards and sections | 4 | 5 |
| Between the two desktop columns | n/a | 6 (`lg`) |
| Card padding | 4 | 5 |
| Row minimum height and icon tile | 14 (56 px) and 10 (40 px) | 12 (48 px) and 9 (36 px) |
| Bottom bar | 72 px + safe area | none (sidebar, 240 px) |

**Type:** the existing scale, except the hero total at 28 px (`4xl`) on phones too (today 24 px) and
the quick-add amount at 40 px (see the questions).

**Motion.** Tokens: `press` 90 ms, `fast` 120 ms, `moderate` 200 ms, `slow` 300 ms; easings
`standard` `cubic-bezier(0.2, 0, 0, 1)`, `enter` `cubic-bezier(0.05, 0.7, 0.1, 1)` and `exit`
`cubic-bezier(0.3, 0, 0.8, 0.15)`. Keyframes come from the theme (Chakra's `fade-in`, `scale-in` and
`slide-from-top`). Only `transform` and `opacity` move, except the row collapse.

| Animation | What moves | Token |
| --- | --- | --- |
| Sheet opens / closes | `translateY` 105% → 0 | `slow` · `enter` / `slow` · `exit` |
| Scrim | opacity | `moderate` · `standard` |
| Desktop dialog | opacity, scale 0.96 → 1 | `moderate` · `enter` / `exit` |
| Press (buttons, rows, chips, icons) | scale 0.97 (chips 0.95, icons 0.92) | `press` · `standard` |
| New row slides in | `slide-from-top` + `fade-in` | `slow` · `enter` |
| Deleted row collapses, undo reopens it | `grid-template-rows` 1fr ↔ 0fr, opacity | `moderate` · `standard` |
| Swipe snaps back / flies out | `translateX` | `moderate` · `standard` |
| Segmented and bottom-bar indicators | `translateX` (Zag moves the segmented one by `left`/`width`) | `moderate` · `standard` |
| **+** turns into × | rotate 45° | `moderate` · `standard` |
| Save check | `scale-in` + `fade-in`; the button turns green | `slow` · `enter`; colour `press` |
| Month total counts up | number, ease-out cubic (JavaScript) | `countUp` 450 ms |
| Meter fills | `scaleX` | `slow` · `standard` |
| Toast in / out | `translateY` 20 px, opacity | `moderate` · `standard` |
| Hover actions, row tint | opacity, background | `fast` |
| Skeleton → content (U4) | opacity | `moderate` · `standard` |

**Reduced motion** turns every animation and transition off: changes are instant and the action
still happens. It is one block in `global-css.ts` (it replaced the `globals.css` block and the one
`matchMedia` in `reminders-screen.tsx`). JavaScript motion (the count-up, the check's hand-off) asks
`useReducedMotion()` (`src/hooks/use-reduced-motion.ts`).

**Where the values live (U4):** the radii in the theme's `tokens.ts`; durations, easings, keyframes
and press feedback in `src/components/ui/theme/motion.ts`; page spacing in `theme/layout.ts`; touch
sizes in the recipes. U3's dev-only `proposed-theme.ts` is gone and the mockups use the real theme.

## What differs from the signed-off mockup

- **Fewer radius steps.** The HTML used 9, 12, 14 and 18 px in places (segment items, icon tiles, the
  Save button, the **+**). Here those are `control` (10) or `card` (16).
- **Type stays in the scale.** The total is 28 px, not 34. The amount input is 40 px, not 46.
  Page titles use `pageTitle` (18 px on phones, 20 on desktop), not 24.
- **The save check pops in** (scale and fade) instead of drawing its stroke, which keeps to "only
  transform and opacity". The month card has a meter but **no daily bars**, which are for Insights,
  and Home has to fit one screen.
- **Snooze on Home's rows**, next to Done (the HTML had it only on desktop). It reaches the plan's
  snooze target of 2 from Home.
- **`⋯` on Money and Planning rows on phones.** The HTML relied on swipes alone, which aren't
  reachable without a gesture.
- **Money shows a one-line total** above the list ("€947.65 · 7 expenses · 18% less than October so
  far"), and desktop adds a "By category" card. The rows are grouped by day, not by week.
- **Settings order:** Account, Notifications, Family, AI (Notifications moved up, as the audit
  suggests). On desktop the list sits left of the open page; on phones More *is* the list.
- **The toast's Undo** uses `brand.muted`, not the HTML's one off-palette colour.
- **Desktop Add** keeps the HTML's clay, as the **+** does. Elsewhere the solid button is ink, as today.

## Found on the way

- **Status backgrounds are transparent in the app today.** The raw tokens `status.*Bg` and the
  semantic `status.*.bg` compile to the same CSS variable, which ends up referring to itself:
  `--chakra-colors-status-negative-bg: var(--chakra-colors-status-negative-bg)`. So
  `bg.error|success|warning|info`, every `StatusBadge` and every `InlineAlert` lose their fill (Home's
  "↓ 18%" badge shows it). It's a theme change, so it's left out of U3: a separate task renames the
  raw tokens and adds a collision test. Until then the mockups' coloured tiles use category tokens
  with the same values.
- **Quick-add To-do is 3 taps, not 2.** The plan's "+ → To-do → Enter: 2" counts two presses for
  three. Remembering the last kind used (per device, plan point 10) makes a repeat to-do 2.

## Decisions (George, 4 November 2026)

George signed off the direction and the mockups and took the recommended answer to every open
question. Where a question named no recommendation, the answer is the one this page and the mockups
already show.

1. **Radius on desktop:** the same steps as phones (control 10, card 16, sheet 22, pill), as signed
   off. No smaller desktop step.
2. **The quick-add amount:** 40 px, the one size above the type scale.
3. **The sheet remembers the last kind** used, per device (plan point 10), so a repeat to-do is 2
   taps. The first open on a device starts on Expense.
4. **Money's member picker:** a "Me ▾" menu (one row at 390 px).
5. **To-dos on a phone:** one column at a time with a segmented control, as shown.
6. **Insights:** a fourth segment of Money (Expenses, Investments, Net worth, Insights), which Home's
   card links to.
7. **Event defaults in quick add:** today, all day, as the mockup shows; "Choose a time…" sets a time.
8. **Calendar on phones:** Agenda.
9. **Sheet close timing:** keep `slow` (300 ms) with the `exit` easing.
10. **Kids:** parent-only rows in More and a Home that works without the expenses permission are
    enough; no kid mockup before U5.

U4 builds on these. The values in "The look" above are now the theme's
(`src/components/ui/theme`), and the mockups use the real tokens and primitives.
