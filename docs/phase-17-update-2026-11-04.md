# Phase 17 update, 4 November 2026 (cloud session)

Work for [the phase 17 plan](ui-plan.md), on branch `claude/phase-17-cloud-session-rk7uoj`.
**PR #213 (U3, U4 and U5) merged on 4 November.** U6 continues on the same branch.

## Where the tasks stand

| Task | State |
| --- | --- |
| U1 Lint plugin | Merged earlier (#210) |
| U2 Screen audit | Merged earlier (#211, with the date fixes in #212) |
| **U3 Direction and mockups** | **Done. George approved it on 4 November, taking the recommended answers.** |
| **U4 Theme refresh and mobile primitives** | **Done. George signed off the screenshots on 4 November.** |
| **U5 Navigation** | **Done. George signed off the screenshots on 4 November; merged in #213 with U3 and U4.** |
| **U6 Quick add and the fast expense form** | **In progress in this session.** |
| U7 onwards | Not started. |

## What U3 added

An opus agent did the work, as the plan says for design tasks. I finished the screenshots,
checks, commit and push myself.

- **`docs/ui-direction.md`** covers:
  - density, hierarchy, one primary action per screen, progressive disclosure;
  - sheet vs. page, row actions, tap targets, copy tone;
  - the radius and spacing steps, and the motion list with a token for each animation;
  - the differences from the signed-off HTML mockup, and the checkpoint questions.
- **Mockups at `/dev/preview/mockups`** (an index page with every tap count). They use fixtures
  only and save nothing. The screens are:
  - `home`;
  - quick add: `quick-add-expense`, `-todo`, `-reminder`, `-event`;
  - `money-expenses`;
  - `planning-reminders`, `planning-todos`;
  - `more`, `settings-account`, `settings-notifications`, `settings-family`.

  The values proposed for U4 live in `src/app/dev/preview/mockups/proposed-theme.ts`. The theme
  tokens are unchanged.
- **Motion sample at `/dev/ui#motion`** shows each animation, with a switch that simulates
  reduced motion.
- **24 screenshots** (390 and 1280 px) in `docs/ui-styling/screenshots/u3-*.jpg`.
- **Checks:** lint has 0 errors and the same 5 `local/motion-tokens` warnings as before;
  `tsc --noEmit` is clean; vitest passes 6283 tests (1 skipped).

## Differences from the signed-off HTML mockup

- Four radius steps (10 / 16 / 22 / pill), the same on desktop as on phones.
- Type stays in the existing scale: the Home total is 28 px and the quick-add amount is 40 px.
- The save check pops in (scale and fade) instead of drawing its stroke.
- Home's month card has no daily bars.
- Home's reminder rows have Snooze next to Done.
- On phones, Money and Planning rows get a `⋯` menu as well as the swipes.
- Money shows a one-line total and groups rows by day.
- Notifications is higher up in the Settings list.
- The quick-add To-do takes 3 taps, not the plan's 2.

## Questions for George (the U3 checkpoint, now decided)

George approved U3 and took the recommended answer for each question below. The answers are
recorded under "Decisions" in `docs/ui-direction.md`. Only questions 1 and 4 named an explicit
recommendation; for the other eight, the answer recorded is what the doc and mockups show.


1. Should desktop use the same radii as phones?
2. Is 40 px right for the quick-add amount?
3. Should quick add remember the last kind used?
4. On Money, should the member picker be a "Me ▾" menu or chips?
5. To-dos on phones: one column at a time, or columns that scroll sideways?
6. Where does Insights (the old dashboards) go?
7. What should a quick-add Event default to?
8. Calendar on phones: Agenda or Week?
9. Should the sheet close in 300 ms or 200 ms?
10. Is a kid-account mockup needed?

## Found along the way

- **Status backgrounds had no fill in production.** The raw `status.*Bg` tokens and the semantic
  `status.*.bg` tokens compiled to the same CSS variable, which ended up referring to itself. So
  `StatusBadge`, `InlineAlert` and the `bg.error|success|warning|info` surfaces rendered
  transparent. **U4 fixed it:** the raw colours are renamed `signal.*` (values unchanged), and a
  test fails if two tokens share a CSS variable or one refers to itself. The separate suggested
  task is no longer needed.

## What U4 added

An opus agent did the work, as the plan says for this task. It pushed seven commits, from
`83f7b94` to `934669f`.

- **Theme:**
  - the radii from the direction doc, and page spacing per breakpoint;
  - motion tokens and keyframes in `theme/motion.ts`;
  - press feedback in the button, chip and row recipes;
  - 44 px controls and fields on phones;
  - a single `prefers-reduced-motion` block in `global-css.ts`, and a `useReducedMotion()` hook;
  - colours unchanged.
- **`AppDialog`** is a bottom sheet below `md` and a centred dialog above it, with the same props,
  so every existing dialog changes without edits. `ConfirmDialog` is a sheet on phones too.
  - A form with unsaved changes asks "Discard your changes?" before it closes.
  - New optional props: `pending` and `dirty`.
  - It's built on Chakra's `Dialog` with a responsive recipe rather than `Drawer`, so rotating a
    phone doesn't remount the form.
- **New primitives:** `ActionBar`, `RowActions` (a `⋯` menu, plus long-press on phones),
  `UndoToast` with `useUndo()`, `AmountInput` (decimal keypad, two decimals at most),
  `ToggleChip`, `Disclosure`, `Collapse` and `IconTile`.
- **Lint:** `local/motion-tokens` is now an error, with its 5 warnings fixed. New rule:
  `local/no-reduced-motion-query`.
- The gallery and the U3 mockups now use the real theme and primitives; the U3 proposals file is
  deleted.
- **Screenshots:** `docs/ui-styling/screenshots/u4-*-{390,1280}.jpg` (gallery motion, gallery
  mobile, gallery sheet, dashboard, expenses, add-expense sheet, reminders, reminder dialog). All
  the U3 mockups were taken again on the real theme.
- **Checks:** lint has 0 errors and 0 warnings; `tsc` is clean; vitest passes 6334 tests
  (1 skipped; 6283 before). The existing dialog tests pass untouched.
- **Testing limits:** the tests have no jsdom, so "focus trapped and restored" is checked through
  the props given to Zag. Focus, the discard prompt and swipe-to-close were also checked by hand
  in Playwright.

### Left over from U4 (good first steps for a later task)

- Remove the 15 hand-written pending guards in dialogs now that `AppDialog` has `pending`, and
  add a `local/no-dialog-pending-guard` rule.
- Move the chips in 6 files to `ToggleChip`, and add a `local/no-raw-toggle-button` rule.
- A `DataGate` helper.

### What George signed off for U4

- 44 px buttons and fields on phones.
- Cards without borders, and list rows without lines.
- How the sheets look, and the "Discard your changes?" prompt.
- The 8 decisions that were inferred from the doc and mockups (above).

## What U5 added

A sonnet agent did the work, as the plan says for this task.

- **Bottom bar:** Home, Money, **+**, Planning, More, with labels, fitting at 320 px. The tabs follow
  `navigationFor`, so Money is missing for a kid with every money module off. A sliding indicator
  marks the active tab, which now matches on sub-paths (`/expenses/import` is Money). The phone
  header with only the logo is gone, as in the mockups.
- **+ and Add:** one `QuickAddProvider` in the shell. Both the bar's **+** and a new **Add** button
  at the top of the sidebar open a placeholder `AppDialog` that links to the pages that add things
  today, until U6.
- **Money and Planning:** a segmented control (`SectionNav`, rendered by the shell) switches pages at
  their existing URLs; no route moved. A section with one visible page shows no control.
- **Sidebar:** the same groups (Home, Money, Planning, More), 240 px wide.
- **More** is a page at `/more` (profile, the settings list, install, sign out); desktop sends it to
  `/settings`. **Settings** is one grouped list (Account, Family, AI) with the open page beside it
  from `md` up, and a way back to More on phones. The seven tabs are gone; every settings URL still
  works, and parent-only and family-only rows still follow the same rules.
- **Code:** `nav-items.ts` is one table of four sections and `navigationFor` the one source (the
  `TAB_BAR_ITEMS`, `MORE_*` constants and the More sheet are deleted). `useAppPathname()` lets the
  preview highlight the right page; `/dev/preview/more` is new.
- **Screenshots:** `docs/ui-styling/screenshots/u5-{home,money,planning,more,settings,settings-notifications}-{320,390,1280}.jpg`
  (no `more` at 1280, which is Settings) and `u5-sidebar-1280.jpg`.
- **Checks:** lint 0 errors and 0 warnings; `tsc` clean; vitest 6362 passed (1 skipped).

### Left over from U5

- Insights as a fourth Money segment waits for U7 (the dashboards still live at Home).
- The quick-add forms and the `N` shortcut are U6's.
- At 320 px the Reminders rows overflow the page by 3 px (the edit icon); that is the screen's own
  layout, for the Planning screen task.

## Next steps

1. Finish U6, the quick-add sheet and the fast expense form (opus).
