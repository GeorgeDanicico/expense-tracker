# To-do board plan (family hub phase 4)

This plan covers the family to-do board: one kanban board per family with three fixed columns,
**To do**, **In progress** and **Done**, where cards are dragged between and within columns, and
chips filter the board to one member's cards. It replaces steps 4.1–4.5 in
[family-hub-roadmap.md](family-hub-roadmap.md). Recurring to-dos (4.5) are not planned.

## The design in one page

| Question | Answer |
| --- | --- |
| Who has a board? | **Every family has exactly one.** There's no board table: each card belongs to a family through `todos.family_id`. A user without a family has no board; the nav item is hidden and `/todos` shows a link to Settings → Family. |
| Who sees the board? | **Every member of the family**, parents and kids alike. There are no private or parents-only cards. |
| Is there a kid permission? | **No.** To-dos aren't a permission module: every member uses the board, the same as reminders will. |
| What's on a card? | Title (≤ 200 chars), notes (≤ 2,000), status, position, an optional assignee (any member of the family), an optional due date (a plain date, Europe/Bucharest), who created it and when it was completed. |
| Who can do what? | **Every member can do everything** on every card of their family's board: add, edit, assign, move and delete, whoever created it. Parents and kids are treated the same. |
| How do I see one member's to-dos? | Chips above the board: **Everyone**, **Me**, one chip per member (avatar and colour, as on the finance pages), and **Unassigned**. They filter by assignee. Two more chips, **Due today** and **Overdue**, combine with them. Filters are client-side and kept in the URL (`?member=`, `?due=`). |
| How is order stored? | `position` is a **fractional-index key** (text, the `fractional-indexing` approach). A move rewrites only the moved card's row. The server, not the client, computes the key from the card's new neighbours. Filtering doesn't change positions: the board always orders cards the same way, and a filtered view just hides some. |
| What happens in Done? | `completed_at` and `completed_by` are set when a card enters Done and cleared when it leaves (a trigger, so every path agrees). The Done column shows the last **30 days**; older cards stay in the table behind "Show older". |
| How is access enforced? | **RLS** limits every row to the caller's family, and that's the only rule. Another family's card is invisible (404). |
| What happens when a member leaves? | Cards assigned to them become unassigned (`on delete set null` on their membership). Cards they created stay on the board, with no creator. Deleting the family deletes every card. `remove_family_member` and `delete_family` don't change. |
| Live updates? | No realtime channel (the browser never talks to Supabase). The board revalidates on focus and every **15 seconds while visible** through SWR. |
| Feature flag? | **None.** The task order keeps half-built work out of sight instead: the API and the page land first with no link to them, and the nav item lands last, once the phone layout is done. Routes call `requireFamilyFeature()`, like every family route. |
| MCP | `list_todos`, `add_todo`, `move_todo`, `update_todo`, `delete_todo`. They act as the caller, so RLS keeps them to the caller's family. Kids still need the `mcp` permission to use MCP at all. |
| Notifications | None in this phase. "A card was assigned to you" is roadmap step 5.8, once the outbox exists. |

### Moving a card

```
Client  ──POST /api/todos/<id>/move { status, beforeId | null, afterId | null }──▶ route
  route: auth → family feature → load card (RLS)
         → load neighbours; both must be in the caller's family, in `status`, and adjacent
           (nothing between them) — otherwise 409 { error } so the client re-syncs
         → key = generateKeyBetween(before.position, after.position)
         → update status + position
           · unique (family_id, status, position) violated by a racing move → re-read, retry (≤ 3)
         → 200 { todo }
```

`beforeId` is the card that will sit **above** the moved card, `afterId` the one **below**. Both
`null` means an empty column. In a filtered view the client sends the nearest visible neighbours;
the server accepts them only if nothing hidden sits between them, and otherwise answers 409, so
moves in a filtered view fall back to "drop at the top or bottom of the column" (see T5).

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Boards | One per family, no board table | Decided. Member chips cover "show me Ana's to-dos" without a second level of structure. |
| Kid permission | None | Decided. Every member uses the board. |
| Who can change a card | Every family member, any card | Decided. A shared family board doesn't need per-card rules, and dropping them removes a trigger, a rules module and most of the per-role tests. A kid could delete a parent's card; that's accepted. |
| Feature flag | None; nav item last | Decided. Nothing is linked until it's finished, and API routes without a page are harmless behind RLS. A general feature-flag system would be its own task if it's ever wanted. |
| Recurring to-dos | Not planned | Decided. |
| Done column window | 30 days, then "Show older" | Keeps the column short without inventing an archive. |
| Live updates | SWR polling, 15 s while visible | No new infrastructure; the board is low-traffic. |
| Drag library | `@dnd-kit/core` + `@dnd-kit/sortable` (stable 6.x / 10.x; check React 19 peer ranges in T5) | Mature, has keyboard and touch sensors and screen-reader announcements. `@dnd-kit/react` is still 0.x. |
| Fractional keys | The `fractional-indexing` package (rocicorp, MIT, no deps) | Small, well tested, and the algorithm the roadmap names. |

## Tasks

The workflow is the same as phases 1–3: one task, one branch (`family/<id>-<slug>` from `main`),
one PR, one fresh agent per task, run one at a time. All SQL is in T1; George applies the
migration at the checkpoint.

| Task | What | Depends on |
| --- | --- | --- |
| T1 | Migration: `todos`, RLS, the bookkeeping trigger | — |
| — | **Checkpoint:** George applies the T1 migration | T1 |
| T2 | Domain: types, Zod schemas, `positionBetween`, filters | — (can run alongside T1) |
| T3 | `TodoRepository`: interface, Supabase implementation, fake, wiring | T1, T2 |
| T4 | API routes: list, add, edit, delete, move | T3 |
| T5 | Web board at `/todos`: columns, cards, drag and drop, quick add, edit dialog (not linked yet) | T4 |
| T6 | Member and due-date filters, the phone layout, and the nav item | T5 |
| T7 | MCP tools | T4 |
| — | **Checkpoint:** smoke test | T6, T7 |

### T1: Migration for the to-dos

Migration `create_todos`:

```sql
create table public.todos (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  position text not null collate "C",
  assignee_member_id uuid references public.family_members(id) on delete set null,
  due_date date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  unique (family_id, status, position)
);
```

`position` uses `collate "C"` so Postgres sorts keys byte by byte, the order the TS library
assumes. The unique constraint gives the `(family_id, status, position)` index; add
`(assignee_member_id)` and `(family_id, completed_at)`.

Policies (all `to authenticated`, built on the F06 helpers):
- **select, update, delete**: `family_id = family_private.my_family_id()`.
- **insert**: same family, and `created_by = app_private.current_user_id()`.

Trigger `todos_guard` (before insert or update), bookkeeping only:
- The assignee must be a member of the card's family.
- `family_id` and `created_by` never change.
- Sets `updated_at`; sets or clears `completed_at` / `completed_by` when `status` enters or leaves
  `done`.

SQL tests (`supabase/tests/todos_rls.sql`): a parent and a kid can each see, add, edit, assign,
move and delete any card in their family, including the other's; a member of another family and a
user with no family see nothing and change nothing; assigning a member of another family fails;
`family_id` and `created_by` can't be changed. Plus: removing a member unassigns their cards and
keeps the cards they created; deleting the family deletes every card.

**Done when** `npm run test:db` passes and `database.types.ts` is regenerated.

### Checkpoint

George applies `create_todos` to the live project (Supabase MCP `apply_migration`, as in earlier
checkpoints). Nothing in the app uses it yet.

### T2: Domain and validation

Pure code, no Supabase, so it can run alongside T1.

- `src/lib/todos/types.ts`: `Todo`, `TodoStatus`, `TODO_STATUSES`, column labels.
- `src/lib/validation/todo.ts`: `todoSchema` (title, notes, assigneeMemberId, dueDate) and
  `moveSchema` (status, beforeId, afterId), trimming as the expense schemas do.
- `src/lib/todos/position.ts`: `positionBetween(before, after)` wrapping `fractional-indexing`'s
  `generateKeyBetween`. Tests: empty column, top, bottom, between, between two adjacent keys, and
  1,000 inserts at the same spot staying sorted.
- `src/lib/todos/filters.ts`: by assignee (member id, `me`, `unassigned`), `dueToday` and
  `overdue` (Europe/Bucharest dates through the existing calendar helpers), with tests.

**Done when** the unit tests pass and nothing imports the new code yet.

### T3: `TodoRepository`

Follow `ExpenseTabRepository` (`src/lib/expenses/tab-repository.ts`):

- Interface in `src/lib/todos/repository.ts`: `list({ doneSince })`, `get(id)`, `create`,
  `update`, `delete`, `getNeighbours(status, beforeId, afterId)`, `setPosition(id, status,
  position)`. The family comes from the caller's membership, never from the client. Unique
  violations surface as a typed `PositionTakenError`; an assignee outside the family as 422.
- Supabase implementation in `src/lib/supabase/repositories/todos.ts`, acting as the caller.
- Fake in `src/test/fakes/` that keeps cards to the caller's family closely enough for route tests (shared file:
  rebase and re-check before merging).
- Add `todos` to `Repositories` in `src/lib/repositories.ts`.

**Done when** typecheck, lint and the repository tests pass.

### T4: API routes

Every route calls `requireFamilyFeature()` and uses `withUser`; a caller without a family gets
404.

| Route | What |
| --- | --- |
| `GET /api/todos?doneSince=` | Every card on the family board by status and position, each assignee with name, colour and `avatarUrl`. |
| `POST /api/todos` | Quick add: title (+ optional fields), at the **top** of `status` (default `todo`). |
| `PATCH / DELETE /api/todos/[id]` | Edit fields; delete. |
| `POST /api/todos/[id]/move` | The move flow above. |

Route tests for a parent, a kid editing and deleting a parent's card (200), another family's
member (404), a user with no family (404), and the family flag off (404). Include: assigning a
member of another family (422), a stale neighbour (409), and two moves racing for the same slot
(one retries, both end up ordered).

**Done when** the route tests pass and `protected-routes.test.ts` lists the new routes.

### T5: The web board

Page `src/app/(app)/todos/page.tsx`, components in `src/components/todos/`. Nothing links to the
page yet.

- Three columns with counts.
- `@dnd-kit` with pointer, touch (long-press 200 ms) and **keyboard** sensors, and screen-reader
  announcements ("Moved *Buy milk* to In progress, position 2 of 5"). Optimistic moves with SWR
  `mutate`, rolled back on error or 409, then refetched.
- Quick add at the top of each column (Enter adds, Escape cancels). A card shows title, due date
  (red when overdue) and the assignee's avatar. Clicking a card opens an `AppDialog` to edit notes,
  assignee and due date, or delete.
- The empty state for a user without a family.
- Add the board to `/dev/preview` with fake data.

**Done when** screenshots at 1280 px (light and dark), dragging works with mouse and keyboard, and
a failed move rolls back.

### T6: Filters, phones and the nav item

- Filter chips above the board (Everyone, Me, each member, Unassigned; Due today, Overdue), in the
  URL. While a filter hides cards, a drop goes to the top or bottom of the target column, whichever
  is closer, so it never needs a hidden neighbour.
- **Phones (< 768 px):** one column at a time behind a `SegmentedControl` (To do / In progress /
  Done), drag within the column only, and a "Move to…" menu on each card for the other columns.
- `NAV_ITEMS.todos` (`/todos`, "To-dos", a `SquareKanban` icon) in a new **Family** section of
  `NAV_SECTIONS`, shown only to family members. `navigationFor` already receives the membership;
  add a `requiresFamily` option next to `module`.

**Done when** screenshots at 390 and 1280 px, dragging and "Move to…" work on touch, and a user
without a family doesn't see the nav item.

### T7: MCP tools

`src/lib/mcp/tools/todos.ts` with `defineTool`, using the T3 repository:

| Tool | Kind | What |
| --- | --- | --- |
| `list_todos` | READ | Cards on the family board, optional status, assignee (member name or `me`) and due filters. |
| `add_todo` | CREATE | Title, optional status, assignee (by member name), due date. Added at the top. |
| `move_todo` | UPDATE | To a status, at the top or bottom (MCP clients don't know neighbours). |
| `update_todo` | UPDATE | Title, notes, assignee, due date. |
| `delete_todo` | DELETE | Delete a card. |

A caller without a family gets a clear refusal. Update the tool-surface snapshot and
`server.test.ts` (shared file: rebase and re-check before merging).

**Done when** the snapshot is updated and a tool test shows a caller only ever sees and changes
their own family's cards.

### Checkpoint: smoke test

With three accounts: a parent adds a card and assigns it to the kid; the kid moves it to Done and
edits its notes; the kid adds a card and assigns it to the parent; the second parent deletes the
kid's card; the member chips show each person's cards; a move in one browser
shows in the other within 15 s; Claude Code lists and moves a card through MCP.

## Not in this plan

- **Recurring to-dos.**
- **Assignment notifications**: roadmap 5.8.
- **More than one board**, private cards, labels, checklists, attachments, comments.
- **Realtime updates** through Supabase Realtime or SSE.
- **Archiving** done cards and rebalancing long position keys (keys grow slowly; a rebalance job
  can come with the phase 5 worker if they ever get long).
- **The mobile board**: roadmap 9.5.
