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
| `todo-board-phone-390.jpg` | The phone board: whose-cards chips in one sideways-scrolling row, the due chips in a second, the To do / In progress / Done switcher, one column, "Move to…" on each card |
| `todo-board-chips-scrolled-390.jpg` | The chip row scrolled to its end (Unassigned); the page itself doesn't scroll sideways |
| `todo-board-move-to-menu-390.jpg` | The "Move to…" menu on a card, listing the other two columns |
| `todo-board-phone-done-after-moves-390.jpg` | Done after "Move to… Done" (Buy milk at the top) and a long-press touch drag within the column (Return the library books to the top) |
| `todo-board-quick-add-prefill-390.jpg` | Quick add under Ana + Due today: the new card is assigned to Ana, due today, and stays in view |
| `todo-board-quick-add-hidden-notice-390.jpg` | Quick add under Overdue: "Added — hidden by the Overdue filter." instead of the card silently vanishing |
| `todo-board-focus-after-move-390.jpg` | After "Move to…" on the last card, focus is on the card above it |
| `todo-board-focus-empty-column-390.jpg` | After moving a column's only card away, focus is on its "Add a card" |
| `todo-nav-more-sheet-390.jpg` | The More sheet for a family member: To-dos in a Family section |
| `todo-nav-no-family-390.jpg` | `?noFamily=1`: no Family section in the More sheet, and the board's "join a family" state |
| `todo-nav-no-family-1280.jpg` | `?noFamily=1`: no Family section in the sidebar |

## Reminders page (reminders R5)

Captured with the in-app browser from `/dev/preview/reminders`, whose reminders and writes are kept
in memory around the current time (`src/app/dev/preview/reminder-fixtures.ts`): 1280 × 800 (saved
at 800 × 500) and 390 × 844. `?failWrites=1` refuses every mark done and snooze; `?noReminders=1`
starts empty. The page isn't linked from the navigation yet (R9).

| Image | Shows |
|---|---|
| `reminders-upcoming-1280-light.jpg` | Upcoming: "Pay the rent" due today at the top, highlighted, with a Today badge; a snoozed reminder with its snooze; a muted one; the repeat of each |
| `reminders-upcoming-1280-dark.jpg` | The same with `prefers-color-scheme: dark`; the app forces its light theme, so it matches |
| `reminders-monthly-done-1280.jpg` | After Mark done on the monthly "Pay the rent": it moved from Sun 25 Oct to Wed 25 Nov |
| `reminders-overdue-1280-light.jpg` | Overdue with its count: "2 days late", "3 hours late" |
| `reminders-snooze-menu-1280.jpg` | Snooze: for an hour, until tomorrow 09:00, or a chosen time |
| `reminders-done-1280-light.jpg` | Done: the completions of the last 30 days, with the occurrence and what's next |
| `reminders-edit-dialog-1280.jpg` | The edit dialog: title, notes, first date, time, repeat with interval, lead-time chips (three chosen, the rest disabled), mute, delete |
| `reminders-delete-confirm-1280.jpg` | The delete confirmation |
| `reminders-rolled-back-1280.jpg` | `?failWrites=1`: a refused mark done went back, with the notice |
| `reminders-upcoming-390-light.jpg` | The phone width: the actions wrap under each row; no sideways scroll |
| `reminders-add-dialog-390.jpg` | The add dialog as a bottom sheet at 390 px |
| `reminders-overdue-390-dark.jpg` | Overdue at 390 px in dark (forced light), including a reminder just added for 09:00 today |

## Reminders nav, badge and phones (reminders R9)

Captured with headless Chrome (driven over the DevTools protocol) from `/dev/preview`, whose
reminders are kept in memory around the current time (`src/app/dev/preview/reminder-fixtures.ts`),
so the badge counts the fixtures' due and overdue reminders: 1280 × 800 at 1× and 390 × 844 at 2×.
The Next.js dev indicator was removed before each capture.

| Image | Shows |
|---|---|
| `reminders-nav-sidebar-badge-1280.jpg` | The sidebar's Planning section (Reminders, then To-dos) with the badge on Reminders, red because something is overdue |
| `reminders-nav-sidebar-no-family-1280.jpg` | `?noFamily=1`: Planning with Reminders only; no To-dos |
| `reminders-nav-tab-bar-badge-390.jpg` | The bottom bar: Reminders lives in the More sheet, so More carries the count |
| `reminders-nav-more-sheet-390.jpg` | The More sheet: Planning with Reminders (badged) and To-dos |
| `reminders-phone-upcoming-390.jpg` | The reminders page at 390: Upcoming / Overdue · 2 / Done as a segmented control, each row's actions on their own line |
| `reminders-phone-overdue-390.jpg` | Overdue on the phone, after switching segments |
| `reminders-add-sheet-390.jpg` | The add form as a full-height sheet at 390: the footer stays at the bottom, the body scrolls |
| `reminders-add-dialog-1280.jpg` | The same form at 1280: still the centred dialog |

## Reminders: log as expense (reminders R12)

Captured with headless Chrome (driven over the DevTools protocol) from `/dev/preview/reminders`,
whose "Pay the rent" and "Electricity bill" fixtures carry an expense template
(`src/app/dev/preview/reminder-fixtures.ts`): 1280 × 800 at 1× and 390 × 844 at 2×. The Next.js
dev indicator was removed before each capture.

| Image | Shows |
|---|---|
| `reminders-expense-section-1280.jpg` | The edit form scrolled to its optional Expense section: the switch, the amount in the account's currency, and the expense form's category picker; a form taller than the screen now scrolls the whole dialog instead of running under the footer |
| `reminders-expense-section-390.jpg` | The same section in the full-height sheet at 390: the body scrolls, the footer stays at the bottom |
| `reminders-log-expense-confirm-1280.jpg` | Mark done on "Pay the rent": the expense pre-filled for the occurrence (description, category, date, editable amount), with "Just mark done" and "Log expense and mark done" |
| `reminders-log-expense-confirm-390.jpg` | The confirm as a bottom sheet at 390, its two answers stacked with the primary on top |
| `reminders-done-expense-logged-1280.jpg` | Done after logging: "Expense logged" on the completions with an expense, linking to that month's expenses |

## Calendar page (family C5)

Captured with the in-app browser from `/dev/preview/calendar`, whose events and writes are kept in
memory around today (`src/app/dev/preview/calendar-fixtures.ts`, which runs the same `seriesRows`
and `editedRows` as the service): 1280 × 800 (saved at 800 × 500, the first at 800 × 563) and
390 × 844 (saved at 468 × 1012). `?failWrites=1` refuses every write after 500 ms, so the optimistic
change and its rollback can be seen; `?noFamily=1` previews an account without a family. The page
isn't linked from the navigation yet (C6). The dark capture has `prefers-color-scheme: dark`
emulated; the app forces its light theme, so it matches the light one.

| Image | Shows |
|---|---|
| `calendar-month-1280-light.jpg` | Month: six weeks from Monday, today filled, chips in the attendee's colour, a neutral chip with colour dots for several attendees, "+3 more", a 4-day all-day bar crossing two week rows |
| `calendar-month-1280-dark.jpg` | The same with dark colour scheme emulated (the app stays light) |
| `calendar-agenda-1280.jpg` | Agenda: the next 60 days by day, "from 20:00" / "until 10:00" for an event across midnight, "3 of 8" on a series, avatars |
| `calendar-add-dialog-1280.jpg` | The add form with a weekly repeat: who's going (Just me by default), "for N weeks" and where the repeat ends |
| `calendar-series-6-weeks-1280.jpg` | A 6-week series created from the form: Wed 4 Nov to Wed 9 Dec (the last two are below the grid) |
| `calendar-edit-scope-1280.jpg` | Save on the 3rd of 6: "This event / This and following events / All events", each with how many it reaches |
| `calendar-moved-one-1280.jpg` | "This event": only the 3rd occurrence moved, from Wed 18 to Thu 19 Nov |
| `calendar-following-time-1280.jpg` | "This and following": the 4th and later occurrences now at 10:00; the earlier ones, and the moved one, stay at 09:00 |
| `calendar-delete-scope-1280.jpg` | Delete on the 5th of 6 asks the same question, with the danger tone |
| `calendar-deleted-all-1280.jpg` | After "All events": all six occurrences gone, the moved one included |
| `calendar-day-dialog-1280.jpg` | "+3 more" opened: the day's six events in full, with Add event |
| `calendar-rolled-back-1280.jpg` | `?failWrites=1`: the refused delete's error in its dialog (the event went back to the grid) |
| `calendar-month-390.jpg` | The phone width: the grid fits with no sideways scroll; the phone layout proper is C6 |
