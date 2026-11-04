# UI plan (family hub phase 17): mobile first, few taps, cleaner code

This plan rebuilds the app's screens for a phone first, so the everyday things take one or two
taps from anywhere. **It refactors the code under each screen as it goes**, and every kind of
problem found along the way becomes a **lint rule**, so it can't come back. It replaces steps
17.1–17.7 in [family-hub-roadmap.md](family-hub-roadmap.md) and closes the audit findings mapped
to phase 17 ([codebase-audit.md](codebase-audit.md): D6, D9, D10, B1, B5, B8, B10).

**Order (George, 3 November 2026):** phase 17 now, before phase 16 (performance). Phase 16's plan
([performance-plan.md](performance-plan.md)) waits; its "where the app stands" table is refreshed
when it starts, since this phase changes the screens it describes. Phase 14's S14 and phase 15's
L12 still run on their dates (about 9 and 6 November); neither touches the screens.

## Where the app stands (3 November 2026)

| Area | Today |
| --- | --- |
| Phone navigation | A bottom tab bar with **Home, Expenses and More**. Reminders, To-dos, Calendar, Investments, Net worth and Settings are all inside the More sheet, so each is two taps away. |
| Desktop navigation | A sidebar: Home; Finance (Expenses, Investments, Net worth); Planning (Reminders, To-dos, Calendar); Settings. |
| Adding things | Each screen has its own "Add" button that opens a centred dialog. There is no way to add an expense from Home, or a reminder from Expenses. |
| Expense form | Description first, then amount, category (a select, default "groceries"), subtype, date, notes. Nothing is remembered from the last expense. |
| Settings | Up to seven tabs: Account, Family, My permissions, Manage family, Notifications, AI assistants, AI features. |
| Dialogs | `AppDialog` / `ConfirmDialog` everywhere: centred on every screen size. No bottom sheets. |
| Data layer | Two styles (audit D6): to-dos, reminders, calendar and imports use an API object plus a hook with optimistic updates; expenses, investments, net worth, family and settings call `apiRequest` inline in each dialog and refresh through `src/lib/api/invalidate.ts`. |
| Lint | `eslint.config.mjs` has guardrails written as `no-restricted-syntax` selectors (theme colours, radii, control heights, PostgREST injection), import boundaries (Supabase, worker) and `no-console`. A per-file `no-restricted-syntax` block replaces the options of earlier ones, which is why `uiGuardrails` repeats the injection rules by hand. There are no custom rules and no rule tests. |
| Preview | `/dev/preview/[screen]` renders screens with fixtures; `/dev/ui` is the primitives gallery. |

### Taps for the everyday tasks today (on a phone, from Home)

Counted from the code; U2 checks them in the browser. "Taps" leaves out typing.

| Task | Today | Target |
| --- | --- | --- |
| Add an expense | Expenses → Add expense → category select → pick → Add: **5** | **+ → Save: 2** (amount and description typed; category guessed) |
| Add a to-do | More → To-dos → Add a card → Enter: **3** | **+ → To-do → Enter: 2**, from any screen |
| Add a reminder | More → Reminders → Add reminder → (date/time) → Add: **4–6** | **+ → Reminder → Save: 3**, with "tomorrow 9:00" as the default |
| Mark a reminder done | More → Reminders → Done: **3** | **Done on Home: 1**, or a swipe on Reminders |
| See this month's spending | Home: **0–1** | Home: **0** |
| Snooze a reminder | More → Reminders → Snooze → choice: **4** | **Swipe or long-press → choice: 2** |
| Delete a to-do | More → To-dos → open card → Delete → confirm: **5** | **Swipe left: 1**, with undo instead of a confirm |
| Change a setting | More → Settings → tab → change: **4** | More → Settings → row → change: 4, but one list instead of seven tabs |

## How the app becomes mobile first

1. **Design at 390 px first.** Every mockup and every screen PR starts with the phone layout; the
   desktop layout is the same screen given more room (two columns where it helps), not a
   different app. Screenshots at 390 and 1280 px in every PR.
2. **One "+" button everywhere.** The middle of the bottom bar (and a button at the top of the
   sidebar) opens a **quick-add sheet**: Expense, To-do, Reminder, Event. It's the same sheet on
   every screen, so adding never depends on where you are. On desktop, `N` opens it too.
3. **The fastest expense form possible:**
   - **amount first**, with the phone's decimal keypad (`inputMode="decimal"`) and focus on open;
   - **description with suggestions** from your own recent expenses; picking one also fills its
     category and subtype;
   - **the category guessed** from the description (your past expenses with the same or a similar
     description; no AI), shown as a chip you can change with one tap instead of a select;
   - **today** as the date and **notes hidden** behind "More details";
   - one big **Save** button at the bottom, above the keyboard, and "Save and add another".
4. **Bottom sheets on phones.** Dialogs open from the bottom on a phone (Chakra's `Drawer` with
   `placement="bottom"`), within thumb reach, with the main button at the bottom; on desktop they
   stay centred dialogs. One primitive, so screens don't choose.
5. **Navigation by frequency.** The bottom bar becomes **Home, Money, +, Planning, More**:
   - **Money:** Expenses, Investments and Net worth as one section with a segmented control at
     the top (sections the user can't reach are hidden, as `navigationFor` does now);
   - **Planning:** Reminders, To-dos and Calendar the same way (Reminders alone without a
     family);
   - **More:** Settings, the family pages and the less frequent things.
   The sidebar has the same five groups, so a person who uses both doesn't learn two maps.
6. **Home is "today".** What's due and overdue (with **Done** and **Snooze** right on the row),
   this month's spending against last month, the last few expenses, and the family's open to-dos.
   It fits one phone screen on a typical day. Everything else moves to its own section.
7. **Act on rows directly.** Swipe left to delete (with **undo**, no confirm dialog), swipe right
   for the main action (Done for reminders), long-press or a `⋯` button for the rest. On desktop:
   hover actions and keyboard shortcuts instead of swipes.
8. **Fewer choices on screen.** One primary action per screen; filters, export and rarely used
   options behind a "⋯" menu or a filter sheet. Settings become **one grouped list** (Account,
   Family, Notifications, AI) whose rows open their pages, instead of seven tabs.
9. **Thumb-friendly sizes.** 44 px touch targets on phones, set in the theme recipes for the base
   breakpoint (the existing lint rule against forcing `minH` stays: sizes come from the theme),
   16 px inputs so iOS doesn't zoom, and the bottom bar clear of the home indicator
   (`env(safe-area-inset-bottom)`).
10. **Defaults remembered.** Last viewed member, last expense tab, last snooze choice: per device,
    in `localStorage`, never required.

## The look: the same colours, friendlier on phones, a little more alive

**Decided (George, 4 November 2026):** not the Duolingo-inspired styling plan. Keep the app's
colours, make the style a little friendlier on phones and a little more animated, and refresh the
desktop version lightly with the same changes.

**Signed off (George, 4 November 2026):** a clickable HTML mockup of Home, quick add, Money,
Planning, More and the desktop home, with the radii (cards 16 px, sheets 22 px, controls 10 px),
the motion tokens and the reduced-motion switch described below
([iFam Mobile Mockups](https://claude.ai/artifact/TjHRD4YAYJu2bzhhT6Hsu9), private to George). U3
rebuilds it in `/dev/preview` with the real components and takes it as the agreed starting point,
so U3's checkpoint is about the screens the mockup doesn't cover and anything that changed.

- **Colours stay as they are:** the `ledger` tokens in `src/components/ui/theme/tokens.ts` (cream
  surfaces, clay `#D97757` and clay dark `#A64B32` for the brand), the member colours and the
  category colours. No new hex values; the theme lint rules keep it that way.
- **Friendlier on phones:**
  - rounder cards and sheets (a step up in radius at the base breakpoint, set in the recipes);
  - more room around rows and between sections, and fewer borders (spacing and soft surfaces
    separate things instead of lines);
  - the numbers that matter (this month's total, a balance) larger, in the existing type scale;
  - headers that shrink as you scroll, so the content gets the screen;
  - icons next to categories and sections so a list can be scanned by shape, not only text.
- **A little more animated**, always short, always purposeful:
  - sheets slide up and dialogs fade and scale in; closing reverses it;
  - buttons, rows and chips press in slightly on tap (a small scale, under 100 ms), so every tap
    visibly answers;
  - new rows slide in, deleted rows collapse out, and an undone delete slides back;
  - the segmented control's and bottom bar's indicator slides to the chosen item;
  - a small check on save, and the month's total counts up briefly on Home when it changes;
  - skeletons fade into content instead of popping.
- **Rules for the motion:**
  - durations and easings are **theme tokens** (`fast` ~120 ms, `moderate` ~200 ms, `slow`
    ~300 ms; a standard, an entering and an exiting easing), and keyframes live in the theme;
    components use the tokens, never literal values (a lint rule checks it);
  - only `transform` and `opacity` are animated (no animated heights or widths except the row
    collapse, which uses a grid-rows trick rather than measuring), so it stays smooth on a
    mid-range phone and adds no layout shift;
  - **`prefers-reduced-motion: reduce` turns all of it off** in one place (`global-css.ts`),
    leaving instant changes; the action itself always still happens;
  - CSS and Chakra's built-in animation support only: **no animation library**, so the bundle
    doesn't grow.
- **Desktop, lightly:** the same tokens, radii, spacing and motion; the sidebar regrouped to match
  the bottom bar; hover states on rows and cards; the quick-add button at the top of the sidebar.
  The layout widens rather than changes, and nothing is redesigned that doesn't need it.

## How the code gets cleaner on the way

Every screen task follows the same five steps, in this order:

1. **Find what's simpler, before building.** U2 runs the `find-simpler-ways` skill on each module
   and writes `docs/simplification/<module>.md`. A screen task starts by reading its module's
   report and the audit findings for it, and does the proposals that touch the files it rebuilds.
2. **Rebuild on the target patterns.** The module moves to the API-object-plus-hook style (D6),
   with optimistic updates where a write nearly always succeeds; dates go through one formatter
   (D9); shared schemas for MCP and REST (B1, B8, D10). Move-only refactors outside the screen's
   files are phase 18's, not this task's.
3. **`/simplify` on the diff** before the PR is opened, applying its fixes. The PR says what it
   changed.
4. **A lint rule for every kind of issue found.** Whenever a review, `/simplify` or
   `find-simpler-ways` finds a problem that a machine can spot (a pattern, not a one-off bug), the
   same PR adds a rule for it, fixes every existing case in `src/`, and records it in
   `docs/lint-rules.md`. If a problem can't be checked by a rule (it needs judgement), it goes into
   the "Conventions" list in the same doc instead, and into the review checklist. A rule that would
   need more than ~40 existing fixes outside the screen's files lands as `warn` with a tracking
   line in `docs/lint-rules.md`, and turns to `error` once the count reaches zero.
5. **Check it like a user.** `/dev/preview` at 390 and 1280 px, the tap counts from the table
   above, keyboard and screen reader basics, then George's sign-off on the screenshots.

### Where lint rules live

- A **local ESLint plugin** in `eslint-rules/` (`eslint-rules/index.mjs` plus one file per rule),
  registered in `eslint.config.mjs` as `local`. Each rule is named `local/<what-it-prevents>`,
  has a message that says what to do instead and which doc explains it, and is tested with
  ESLint's `RuleTester` under vitest (`eslint-rules/*.test.mjs`), valid and invalid cases both.
- New guardrails are **rules, not more `no-restricted-syntax` selectors**, because each
  `no-restricted-syntax` block replaces the options of earlier ones for the same files (the reason
  `uiGuardrails` repeats the injection rules). U1 moves the existing selectors into named rules so
  that problem goes away.
- `docs/lint-rules.md` lists every rule: what it catches, why, the task that added it, and the
  reviewed way to disable it when needed (`// eslint-disable-next-line local/<rule> -- <reason>`).

**Rules already known** (U1 adds these; screen tasks will find more):

| Rule | Catches | From |
| --- | --- | --- |
| `local/no-iso-date-slice` | `toISOString().slice(0, 10)` and `.split("T")[0]` on dates: wrong day east or west of UTC. Use the date helpers with `APPLICATION_TIMEZONE`. | D9, B5 |
| `local/no-locale-date-without-zone` | `toLocaleDateString` / `toLocaleString` / `Intl.DateTimeFormat` outside the formatting module. Use `formatDate` / `formatDateTime`. | D9 |
| `local/no-redundant-swr-fetcher` | `useSWR(key, apiFetcher)`: the global config already uses it. | D6 |
| `local/no-fetch-in-components` | `fetch(` or `apiRequest(` inside `src/components/**` and `src/app/**` page files, outside the module's API object. Turned on per module as each one is converted. | D6 |
| `local/no-zod-flatten` | zod's deprecated `error.flatten()`. Use the shared field-error helper. | D2 |
| `local/no-raw-dialog` | `Dialog.Root` / `Drawer.Root` outside `src/components/ui`. Use `AppDialog` (which becomes a bottom sheet on phones). | U4 |
| `local/no-window-confirm` | `window.confirm` / `alert`. Use `ConfirmDialog` or undo. | U4 |
| `local/motion-tokens` | A literal duration, easing or `@keyframes` in `transition`, `animation`, `animationDuration` and friends outside the theme. Use the motion tokens, which reduced motion turns off. | U4 |
| `local/theme-colors`, `local/theme-radius`, `local/theme-control-size`, `local/postgrest-filter-string` | Today's `no-restricted-syntax` guardrails, moved into named rules unchanged. | U1 |

## Tasks

Same workflow as phases 14 and 15: one task, one branch, one PR, one fresh agent per task, run
one at a time in the main checkout. Branches are `ui/<id>-<slug>` from `main`. **Merging to `main`
deploys to production**, so each task must leave production working on its own.

**Merging:** tasks that don't change what users see (U1, U2) merge when reviewed and green, as in
earlier phases. **Every task that changes a screen waits for George's sign-off on its screenshots**
before it merges (the roadmap's 17.5 rule), then merges when green.

### Which agent picks each task

The rule from phase 14: **opus** for design work and for changes where a subtle mistake loses
data or breaks every screen; **sonnet** for well-specified work in one area with clear tests;
**haiku** only for mechanical edits. Effort is `high` for every task unless noted. Every agent is
told to use the `find-simpler-ways` report for its module, run `/simplify` before opening the PR,
and add lint rules as described above.

| Task | What | Roadmap | Audit | Depends on | Agent | Why that agent |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | Local ESLint plugin, `RuleTester`, `docs/lint-rules.md`, existing guardrails moved, the known rules | — | D2, D6, D9 (rules) | — | **sonnet** | Precise rules with tests; fixing existing violations is mechanical but wide. |
| U2 | Screen audit: what each screen shows and does, tap counts, `find-simpler-ways` per module | 17.1 | — | — | **opus** | Judgement about what to hide, merge or move, across every screen. |
| U3 | Design direction and 390/1280 mockups in `/dev/preview` | 17.2 | — | U2 | **opus** | The design decisions everything else follows. |
| — | **Checkpoint:** George signs off the direction and mockups | | | U3 | George | Nothing is built until then. **Passed 4 November 2026** (recommended answers to every open question; see [ui-direction.md](ui-direction.md), "Decisions"). |
| U4 | Theme refresh (radii, spacing, motion tokens, reduced motion) and mobile primitives: bottom sheet, sticky action bar, row actions, undo toast, amount input, touch sizes | 17.2 | — | U3 | **opus** | Changes how every screen looks and moves at once; focus, keyboard, safe-area and reduced-motion handling are easy to get subtly wrong. |
| U5 | Navigation: Home, Money, +, Planning, More; the sidebar to match; Settings as one list | 17.3 | — | U4 | **sonnet** | Rewrites `nav-items.ts` and the shell to a signed-off mockup. |
| U6 | The quick-add sheet and the fast expense form, with suggestions and the category guess | — | B1, B8 | U5 | **opus** | Expense writes from every screen, cache updates across screens, and a new suggestions endpoint. |
| U7 | Home as "today" | 17.4 | — | U6 | **sonnet** | One screen to a mockup, reusing reminders and expenses data. |
| U8 | Expenses, rebuilt and moved to the API-object-plus-hook style | 17.5 | D6, D9, D10, B5, B10 | U6 | **opus** | Money, the largest module, two decisions to settle with George, and the D6 conversion. |
| U9 | Investments and Net worth under Money | 17.5 | D6 | U8 | **sonnet** | Follows U8's pattern. |
| U10 | Planning: Reminders, To-dos and Calendar | 17.5 | D9 | U8 | **sonnet** | These already use the target data style; mostly layout. |
| U11 | Settings and the family pages | 17.5 | D6 | U5 | **sonnet** | Many small pages in one list, plus the D6 conversion of family and settings. |
| U12 | Swipe actions on phones; hover and keyboard actions on desktop | 17.6 | — | U10 | **opus** | Gestures that must not fight vertical scroll or the board's long-press drag. |
| U13 | Accessibility pass with axe in tests | 17.7 | — | U7–U12 | **sonnet** | Checks and fixes against a clear standard. |
| U14 | Close: tap counts again, screenshots, roadmap and plan updated | — | — | all | **sonnet**, effort medium | Measuring and writing up. |

There are **no migrations** planned. U6's suggestions read existing expense rows; if a query
needs an index, that goes to phase 16's PF10.

### U1: Lint rules as a habit

**Files:** new `eslint-rules/index.mjs`, one `eslint-rules/<rule>.mjs` and
`eslint-rules/<rule>.test.mjs` per rule, `eslint.config.mjs`, `vitest.config.ts` (its `include`
is `src/**` only today; add `eslint-rules/**/*.test.mjs`), new `docs/lint-rules.md`, `README.md` (link from "UI conventions"),
and every file with a violation.

- **The plugin:** plain ESM, no build step, no new dependency (ESLint's `RuleTester` ships with
  `eslint`). Each rule has `meta.docs.description`, `meta.docs.url` pointing at its section in
  `docs/lint-rules.md`, and a message that says what to use instead.
- **Move today's guardrails** (theme colours, palettes, radii, control heights, the PostgREST
  filter strings) from `no-restricted-syntax` into named rules with the same selectors and
  messages, and delete the duplicated `injectionRestrictions` spread. Behaviour must not change:
  `npm run lint` reports the same problems on a scratch file that breaks each one (show it in the
  PR).
- **Add the known rules** from the table above. `local/no-fetch-in-components` starts with an
  empty list of converted modules, so it's on but matches nothing yet; U8–U11 add their modules.
- **Fix every violation** of the new rules in `src/`, or, past ~40 fixes for one rule, set it to
  `warn` and record the count in `docs/lint-rules.md`. Counts on 3 November 2026: 2 ISO date
  slices, 30 `toLocale*`/`Intl.DateTimeFormat` calls (the formatters live in `src/lib/calendar.ts`,
  which the rule exempts), 6 `flatten()` calls, 5 redundant fetchers, and 29 component files
  calling `apiRequest` (left to U8–U11). No raw dialogs or `window.confirm` today: those two rules
  keep it that way.
- **`docs/lint-rules.md`:** one section per rule (catches, why, added by, how to disable with a
  reason), the "Conventions" list for checks a rule can't do, and the five-step routine from "How
  the code gets cleaner".

**Tests:** `RuleTester` valid and invalid cases for each rule; one test that every rule in
`eslint-rules/index.mjs` is enabled in `eslint.config.mjs` and documented in `docs/lint-rules.md`.

**Done when** lint passes with the plugin, the old selectors are gone, each rule has tests and a
doc section.

### U2: Screen audit

**Files:** new `docs/ui-audit.md`, new `docs/simplification/<module>.md` (from the skill), no
code changes.

- **For each screen** (Home, Expenses with tabs and import, Investments, Net worth, Reminders,
  To-dos, Calendar, every Settings page, the family pages, sign-in and join): what it shows, the
  two or three things people actually do there, the tap count for each in `/dev/preview` at
  390 px, and what can be hidden, merged or moved. Kid accounts too: what a kid sees and can do.
- **Check the tap table** in this plan against the real screens and correct it.
- **`find-simpler-ways` per module** (expenses, investments, net worth, reminders, to-dos,
  calendar, family, settings, layout): each report in `docs/simplification/`, and a one-line
  summary per module in `docs/ui-audit.md` of what the screen task should take on.
- **Candidate lint rules:** list the patterns the reports find that a rule could catch, for U1's
  follow-ups and the screen tasks.

**Done when** `docs/ui-audit.md` and the reports are merged and George has read the audit
(reviewed with George, as the roadmap's 17.1 says).

### U3: Direction and mockups

**Files:** new `docs/ui-direction.md`, new mockup screens in `src/app/dev/preview` (fixtures
only, no API), `docs/ui-styling/screenshots/` (390 and 1280 px).

- **Direction** (one page): density, hierarchy, one primary action per screen, progressive
  disclosure, sheet vs. page, row actions, the tap targets above, copy tone, and the look from
  "The look" above: the exact radius and spacing steps per breakpoint, and the motion list with
  each animation's token. Same colours as today.
- **Motion sample:** a "Motion" section in `/dev/ui` showing each animation (sheet, press, row in
  and out, indicator, save check, count-up), with a toggle that simulates reduced motion, so
  George can judge "a little more animated" by feel, not description.
- **Mockups** of Home, the quick-add sheet (each of its four forms), Money (Expenses), Planning
  (Reminders and To-dos), More and Settings, built with the real primitives where they exist and
  plain stand-ins for the U4 ones. Phone first; desktop for each.
- Each mockup lists its tap counts against the table's targets.

**Direction, mockups and decisions:** [ui-direction.md](ui-direction.md).

**Done when** George signs off the direction and the mockups (the checkpoint).

**Checkpoint passed (George, 4 November 2026):** direction and mockups signed off, with the
recommended answer to every open question ("Decisions" in [ui-direction.md](ui-direction.md)).

### U4: Theme refresh and mobile primitives

**Files:** `src/components/ui/app-dialog.tsx`, `confirm-dialog.tsx`, new `action-bar.tsx`,
`row-actions.tsx`, `undo-toast.tsx`, `amount-input.tsx`, `disclosure.tsx`,
`src/components/ui/theme/**` (tokens, recipes, `global-css.ts`), `src/app/dev/ui/ui-gallery.tsx`,
`eslint-rules/motion-tokens.mjs` (+ test), tests.

- **Theme first**, to the signed-off direction: the radius and spacing steps per breakpoint in the
  recipes, `durations`, `easings` and `keyframes` tokens, press feedback in the button, row and
  chip recipes, and one `@media (prefers-reduced-motion: reduce)` block in `global-css.ts` that
  sets every animation and transition to none. Colour tokens don't change. Replace the one-off
  `matchMedia("(prefers-reduced-motion: reduce)")` in `reminders-screen.tsx` with the shared
  approach (a `useReducedMotion()` hook for the few places JavaScript needs to know). Add
  `local/motion-tokens`.
- **`AppDialog` becomes responsive:** a bottom sheet below the `md` breakpoint (drag handle,
  swipe down or tap outside to close unless the form is dirty), a centred dialog above it. Same
  props, so every existing dialog changes without edits. The keyboard must not cover the footer:
  the footer sticks to the visual viewport.
- **`ActionBar`:** the sticky bottom area for a sheet's or page's main button, clear of the home
  indicator.
- **`RowActions`:** the `⋯` menu and, on phones, the long-press menu for a row; U12 adds the
  swipes on top of it.
- **`UndoToast`:** "Deleted · Undo" for 5 s, the write sent only when it expires or the page is
  hidden (or sent at once and reversed on undo, whichever the API allows; decide per module).
- **`AmountInput`:** decimal keypad, the account currency shown, two decimals enforced in the
  input (B1's client half; the schema half is U6).
- **Touch sizes:** 44 px controls and rows at the base breakpoint through the theme recipes,
  16 px input text on phones. The existing `minH` lint rule stays.
- **Lint:** `local/no-raw-dialog` and `local/no-window-confirm` from U1's table, if U1 didn't add
  them.

**Tests:** sheet vs. dialog by breakpoint; focus trapped and restored; a dirty form asks before
closing; undo cancels the write; amount input rejects a third decimal; reduced motion removes the
animations (the CSS block is present and `useReducedMotion` follows the media query);
`local/motion-tokens` valid and invalid cases. All existing dialog tests pass untouched. The
gallery shows every new primitive and the motion section.

**Done when** every dialog in the app is a bottom sheet on a phone with no edits to the dialogs,
the whole app has the new radii, spacing and motion with the same colours, and George has signed
off the gallery and screenshots at 390 and 1280 px.

**Signed off by George on 4 November 2026 (screenshots at 390 and 1280 px).**

**Built (4 November 2026):** the theme (`theme/motion.ts`,
`theme/layout.ts`, the radii in `tokens.ts`, touch sizes and press feedback in the recipes, the
reduced-motion block in `global-css.ts`), the responsive `AppDialog` (plus `pending` and `dirty`),
`ActionBar`, `RowActions` with `useRowActions()`, `UndoToast` with `useUndo()`, `AmountInput`,
`ToggleChip`, `Disclosure` and `Collapse`, `IconTile`, `useReducedMotion()`, and
`local/no-reduced-motion-query`; `local/motion-tokens` is an error. Screenshots:
`docs/ui-styling/screenshots/u4-{gallery-motion,gallery-mobile,gallery-sheet,dashboard,expenses,expenses-add-dialog,reminders,reminder-dialog}-{390,1280}.jpg`,
and the U3 mockups re-shot on the real theme (`u3-*.jpg`). One sheet for every width below `md`
comes from the dialog recipe (Chakra's `Dialog`, not `Drawer`), so a rotating phone never remounts
a form. Left for later: `AppDialog`'s `pending` replaces the 15 hand-written guards (and
`local/no-dialog-pending-guard`), the chips in 6 files move to `ToggleChip` (and
`local/no-raw-toggle-button`), and `DataGate`; the screen tasks that rebuild those files do it.

### U5: Navigation

**Files:** `src/components/layout/*`, `src/components/settings/settings-nav.tsx`,
`src/app/(app)/settings/layout.tsx`, new section layouts for Money and Planning (segmented
control between their pages), tests.

- Bottom bar: Home, Money, **+**, Planning, More, with labels, at 320 px wide too. The **+** opens
  a placeholder until U6.
- Money and Planning: a segmented control at the top of each section switches its pages and keeps
  the URL (`/expenses`, `/investments`, …, unchanged, so links and bookmarks still work).
- Sidebar: the same five groups.
- Settings: one grouped list page on phones; on desktop the list sits on the left of the page.
  The seven tabs go.
- Permissions and family: `navigationFor` keeps deciding what each user sees; a kid without the
  investments permission sees Money with Expenses only, and a user without a family sees Planning
  with Reminders only, with no empty segments.

**Tests:** `nav-items` for each kind of user (no family, parent, kid with and without each
permission); the active state for every route; the segmented control's URLs.

**Done when** screenshots at 320, 390 and 1280 px are signed off and every page is reachable in
at most two taps from Home.

**Built (4 November 2026), waiting for George's sign-off:** the bottom bar and sidebar from one
`navigationFor` table, `SectionNav` (the segmented control, rendered by the shell so no route
moves), the quick-add placeholder, `/more`, and Settings as a grouped list. Screenshots:
`docs/ui-styling/screenshots/u5-*.jpg`. Insights (a fourth Money segment) waits for U7.

**Signed off (George, 4 November 2026)** and merged in #213 with U3 and U4.

### U6: Quick add and the fast expense form

**Files:** new `src/components/quick-add/*`, `src/components/expenses/expense-form.tsx`,
`src/lib/validation/*` (shared expense schema), new `src/app/api/expenses/suggestions/route.ts`
(+ test) and `src/lib/expenses/suggestions.ts` (+ test), `src/lib/api/invalidate.ts` or the new
expenses API object, the MCP expense tools (shared schema only).

- **The sheet:** Expense (default), To-do, Reminder, Event (Event only with a family). Each form
  is the module's existing form in its compact mode, so there's one form per thing, not two.
- **Fast expense form:** as in "How the app becomes mobile first", point 3. The guess and the
  suggestions come from `GET /api/expenses/suggestions?q=`: the caller's last 200 distinct
  descriptions with their most used category and subtype, matched by prefix and then by words,
  computed on the server from existing rows (with `withUser` and the expenses permission, like
  the list route). No AI, no new table.
- **Schemas (B1, B8):** the shared expense schema refuses more than two decimals with a clear
  message and strips control characters from descriptions; REST and MCP both use it (D10's
  schema half).
- **After saving:** the sheet closes (or clears for "add another"), the new expense appears at
  once wherever it's shown (Home, Expenses, the dashboard), with rollback on error, and a toast
  links to it.
- **Desktop:** `N` opens the sheet (not while typing in a field).

**Tests:** suggestion ranking and the permission check; the guess for a known and an unknown
description; two-decimal refusal and control-character stripping in REST and MCP; optimistic add
and rollback; the sheet from three different screens.

**Done when** an expense takes two taps plus typing from any screen on a phone, and the tests
above pass.

**Built (4 November 2026), waiting for George's sign-off:**
- the sheet in `src/components/quick-add/`, with each module's form in its compact mode;
- the fast expense form, and the suggestions route;
- optimistic adds through `expense-api.tsx` and `useExpenseWrites`;
- the shared schema's text rules;
- `local/client-only-chakra-factory`.

An expense takes + → Save (2 taps) when the guess is right. Screenshots:
`docs/ui-styling/screenshots/u6-*.jpg`. Left for U8: `POST /api/expenses`' month rule, which the
client no longer needs.

### U7: Home as "today"

**Files:** `src/app/(app)/dashboard/page.tsx`, `src/components/dashboard/*`, reminders and
expenses hooks (read only), tests.

- Due and overdue reminders with Done and Snooze on the row; this month vs. last month; the last
  five expenses; the family's open to-dos assigned to you (with a family). Each block links to its
  section.
- The current Summary, Monthly and History dashboards move under Money (as "Insights", or a tab
  of Expenses, per the mockup). Nothing is deleted.
- Fits one phone screen with three reminders and five expenses.

**Done when** the screenshots are signed off and marking a reminder done takes one tap.

### U8: Expenses

**Files:** `src/app/(app)/expenses/**`, `src/components/expenses/**`, a new
`src/components/expenses/expense-api.ts` and hooks (the to-dos style), `src/lib/api/invalidate.ts`
(the expense parts move out), the date formatter, tests.

- Rebuild to the signed-off mockup: the month and the member as compact controls, tabs as a
  scrollable chip row, export and import behind `⋯`, rows with row actions.
- **D6:** move expenses to an API object plus hooks with optimistic add, edit and delete, and
  turn on `local/no-fetch-in-components` for `src/components/expenses/**`.
- **D9, B5:** dates through the one formatter; fix the date picker's maximum east of UTC+12.
- **D10, B10:** settle with George before building: the month an expense belongs to when REST
  and MCP disagree, and the warning (or per-expense currency) when the account currency changes.
  The PR implements his choice.
- Also fixes **B4** on the way, since the family-view cache updates move into the new hooks
  (phase 16's PF11 then has nothing left to do for it).

**Done when** the screen is signed off, expenses use the new data style with the lint rule on,
and D9, D10, B4, B5 and B10 are closed.

### U9: Investments and Net worth

**Files:** `src/app/(app)/{investments,net-worth}/**`, `src/components/{investments,net-worth}/**`,
tests.

- Under Money, to the mockup, with U8's patterns: API objects and hooks (optimistic only for
  net-worth valuations, not orders), row actions, bottom-sheet forms. Remove the five redundant
  `apiFetcher` arguments (U1's rule will already have flagged them).

**Done when** the screens are signed off and both modules have the lint rule on.

### U10: Planning

**Files:** `src/app/(app)/{reminders,todos,calendar}/**`, `src/components/{reminders,todos,family-calendar}/**`,
tests.

- Under Planning, to the mockup. Reminders: grouped by today, upcoming, done, with Done and
  Snooze on the row. To-dos: the board stays (columns scroll sideways on a phone, one column per
  screen width) with quick add at the top of each column. Calendar: the week view on phones,
  month on desktop.
- These modules already use the target data style; move `subscribe-dialog.tsx`'s raw
  `useEffect` load onto SWR (D6's leftover).

**Done when** the screens are signed off.

### U11: Settings and family

**Files:** `src/app/(app)/settings/**`, `src/components/{settings,family}/**`, tests.

- One grouped list (Account, Family, Notifications, AI), each row opening its page; the parent-
  only rows only for parents. Family pages and dialogs to the mockup.
- **D6:** family and settings move to API objects and hooks; the OAuth consent screen uses
  `useApiForm`; turn on `local/no-fetch-in-components` for these folders.

**Done when** the screens are signed off and the lint rule is on for every module (it then
covers all of `src/components`).

### U12: Swipe actions

**Files:** `src/components/ui/row-actions.tsx`, new `src/components/ui/use-swipe.ts`
(+ test), the to-do card and the reminder row, tests.

- As the roadmap's 17.6: on phones, swipe a to-do card left to delete with undo, and a reminder
  row right for Done and left for Snooze. Moving 10 px sideways before the board's 200 ms
  long-press starts a swipe; vertical movement scrolls; the long-press drag keeps working. No
  swipe on desktop: hover icons and the `Delete` key on a focused card instead.
- Pointer events only, no gesture library. `prefers-reduced-motion` turns off the slide
  animation, not the action.

**Tests:** the gesture decision (sideways vs. vertical vs. long-press) with synthetic pointer
events; undo; keyboard delete on desktop.

**Done when** on a phone, swiping deletes with undo, and scrolling and dragging still work.

### U13: Accessibility pass

**Files:** a dev dependency on `axe-core` (pinned), a test helper, tests per main screen, fixes.

- Run axe against each main screen's preview render in vitest; fix contrast, focus order, labels
  and target sizes. Add a lint rule for any pattern found more than once (for example an icon
  button without `aria-label`).

**Done when** no axe violations on the main screens, and the checks run in CI.

### U14: Measure and close

**Files:** `docs/ui-audit.md`, `docs/family-hub-roadmap.md`, `docs/lint-rules.md`.

- The tap table again, measured in production on a phone, next to today's and the targets.
- Screenshots of every main screen at 390 and 1280 px in `docs/ui-styling/screenshots/`.
- Lint: every `warn` rule's remaining count; turn to `error` those at zero.
- Roadmap's phase 17 marked done, linking this plan; phase 16's plan gets a note on what changed.

**Done when** the tables and screenshots are merged and each target is met or has a reason.

## Decisions for George

| Decision | Recommendation |
| --- | --- |
| The look | **Decided (4 November 2026):** today's colours, a friendlier style on phones, a little more motion, and a light desktop refresh (see "The look"). Not the Duolingo-inspired plan. |
| How much motion | The list in "The look", judged in U3's motion sample. Easy to tone down: every animation is one token. |
| Bottom bar | Home, Money, +, Planning, More. |
| Quick add's category guess | From your own past expenses, no AI: instant, free, and good once you've a few weeks of history. AI can be added in phase 8. |
| Confirm vs. undo for deletes | Undo for single rows (to-dos, expenses, reminders). Keep a typed confirmation for families, accounts and kids. |
| Old dashboards | Keep them all, under Money as "Insights". Home becomes "today". |
| Screen sign-off | You approve each screen's screenshots before its PR merges; non-visual tasks (U1, U2) merge when reviewed and green, as before. |
| A rule that needs many fixes | `warn` with a tracked count, then `error` at zero, so a new rule never blocks a screen PR for unrelated files. |
| D10 and B10 | Asked in U8 before it's built. |

## Not in this plan

- **Performance work** (server loading, bundles, indexes): phase 16, after this. This phase keeps
  new sheets and screens light (no new UI or gesture libraries) so it doesn't add to phase 16.
- **Test reduction and move-only refactors outside the rebuilt screens:** phase 18.
- **Native apps:** phase 9. The bottom-bar structure and quick add are meant to carry over.
- **Dark mode** and **gamification** (streaks, goals): later, with their own plans.
- **New colours or a new typeface.** The Duolingo-inspired styling plan
  (an uncommitted draft) isn't used.
