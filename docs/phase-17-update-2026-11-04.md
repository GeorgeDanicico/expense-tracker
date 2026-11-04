# Phase 17 update, 4 November 2026 (cloud session)

Work for [the phase 17 plan](ui-plan.md), on branch `claude/phase-17-cloud-session-rk7uoj`.
**No PR is open yet.**

## Where the tasks stand

| Task | State |
| --- | --- |
| U1 Lint plugin | Merged earlier (#210) |
| U2 Screen audit | Merged earlier (#211, with the date fixes in #212) |
| **U3 Direction and mockups** | **Done in this session. Pushed, waiting for George's checkpoint.** |
| U4 onwards | Not started. The plan blocks building until George signs off U3. |

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

## Questions for George (the U3 checkpoint)

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

## Found along the way (not fixed here)

- **Status backgrounds have no fill in production.** The raw `status.*Bg` tokens and the
  semantic `status.*.bg` tokens compile to the same CSS variable, which ends up referring to
  itself. So `StatusBadge`, `InlineAlert` and the `bg.error|success|warning|info` surfaces render
  transparent. It's queued as a separate suggested task.

## Next steps

1. George reviews the screenshots (or runs `/dev/preview/mockups` locally) and answers the
   questions above.
2. Open a PR from `claude/phase-17-cloud-session-rk7uoj` to `main`. It only touches `/dev`
   routes and docs, plus exporting `CATEGORY_ICONS`.
3. Then U4, the theme refresh and mobile primitives (opus), starting from `proposed-theme.ts`
   and the checkpoint answers.
