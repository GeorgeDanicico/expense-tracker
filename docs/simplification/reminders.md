# Simpler ways: reminders

Looked at `src/components/reminders/**` (8 files, ~1,600 lines without tests), `src/app/(app)/reminders`, `src/app/api/reminders/**`, `src/lib/reminders/**` (~880 lines), `src/lib/validation/reminder.ts`, `src/lib/mcp/tools/reminders.ts` and the reminder preview fixture, with the `find-shapes` script (bare module name `reminders`) and by reading the screen, the row, the dialog and `src/lib/reminders`. **Reminders already use the target data style** (`reminder-api.tsx` + `use-reminders.ts`, optimistic, previewable), so the proposals are about helpers written twice: 5 proposals, about 45 lines. The one worth doing first is **one `daysBetween` and `monthsBetween`** (proposal 1), with a lint rule so hand date maths stops spreading.

## Map

| File | Lines | Role |
| --- | --- | --- |
| `reminders-screen.tsx` | 321 | Upcoming / Overdue / Done segmented control, the list, focus from a notification, dialogs. |
| `reminder-row.tsx` | 281 | Row with Mark done, the Snooze menu (an hour, tomorrow 09:00, choose a time) and Edit. |
| `reminder-dialog.tsx` | 462 | Add and edit: title, notes, first date, time, repeat, notify-me chips, mute, expense template. |
| `log-expense-dialog.tsx`, `snooze-dialog.tsx` | 163, 87 | Marking done with an expense; snooze until a chosen time. |
| `use-reminders.ts`, `reminder-api.tsx`, `use-reminder-badge.ts` | 176, 65, 55 | Data: SWR plus optimistic writes; the nav badge. |
| `src/lib/reminders/*` | ~880 | Schedule maths, formatting, notifications, the service shared by REST and MCP. |

Counts: `daysBetween` written 3 times (2 here, 1 in calendar) and `monthsBetween` twice (once here, once in `src/lib/calendar.ts`); 14 hand-built `T00:00:00Z` / `T12:00:00` date parses outside `src/lib/calendar.ts` across the repo (3 here); `useNow` 3 times; `defaultDoneSince` twice (here and to-dos); 1 `matchMedia("(prefers-reduced-motion…)")`; 3 hand-written route context types.

## Proposals

| # | Proposal | Lines saved | Risk | Files |
|---|---|---|---|---|
| 1 | One `daysBetween` / `monthsBetween` in `src/lib/calendar.ts` | ~12 | Low | 4 |
| 2 | One `defaultDoneSince(days)` shared with to-dos | ~5 | Low | 3 |
| 3 | Share `useNow` (see the expenses report, proposal 7) | ~12 across the repo | Low | 3 |
| 4 | The notify-me chips use the shared `ToggleChip` (see the layout report) | ~10 | Low | 1 |
| 5 | Use `RouteContext` in the three `[id]` routes | ~3 | Low | 3 |

### 1. One `daysBetween` and `monthsBetween`

**Why.** `src/lib/reminders/schedule.ts:42`, `src/lib/reminders/notification.ts:27` and `src/lib/family-calendar/series.ts:49` each define the same `daysBetween(a, b)` (`Math.round((Date.parse(\`${b}T00:00:00Z\`) - Date.parse(\`${a}T00:00:00Z\`)) / DAY)`). `schedule.ts:46` re-writes `monthsBetween`, which `src/lib/calendar.ts:58` already exports. `calendar.ts` already holds `addDays` and the other pure date maths.

**Before**
```ts
function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (24 * HOUR));
}
```

**After**
```ts
import { daysBetween, monthsBetween } from "@/lib/calendar";
```

**Files.** `calendar.ts` (+1 export), `schedule.ts`, `notification.ts`, `family-calendar/series.ts`. **Lines saved.** ~12. **Risk.** Low: pure, same formula. **Proof.** `src/lib/reminders/schedule.test.ts`, `notification.test.ts`, `src/lib/family-calendar/series.test.ts`, `src/lib/calendar.test.ts`; `npm test`. A lint rule (`local/no-hand-date-parse`, in the audit's candidates) keeps new ones out.

### 2. One `defaultDoneSince`

**Why.** `src/lib/reminders/service.ts:46` and `src/lib/todos/service.ts:22` are the same function over each module's own `DONE_WINDOW_DAYS` (both 30). One `doneSince(days, now)` in `src/lib/calendar.ts` (or `src/lib/utils`) with each module keeping its constant.

**Lines saved.** ~5. **Risk.** Low. **Proof.** Both services' tests.

### 3–5

- **`useNow`**: `use-reminders.ts:25` is the one with an interval; see the expenses report.
- **Chips**: `LeadTimeChips` in `reminder-dialog.tsx:211` is one of six hand-made `aria-pressed` button groups; see the layout report's `ToggleChip`.
- **`RouteContext`**: `ReminderRouteContext`, `SnoozeRouteContext`, `CompleteRouteContext` (`src/app/api/reminders/[id]/**`).

## Found on the way (for U10, U12)

- **"Snooze for an hour" can end before the reminder is due.** `snoozeEnd` (`src/lib/reminders/schedule.ts:143`) returns `now + 1 h` whatever the due time. In the preview, "Pay the rent" (due 02:35, shown as "Today") snoozed at 00:35 became "Snoozed until 01:35": a snooze that moves the reminder earlier. Either offer Snooze only once something is due or overdue (the row's main use), or snooze to `max(now, dueAt) + 1 h`. A product call for U10.
- **Overdue reminders are on their own tab.** Upcoming leaves them out, so marking an overdue one done is a tap more than an upcoming one (More → Reminders → Overdue → Mark done). U7's Home and U10's grouping ("today, upcoming, done") should put overdue first, on the same list.
- **The new-reminder default is today at 09:00**, which is in the past from 09:00 on: an afternoon reminder needs its date changed. The plan's "tomorrow 9:00" fixes it.
- **`scrollToReminder` reads `matchMedia` itself** (`reminders-screen.tsx:71`); U4 replaces it with the shared reduced-motion hook, and `reminder-row.tsx` has one of the five literal transitions `local/motion-tokens` still warns about.

## Tidy-ups

- `restReminderApi`, `REMINDER_TAB_LABELS`, `FOCUS_HIGHLIGHT_MS`, `REMINDER_BADGE_REFRESH_MS`, `REMINDERS_REFRESH_MS`, `NOW_TICK_MS`, `DONE_WINDOW_DAYS` and several types are exported but used only in their own file (or only by its test): keep `export` where a test needs it, drop it otherwise.
- `src/components/reminders/log-expense.test.tsx:44` and `reminders-badge-refresh.test.tsx:39` define the same `wrap` helper: move it to `src/test/`.
- `plural` is written twice (`src/lib/reminders/format.ts:69`, `src/lib/family/last-active-label.ts:15`) with different outputs ("3 days" vs "3 days ago"); fine as they are.

## Considered and rejected

- **One generic optimistic-list helper for reminders and to-dos** (`upsertReminder` / `upsertTodo` have the same shape): the sort orders and states differ; a generic would be harder to read than two 10-line functions.
- **Merging the repositories' `delete` methods** (reminders and to-dos clone each other): repositories are the test seam; keep them explicit.

## Already simple

- `reminder-api.tsx` + `use-reminders.ts` are the pattern U8–U11 copy.
- `src/lib/reminders/schedule.ts` is pure and well tested.
