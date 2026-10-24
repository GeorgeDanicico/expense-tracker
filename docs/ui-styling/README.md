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

## To-do board (family T5)

`todo-board-*.jpg`, captured with the in-app browser at a 1280 × 800 viewport (saved at
800 × 500, the pane's screenshot size) from `/dev/preview/todos`, whose cards and writes are kept
in memory (`src/app/dev/preview/todo-fixtures.ts`).

| Image | Shows |
|---|---|
| `todo-board-1280-light.jpg` | The board: counts, an overdue due date in red, assignee avatars, "Show older" |
| `todo-board-1280-dark.jpg` | The same with `prefers-color-scheme: dark`; the app forces its light theme, so it matches |
| `todo-board-mouse-drag-1280.jpg` | A mouse drop: "Call grandma" settling into In progress, position 2 |
| `todo-board-quick-add-1280.jpg` | Quick add after Enter: the new card at the top of To do, the field still open |
| `todo-board-edit-dialog-1280.jpg` | The card dialog: title, notes, assignee, due date, delete |
| `todo-board-delete-confirm-1280.jpg` | The delete confirmation |
| `todo-board-move-rolled-back-1280.jpg` | `?failMoves=1`: a refused move went back, with the notice |

## To-do board filters, phones and nav (family T6)

Same capture as T5, from `/dev/preview/todos`: 1280 × 800 (saved at 800 × 500) and 390 × 844
(saved at 390 × 844 or 780 × 1688). `?noFamily=1` previews an account without a family.

| Image | Shows |
|---|---|
| `todo-board-filter-me-1280.jpg` | `?member=me`: the Me chip, "Showing 3 of 9 cards", counts for the filtered view, after a keyboard move within the filtered To do column |
| `todo-board-filter-member-overdue-1280.jpg` | `?member=m-maria&due=overdue`: a member chip combined with Overdue |
| `todo-board-phone-390.jpg` | The phone board: chips, the To do / In progress / Done switcher, one column, "Move to…" on each card |
| `todo-board-move-to-menu-390.jpg` | The "Move to…" menu on a card, listing the other two columns |
| `todo-board-phone-done-after-moves-390.jpg` | Done after "Move to… Done" (Buy milk at the top) and a long-press touch drag within the column (Return the library books to the top) |
| `todo-nav-more-sheet-390.jpg` | The More sheet for a family member: To-dos in a Family section |
| `todo-nav-no-family-390.jpg` | `?noFamily=1`: no Family section in the More sheet, and the board's "join a family" state |
| `todo-nav-no-family-1280.jpg` | `?noFamily=1`: no Family section in the sidebar |
