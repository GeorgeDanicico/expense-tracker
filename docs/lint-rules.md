# Lint rules

Every kind of problem a machine can spot gets a lint rule, so it can't come back. The rules live in
a local ESLint plugin, [eslint-rules/](../eslint-rules), registered in
[eslint.config.mjs](../eslint.config.mjs) as `local`, so a rule is `local/<name>`. This is the
reference for them: what each one catches, why, which task added it, and how to turn it off when a
case is reviewed and fine. It is part of phase 17 ([ui-plan.md](ui-plan.md)); U1 added the plugin.

Run them with `npm run lint`.

## The rules

| Rule | Severity | Existing cases (3–4 November 2026) | Added by |
| --- | --- | --- | --- |
| [`theme-colors`](#theme-colors) | error | none (moved unchanged) | U1 |
| [`theme-radius`](#theme-radius) | error | none (moved unchanged) | U1 |
| [`theme-control-size`](#theme-control-size) | error | none (moved unchanged) | U1 |
| [`postgrest-filter-string`](#postgrest-filter-string) | error | none (moved unchanged) | U1 |
| [`no-iso-date-slice`](#no-iso-date-slice) | error | 2 fixed | U1 |
| [`no-local-date-parse`](#no-local-date-parse) | error | 2 fixed (`formatDate`, `formatMonthLabel`) | U8 |
| [`no-locale-date-without-zone`](#no-locale-date-without-zone) | error | 7 fixed, 8 formatter modules exempt | U1 |
| [`no-redundant-swr-fetcher`](#no-redundant-swr-fetcher) | error | 5 fixed | U1 |
| [`no-fetch-in-components`](#no-fetch-in-components) | error, on for expenses (U8), investments and net worth (U9), reminders, to-dos and the calendar (U10) | 15 component files in other modules still call `apiRequest` or `fetch` (U10–U11) | U1 |
| [`no-zod-flatten`](#no-zod-flatten) | error | 15 fixed (6 in code, 9 in tests) | U1 |
| [`no-raw-dialog`](#no-raw-dialog) | error | none | U1 |
| [`no-window-confirm`](#no-window-confirm) | error | none | U1 |
| [`no-subtle-text`](#no-subtle-text) | error | fixed in U13 | U13 |
| [`motion-tokens`](#motion-tokens) | error | 5 fixed in U4 (a `warn` until the tokens existed) | U1 |
| [`no-reduced-motion-query`](#no-reduced-motion-query) | error | 1 fixed | U4 |
| [`client-only-chakra-factory`](#client-only-chakra-factory) | error | none left (`list-row.tsx` was fixed by hand in #213) | U6 |

A rule that would need more than about 40 fixes outside the screen's own files lands as `warn`
with its count here, and turns to `error` once the count reaches zero.

## Why a plugin

Before U1 the guardrails were `no-restricted-syntax` selectors. A block of `no-restricted-syntax`
for some files **replaces** the options of every earlier block for the same files, so each block
had to repeat the others' selectors by hand (`uiGuardrails` repeated the PostgREST ones). Named
rules don't clash: each has its own name, a message that says what to do instead, tests, and a
section below. `no-restricted-syntax` isn't used for the project's own guardrails any more.

## How to add a rule

1. Write `eslint-rules/<name>.mjs` (plain ESM, no new dependency) with `meta.docs.description`,
   `meta.docs.url` set with `ruleDocsUrl("<name>")`, and a message that says what to use instead.
2. Write `eslint-rules/<name>.test.mjs` with `createRuleTester()` (ESLint's `RuleTester` under
   vitest): valid and invalid cases both.
3. Register it in `eslint-rules/index.mjs` and turn it on in `eslint.config.mjs`.
4. Fix every existing case in `src/`, or set it to `warn` past about 40 and record the count below.
5. Add a section below named after the rule.

`eslint-rules/config.test.mjs` fails if a rule in the plugin isn't enabled in the config or has no
section here.

## Disabling a rule

When a case is reviewed and right, disable that line, with the reason after `--`:

```ts
// eslint-disable-next-line local/<rule> -- <reason>
```

A disable without a reason, or for a whole file, doesn't pass review. Where a place is exempt by
design (the formatting module for dates, `src/components/ui` for dialogs), the exemption is in
`eslint.config.mjs`, not in a comment.

## Rules

### `theme-colors`

**Catches:** a hex colour in a colour prop (`color`, `bg`, `bgColor`, `background`,
`backgroundColor`, `borderColor`, `fill`, `stroke`), and a `colorPalette` that isn't `brand`,
`neutral`, `danger`, `success`, `warning` or `info`.

**Why:** colours come from the theme (`src/components/ui/theme`), so the app looks the same
everywhere and a change of palette is one edit. Outside `src/components/ui`.

**Added by:** moved from `no-restricted-syntax` in U1, with the same selectors and messages.

**Disable:** `// eslint-disable-next-line local/theme-colors -- <reason>` (a chart library that can't take a token, say).

### `theme-radius`

**Catches:** `borderRadius` or `rounded` on `Button`, `IconButton`, `Input`, `Textarea`, and on
`NativeSelect.Field`, `Dialog.Content`, `Tabs.Trigger` and the like.

**Why:** a control's radius comes from its recipe, so one edit in the theme changes every control.
Outside `src/components/ui`.

**Added by:** moved from `no-restricted-syntax` in U1.

**Disable:** `// eslint-disable-next-line local/theme-radius -- <reason>`.

### `theme-control-size`

**Catches:** `minH` or `minHeight` of `11` or `14` (a forced 44 px) on the same controls.

**Why:** controls use the theme's sizes (`xs`, `sm`, `md`). Touch sizes are set in the theme
recipes for the phone breakpoint (U4), not forced per control. Outside `src/components/ui`.

**Added by:** moved from `no-restricted-syntax` in U1.

**Disable:** `// eslint-disable-next-line local/theme-control-size -- <reason>`.

### `postgrest-filter-string`

**Catches:** a template literal or a `+` as the first argument of `.or()` or `.filter()`, and any
`.or()` argument that isn't a plain string literal (a joined array, say).

**Why:** PostgREST parses that string, so a `,`, `(`, `)` or `.` in a value changes the query: an
injection (security plan S8). Pass values to `.eq`, `.in`, `.gte`, or check each part against a
catalogue first (`src/lib/supabase/filters.ts`).

**Added by:** moved from `no-restricted-syntax` in U1. The only disables are the tab membership
filter (every key is checked by `expenseTabMembershipFilter`) and a test fake.

**Disable:** `// eslint-disable-next-line local/postgrest-filter-string -- <where the parts are checked>`.

### `no-iso-date-slice`

**Catches:** `date.toISOString().slice(0, 10)` (also `substring(0, 10)`), and
`date.toISOString().split("T")[0]` or `const [day] = date.toISOString().split("T")`.

**Why:** `toISOString()` is in UTC, so the day it gives is the wrong one near midnight east or west
of UTC (audit D9, B5). Use `getBucharestToday()` for today and the helpers in `src/lib/calendar.ts`
(`lastDayOfMonth`, `addDays`, …), which use `APPLICATION_TIMEZONE`.

**Added by:** U1. **Existing cases:** 2, fixed: the file name of the data export now uses the
application's today, and the expense form's latest date is `lastDayOfMonth` of the month.

**Not caught:** a date sliced after being stored in a variable, and `.slice(0, 16)` to fill a
`datetime-local` input from the browser's own zone (the order form fills it from the application's
clock now, with `utcToZoned`).

**Disable:** `// eslint-disable-next-line local/no-iso-date-slice -- <why UTC is meant>`.

### `no-local-date-parse`

**Catches:** `new Date(…)` and `Date.parse(…)` of a string or template literal that ends in a time
with no `Z` or offset: `` new Date(`${date}T12:00:00`) ``, `new Date("2026-10-01T09:30")`.

**Why:** JavaScript reads such a date and time in the device's zone, so the same calendar date is a
different instant on every device, and formatting it elsewhere (or in another zone) can show another
day (audit D9, B5). For a calendar date use noon UTC and format in UTC (`formatDate`,
`formatShortDate`); for "today" and months, the helpers in `src/lib/calendar.ts`. A date-only string
(`"2026-10-01"`) is read as UTC and isn't caught.

**Added by:** U8, from its `/simplify` pass. **Existing cases:** 2, fixed: `formatDate` and
`formatMonthLabel` in `src/lib/calendar.ts` now parse at noon UTC and format in UTC.

**Not caught:** a string built in a variable first.

**Disable:** `// eslint-disable-next-line local/no-local-date-parse -- <why the device's zone is meant>`.

### `no-locale-date-without-zone`

**Catches:** `new Intl.DateTimeFormat(…)`, `Intl.DateTimeFormat(…)`, `toLocaleDateString()`,
`toLocaleTimeString()` and `toLocaleString()` (except `toLocaleString` with a number option such as
`style` or `maximumFractionDigits`, which formats a number).

**Why:** the locale and the time zone of every displayed date are chosen in one place, not by each
caller (audit D9). Use `formatDate`, `formatDateTime`, `formatShortDate` and the other formatters
in `src/lib/calendar.ts`, or add one there.

**Exempt (in `eslint.config.mjs`, `DATE_FORMATTER_MODULES`):** `src/lib/calendar.ts` and the
modules whose job is to format one kind of date: `time-zone.ts`, `ai/month.ts`,
`family/last-active-label.ts`, `family-calendar/view.ts`, `imports/recent.ts`, `imports/review.ts`
and `reminders/format.ts`. A new formatter module is added to that list in the PR that creates it.

**Added by:** U1. **Existing cases:** 7 outside those modules, fixed: `formatInstantDate`,
`formatShortDate`, `formatUtcDay` and `formatMonthLabel` were added to
`calendar.ts` with the output unchanged, and the import service uses `formatInstantDay` from
`imports/recent.ts`. The 8 exempt modules hold 20 formatters between them.

**Disable:** `// eslint-disable-next-line local/no-locale-date-without-zone -- <reason>`.

### `no-redundant-swr-fetcher`

**Catches:** `useSWR(key, apiFetcher)` (also `useSWRImmutable` and `useSWRInfinite`).

**Why:** the one global `SWRConfig` (`src/components/ui/provider.tsx`) already sets
`fetcher: apiFetcher`, so `useSWR(key)` is the same call with less to read and no second place to
change (audit D6).

**Added by:** U1. **Existing cases:** 5, fixed (investments panel ×2, asset detail, net worth
panel ×2).

**Disable:** `// eslint-disable-next-line local/no-redundant-swr-fetcher -- <reason>`: only if a
provider other than the app's is in play.

### `no-fetch-in-components`

**Catches:** `fetch(…)` and `apiRequest(…)` (also `window.fetch`, `globalThis.fetch`) in the files
of a **converted module**: its components and page files. Files named `*-api.ts(x)` and tests are
where a module's requests live and are exempt.

**Why:** requests belong in the module's API object (like `src/components/todos/todo-api.tsx`),
called through a hook with optimistic updates where a write nearly always succeeds. Then `/dev/preview`
can drive a screen with fixtures and cache updates sit next to the writes (audit D6).

**How a module is turned on:** add its folders to `CONVERTED_MODULES` in `eslint.config.mjs`, in the
PR that converts it. U8 to U11 did them one by one; U11 ended with all of `src/components` and
`src/app/(app)` listed:

```js
const CONVERTED_MODULES = ["src/components", "src/app/(app)"];
```

A new folder under `src/components` is covered without a change.

**On for settings, family, auth and OAuth since U11** (so for every folder under `src/components`): family writes are in `family/family-api.tsx` (through `useFamilyWrites`), the profile picture's in `settings/settings-api.tsx`, sign-in in `auth/auth-api.ts` and the consent answer in `oauth/oauth-api.ts`; the other Settings cards call helpers in `src/lib`.

**Added by:** U1, with an empty list. **On for expenses since U8**: `src/components/expenses`
(the import screens included) and `src/app/(app)/expenses`, whose requests are all in
`expense-api.tsx` and `import/import-api.tsx`, called through `useExpenseWrites` and the import
hooks. **On for investments and net worth since U9**: their components and pages
(`src/components/{investments,net-worth}`, `src/app/(app)/{investments,net-worth}`), whose requests
are in `investment-api.tsx` and `net-worth-api.tsx`, called through `useInvestmentWrites` and
`useNetWorthWrites`. **Left to U10–U11:** 15 component files: `family` 12, `auth` 1, `oauth` 1,
`settings` 1. No page under `src/app/(app)` makes a request of its own any more
(Settings' currency change moved to `src/lib/api/account-requests.ts` in U8).
**On for reminders, to-dos and the calendar since U10**: `src/components/{reminders,todos,family-calendar}` and `src/app/(app)/{reminders,todos,calendar}`, whose requests were already in `reminder-api.tsx`, `todo-api.tsx` and `calendar-api.tsx`. No violations were left; the last raw `useEffect` load (the calendar link in `subscribe-dialog.tsx`) is now SWR.

**Disable:** `// eslint-disable-next-line local/no-fetch-in-components -- <reason>`.

### `no-zod-flatten`

**Catches:** `error.flatten()` (a call to a method named `flatten` with no arguments).

**Why:** it is deprecated in zod 4 and keeps only top-level keys; routes, services and forms each
turned it into `fieldErrors` their own way (audit D2). Use `fieldErrorsOf(error)` from
`src/lib/validation/field-errors.ts`, so the same mistake gives the same field errors everywhere.

**Added by:** U1, with the helper. **Existing cases:** 15, fixed (6 in code, 9 in tests). The
helper returns what `flatten().fieldErrors` returned, so no response changed.

**Disable:** `// eslint-disable-next-line local/no-zod-flatten -- <reason>`: for an unrelated
`.flatten()` (an image library, say).

### `no-raw-dialog`

**Catches:** `<Dialog.Root>` and `<Drawer.Root>` (and `RootProvider`) outside `src/components/ui`.

**Why:** `AppDialog` and `ConfirmDialog` are the one place that decides how a dialog looks and
behaves, and from U4 it is a bottom sheet on a phone. A screen that builds its own would skip that.

**Added by:** U1 (U4 listed it). **Existing cases:** none; this keeps it that way.

**Disable:** `// eslint-disable-next-line local/no-raw-dialog -- <reason>`.

### `no-window-confirm`

**Catches:** `window.confirm`, `alert` and `prompt` (and `globalThis.` / bare calls that resolve
to the browser's, not a function of your own with that name).

**Why:** they block the page, can't be styled, and can't be tested. Use `ConfirmDialog`, or undo
for a single row.

**Added by:** U1 (U4 listed it). **Existing cases:** none.

**Disable:** `// eslint-disable-next-line local/no-window-confirm -- <reason>`.

### `no-subtle-text`

**Catches:** a `Text` with `color="fg.subtle"` (also either side of a condition, such as
`color={on ? "fg" : "fg.subtle"}`).

**Why:** `fg.subtle` is 3.1 to 3.5:1 on the page's surfaces; text needs 4.5:1 (WCAG AA). axe found
the pattern in group labels, the navigation's section labels, the tab bar, the calendar's days
outside the month, and the placeholder. Use `fg.muted` (5.3:1 or more) for text; `fg.subtle` stays
for icons, dots and other decoration (3:1). The theme's contrast test
(`src/components/ui/theme/contrast.test.ts`) checks the pairs.

**Added by:** U13. **Existing cases:** fixed in U13, including the tab bar's inactive labels and the
placeholder colour in `global-css.ts` (neither is a `Text`, so the rule can't see them).

**Disable:** `// eslint-disable-next-line local/no-subtle-text -- <reason>`.

### `motion-tokens`

**Catches:** a literal duration (`120ms`, `0.6s`), a literal easing (`ease`, `ease-in-out`,
`linear`, `cubic-bezier(…)`, `steps(…)`) or an `@keyframes` in `transition`,
`transitionDuration`, `transitionTimingFunction`, `transitionDelay`, `animation`, `animationName`,
`animationDuration`, `animationTimingFunction`, `animationDelay` (as a prop, or a key in a style
or `css` object), outside `src/components/ui/theme`. A token (`fast`, `{durations.fast}`) or a
variable (dnd-kit's `transition`) isn't a literal and passes.

**Why:** durations and easings are theme tokens, and the keyframes live in the theme, so one
`prefers-reduced-motion` block can turn all of the app's motion off and the feel is tuned in one
place ("The look" in [ui-plan.md](ui-plan.md)).

The tokens are in `src/components/ui/theme/motion.ts`: durations `press`, `fast`, `moderate`,
`slow` (and `countUp`, for JavaScript), easings `standard`, `enter` and `exit`, and the keyframes
`sheet-in`, `sheet-out`, `pop-in` and `pop-out` beside Chakra's. Write them as props
(`transitionDuration="fast" transitionTimingFunction="standard"`) or inside a value
(`transition="opacity {durations.fast} {easings.standard}"`, or `transition("opacity", "fast")`
from the theme's `motion.ts`).

**Added by:** U1, as a `warn` until U4 added the tokens. **Existing cases:** 5, fixed in U4
(`nav-item.tsx`, `reminder-row.tsx`, `asset-selector.tsx`, `family-summary-dashboard.tsx`,
`family-spending-charts.tsx`); the rule is an `error` since.

**Disable:** `// eslint-disable-next-line local/motion-tokens -- <reason>`.

### `no-reduced-motion-query`

**Catches:** `matchMedia("(prefers-reduced-motion…)")` (a string or template literal) outside
`src/hooks/use-reduced-motion.ts`.

**Why:** reduced motion is handled in one place. CSS motion needs nothing: the theme's one
`@media (prefers-reduced-motion: reduce)` block in `global-css.ts` turns every animation and
transition off. JavaScript-timed motion (a count-up, a delayed hand-off, a smooth scroll) asks
`useReducedMotion()`, or `prefersReducedMotion()` outside a component, which also honour the
previews' "Simulate reduced motion" switch.

**Added by:** U4 (the audit's candidate). **Existing cases:** 1, fixed (`reminders-screen.tsx`).

**Disable:** `// eslint-disable-next-line local/no-reduced-motion-query -- <reason>`.

### `client-only-chakra-factory`

**Catches:** a call to `chakra(…)`, `createRecipeContext(…)`, `createSlotRecipeContext(…)` or
`createContext(…)` (Chakra's or React's, also `React.createContext`) at the top level of a module,
outside any function, in a file under `src/` that doesn't start with `"use client"`. Tests are
exempt.

**Why:** those factories only exist in the browser bundle, and a top-level call runs as soon as the
module loads. A server page that imports the file, even through the `@/components/ui` barrel, then
fails `next build` while it collects page data, which unit tests and `tsc` never see. It happened in
#213: `list-row.tsx` called `chakra("li", rowRecipe)` without the directive and `/dev/preview/mockups`
imported it. Put `"use client"` at the top of the file.

**Added by:** U6, from #213's CI failure. **Existing cases:** none left; `list-row.tsx` got its
directive in #213. Recipes (`defineRecipe`) are plain configuration and pass.

**Disable:** `// eslint-disable-next-line local/client-only-chakra-factory -- <why it never reaches a server module>`.

## Conventions

Checks that need judgement, so no rule can do them. They are in the review checklist: a reviewer,
`/simplify` and `find-simpler-ways` look for them, and one that turns out to be machine-checkable
becomes a rule above.

- **One primary action per view** (`variant="solid" colorPalette="brand"`); everything else is outline or ghost.
- **Colours and type come from the theme:** semantic tokens and `textStyle`, not ad hoc `fontSize` / `fontWeight`; one `amountHero` per screen.
- **Motion is short and purposeful:** only `transform` and `opacity` are animated, and the action always still happens when reduced motion is on. No animation library.
- **One data style:** an API object plus a hook per module, optimistic updates where a write nearly always succeeds (and never for orders or money moves that can fail for reasons the user must see).
- **Dates go through the formatters,** and "today" and "this month" come from the application calendar (`getBucharestToday`, `getBucharestMonth`), never from the browser's zone.
- **A date field for a new entry defaults to today** (`getBucharestToday`, or `defaultDateInMonth` inside a month view), not the end of the range or the last record's date, so a quick save never future-dates or overwrites. A "later" snooze or deadline is counted from the later of now and the thing's own due time.
- **A form is one component,** shared by the full page and the quick-add sheet, not two copies.
- **A form in a sheet is a `SheetForm` with `useSheetSave`** (fields, error, the big save button and
  "Save and add another"), and a choice with a stated default is a `ChipMenu`, not a select (U6).
- **Copy says what happened or what to do,** in plain words: "Couldn't save. Try again.", not "Error 500".
- **A destructive action** on one row is undone, not confirmed; deleting a family, an account or a kid keeps a typed confirmation.
- **No new dependency for something the platform or Chakra already does,** such as gestures, animation or dialogs.

## The routine for every screen task

The five steps from "How the code gets cleaner on the way" in [ui-plan.md](ui-plan.md):

1. **Find what's simpler, before building.** Read the module's `docs/simplification/<module>.md`
   (from U2's `find-simpler-ways` run) and the audit findings for it, and do the proposals that
   touch the files the task rebuilds.
2. **Rebuild on the target patterns.** API object plus hook for data, one formatter for dates,
   shared schemas for REST and MCP. Move-only refactors outside the screen's files are phase 18's.
3. **Run `/simplify` on the diff** before the PR is opened, apply its fixes, and say in the PR what
   it changed.
4. **Add a lint rule for every kind of issue found** that a machine can spot (a pattern, not a
   one-off bug): in the same PR, with `RuleTester` cases, every existing case in `src/` fixed (or
   `warn` past about 40, with the count in the table above), and a section here. A problem that
   needs judgement goes into "Conventions" and the review checklist instead.
5. **Check it like a user.** `/dev/preview` at 390 and 1280 px, the tap counts, keyboard and
   screen reader basics, then George's sign-off on the screenshots.
