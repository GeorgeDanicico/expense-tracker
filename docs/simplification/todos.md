# Simpler ways: to-dos

**Status (U10, 4 November 2026):** proposal 2 (`TodoQuickAdd` on `useApiForm`) done. The shared family helpers (proposal 1) are left: they touch the filter, dialog and member files U10 did not rebuild.

Looked at `src/components/todos/**` (9 files, ~1,300 lines without tests), `src/app/(app)/todos`, `src/app/api/todos/**`, `src/lib/todos/**` (~550 lines), `src/lib/validation/todo.ts`, `src/lib/mcp/tools/todos.ts`, `src/lib/supabase/repositories/todos.ts` and the to-do preview fixture, with the `find-shapes` script (`todos`) and by reading the screen, board, card, dialog and quick add. **To-dos already use the target data style** (`todo-api.tsx` + `use-todo-board.ts`, optimistic, previewable). Most of the repetition is **shared with the calendar**: the member chips, the member name, the "no family" screen and the family read. 5 proposals, about 70 lines across the two modules; the first is **one set of family helpers for To-dos and Calendar** (proposal 1).

## Map

| File | Lines | Role |
| --- | --- | --- |
| `todo-board-screen.tsx` | 188 | Header, filter chips (in the URL), the board, the card dialog, `?card=` from a notification. |
| `todo-board.tsx` | 412 | Three columns (one at a time on a phone, behind a segmented control), drag and drop with dnd-kit, the "Move to…" menu. |
| `todo-card.tsx`, `todo-dialog.tsx`, `todo-quick-add.tsx`, `todo-filters.tsx` | 94–187 | Card, edit dialog (with Delete → confirm), "Add a card", member and due chips. |
| `use-todo-board.ts`, `todo-api.tsx`, `use-linked-card.ts` | 122, 54, 39 | Data and the notification link. |

Counts, shared with `src/components/family-calendar`: `Chip` 3 identical copies (`todo-filters.tsx:16`, `member-chips.tsx:16`, `event-dialog.tsx:76`); `memberLabel` / `memberName` 2 here and 16 `displayName ?? username` expressions app-wide; `NoFamilyBoard` and `NoFamilyCalendar` the same component with other words; `useSWR<FamilyResponse>(… FAMILY_API_KEY …)` 7 times app-wide (2 here and in the calendar). One component keeps `pending` / `error` by hand (`todo-quick-add.tsx`).

## Proposals

| # | Proposal | Lines saved | Risk | Files |
|---|---|---|---|---|
| 1 | Shared family helpers: `ToggleChip`, `memberDisplayName`, `NoFamilyState`, `useFamily` | ~45 (with the calendar) | Low | 7 |
| 2 | `TodoQuickAdd` on `useApiForm` | ~8 | Low | 1 |
| 3 | One `defaultDoneSince` (see the reminders report) | ~5 | Low | 2 |
| 4 | One `find` in the calendar and to-do fakes | ~8 | Low | 3 |
| 5 | `RouteContext` in `todos/[id]` and `todos/[id]/move` | ~2 | Low | 2 |

### 1. Shared family helpers

**Why.** The to-do board and the calendar grew side by side and copied each other's small parts.

- `Chip` (a `Button` with `aria-pressed`, `solid`/`outline`, `brand`) is identical in three files. The same pattern appears in `viewing-picker.tsx`, `reminder-dialog.tsx` (`LeadTimeChips`) and `permissions-editor.tsx`. A `ToggleChip` in `src/components/ui` (the layout report's proposal) is one place for its 44 px touch size in U4.
- `memberLabel(member)` here and in `member-chips.tsx`, `memberName(member)` in `todo-dialog.tsx` and `event-dialog.tsx`: `member.displayName ?? member.username ?? "Unnamed"` (or `"Family member"`). One `memberDisplayName(member, fallback)` in `src/lib/family/`.
- `NoFamilyBoard` (`todo-board-screen.tsx:39`) and `NoFamilyCalendar` (`calendar-screen.tsx:67`) differ in the icon, the title and one sentence. One `NoFamilyState({ icon, title, description })` in `src/components/family`.
- `useSWR<FamilyResponse>(hasFamily ? FAMILY_API_KEY : null)` in both screens; a `useFamily()` hook like `useAccount()` (the family report's proposal 1).

**Before**
```tsx
function memberLabel(member: FamilyMemberView) {
  return member.displayName ?? member.username ?? "Unnamed";
}
```

**After**
```tsx
import { memberDisplayName } from "@/lib/family/member-name";
```

**Files.** `todo-filters.tsx`, `todo-dialog.tsx`, `todo-board-screen.tsx`, `member-chips.tsx`, `event-dialog.tsx`, `calendar-screen.tsx`, plus the new helpers. **Lines saved.** ~45. **Risk.** Low: labels stay the same (keep each fallback word). **Proof.** `src/components/todos/todo-board.test.tsx`, `src/components/family-calendar/family-calendar.test.tsx`; `npm test`, `npm run lint`.

### 2. `TodoQuickAdd` on `useApiForm`

**Why.** `todo-quick-add.tsx` keeps `pending` and `error` with `useState` and a `try/finally`; `useApiForm` (`src/hooks/use-api-form.ts`) does exactly that and is used by 39 files. It also returns the `notice` the board passes back, which can stay a small state of its own.

**Lines saved.** ~8. **Risk.** Low. **Proof.** `todo-board.test.tsx` (quick add cases).

### 3. One `defaultDoneSince`

`src/lib/todos/service.ts:22` and `src/lib/reminders/service.ts:46` are the same; see the reminders report.

### 4. One `find` in the in-memory fakes

`src/test/fakes/todos.ts:164` and `src/test/fakes/calendar.ts:168` are identical; the two fake test files share a `beforeEach`, and `src/lib/mcp/tools/todos.test.ts:30` and `calendar.test.ts:36` share another. Move them to `src/test/`. Test-only, ~8 lines.

### 5. `RouteContext`

`TodoRouteContext` and `MoveRouteContext` in `src/app/api/todos/[id]/**`; see the expenses report.

## Found on the way (for U10, U12)

- **Deleting a card takes 3 taps on the screen** (open the card, Delete, "Delete card"), plus 2 to reach To-dos. The plan's swipe with undo (U12) replaces the confirm.
- **"Add a card" works well already**: one tap opens a focused field, Enter adds and keeps it open for the next one (measured in `/dev/preview/todos`). The quick-add sheet (U6) should reuse `TodoQuickAdd`'s behaviour rather than a second form.
- **The columns are already one at a time on a phone**, behind a To do / In progress / Done segmented control; U10's "columns scroll sideways" would replace a working pattern, so check it against the mockup.

## Tidy-ups

- `patchValues` in `src/lib/supabase/repositories/todos.ts:73` and `notification-settings.ts:18` have the same shape (map defined fields to columns); fine as two, since the keys differ.
- `restTodoApi`, `TodoBoardProps`, `assigneeName`, `BOARD_REFRESH_MS`, `compareTodos`, `TODO_MEMBER_PARAM`, `TODO_DUE_PARAM`, `POSITION_ATTEMPTS`, `ANCHOR_GONE_MESSAGE` are exported but only used in their own files (or tests).

## Considered and rejected

- **A generic optimistic list for to-dos and reminders**: see the reminders report.
- **Replacing dnd-kit**: it is the one gesture library already in use; U12 builds swipes alongside it.

## Already simple

- `todo-api.tsx` and `use-todo-board.ts`: the reference for the D6 conversions.
- `src/lib/todos/position.ts` and `board.ts`: pure, tested.
