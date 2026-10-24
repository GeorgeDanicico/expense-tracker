import { positionBetween } from "@/lib/todos/position";
import { TODO_STATUSES, TODO_STATUS_LABELS, type Todo, type TodoStatus } from "@/lib/todos/types";
import type { TodoMove } from "@/lib/validation/todo";

// Pure helpers behind the web board's drag and drop: grouping cards into columns, moving an id
// while a drag is in progress, turning the drop into the move the API takes, and the optimistic
// list shown until the server answers.

/** Card ids per column, top to bottom. */
export type BoardColumns = Record<TodoStatus, string[]>;

/** Orders cards by their position key, byte by byte (never `localeCompare`). */
export function compareTodos(a: Pick<Todo, "position" | "id">, b: Pick<Todo, "position" | "id">) {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The cards of each column, sorted by position. */
export function groupTodos<T extends Todo>(todos: readonly T[]): Record<TodoStatus, T[]> {
  const groups = { todo: [], in_progress: [], done: [] } as Record<TodoStatus, T[]>;
  for (const todo of todos) groups[todo.status]?.push(todo);
  for (const status of TODO_STATUSES) groups[status].sort(compareTodos);
  return groups;
}

/** The ids of each column, sorted by position. */
export function columnsOf(todos: readonly Todo[]): BoardColumns {
  const groups = groupTodos(todos);
  return {
    todo: groups.todo.map((todo) => todo.id),
    in_progress: groups.in_progress.map((todo) => todo.id),
    done: groups.done.map((todo) => todo.id),
  };
}

/** The column holding `id`, whether `id` is a card or a column itself; null when it's neither. */
export function columnOf(columns: BoardColumns, id: string): TodoStatus | null {
  if ((TODO_STATUSES as readonly string[]).includes(id)) return id as TodoStatus;
  return TODO_STATUSES.find((status) => columns[status].includes(id)) ?? null;
}

/**
 * Moves `activeId` to where `overId` is: onto a card's slot (taking its index; below it when
 * `below` is set, as when the pointer is past the card's middle), or to the end of a column when
 * `overId` is the column. Returns `columns` unchanged when nothing moves or an id is unknown.
 */
export function moveWithin(columns: BoardColumns, activeId: string, overId: string, below = false): BoardColumns {
  const from = columnOf(columns, activeId);
  const to = columnOf(columns, overId);
  if (!from || !to || activeId === overId) return columns;

  const source = columns[from].filter((id) => id !== activeId);
  const target = from === to ? source : [...columns[to]];
  const overIndex = target.indexOf(overId);
  let index: number;
  if (overIndex === -1) {
    index = target.length;
  } else if (from === to) {
    // Within a column the card takes the slot of the one it's over: arrayMove semantics.
    index = columns[from].indexOf(overId);
  } else {
    index = overIndex + (below ? 1 : 0);
  }
  target.splice(index, 0, activeId);

  const next = { ...columns, [from]: from === to ? target : source, [to]: target };
  return sameColumns(columns, next) ? columns : next;
}

function sameColumns(a: BoardColumns, b: BoardColumns) {
  return TODO_STATUSES.every((status) => a[status].length === b[status].length
    && a[status].every((id, index) => b[status][index] === id));
}

/**
 * The move the API takes for `id` once it sits in `columns`: its column, the visible card above
 * (`beforeId`) and the visible card below (`afterId`). Null when `id` isn't on the board.
 */
export function moveFor(columns: BoardColumns, id: string): TodoMove | null {
  const status = columnOf(columns, id);
  if (!status) return null;
  const column = columns[status];
  const index = column.indexOf(id);
  return { status, beforeId: column[index - 1] ?? null, afterId: column[index + 1] ?? null };
}

/** Whether `move` would leave `id` where it already is in `columns`, so there's nothing to send. */
export function isSamePlace(columns: BoardColumns, id: string, move: TodoMove) {
  const current = moveFor(columns, id);
  return current !== null && current.status === move.status
    && current.beforeId === move.beforeId && current.afterId === move.afterId;
}

/**
 * The list shown while a move is in flight: `id` in its new column with a key between its new
 * neighbours' keys, so sorting by position puts it where it was dropped. Done timestamps are
 * left to the server. Returns `todos` unchanged when the card or an anchor is missing.
 */
export function applyMove(todos: readonly Todo[], id: string, move: TodoMove): Todo[] {
  const moving = todos.find((todo) => todo.id === id);
  const before = move.beforeId ? todos.find((todo) => todo.id === move.beforeId) : null;
  const after = move.afterId ? todos.find((todo) => todo.id === move.afterId) : null;
  if (!moving || before === undefined || after === undefined) return [...todos];

  let lower = before?.position ?? null;
  let upper = after?.position ?? null;
  if (!before && !after) {
    // Top of the column: above its first card.
    const first = groupTodos(todos.filter((todo) => todo.id !== id))[move.status][0];
    upper = first?.position ?? null;
  } else if (before && !after) {
    upper = nextPosition(todos, id, move.status, before.position);
  } else if (!before && after) {
    lower = previousPosition(todos, id, move.status, after.position);
  }

  let position: string;
  try {
    position = positionBetween(lower, upper);
  } catch {
    return [...todos];
  }
  return todos.map((todo) => (todo.id === id ? { ...todo, status: move.status, position } : todo));
}

function nextPosition(todos: readonly Todo[], id: string, status: TodoStatus, key: string) {
  const keys = todos.filter((todo) => todo.id !== id && todo.status === status && todo.position > key)
    .map((todo) => todo.position).sort();
  return keys[0] ?? null;
}

function previousPosition(todos: readonly Todo[], id: string, status: TodoStatus, key: string) {
  const keys = todos.filter((todo) => todo.id !== id && todo.status === status && todo.position < key)
    .map((todo) => todo.position).sort();
  return keys.at(-1) ?? null;
}

/** `todos` with `todo` replacing the card of the same id, or added when it's new. */
export function upsertTodo(todos: readonly Todo[], todo: Todo): Todo[] {
  return todos.some((item) => item.id === todo.id)
    ? todos.map((item) => (item.id === todo.id ? todo : item))
    : [...todos, todo];
}

/** Where `id` sits, for screen readers: "In progress, position 2 of 5". */
export function placeOf(columns: BoardColumns, id: string) {
  const status = columnOf(columns, id);
  if (!status) return null;
  const column = columns[status];
  return { status, label: TODO_STATUS_LABELS[status], position: column.indexOf(id) + 1, count: column.length };
}

/** "Moved Buy milk to In progress, position 2 of 5." */
export function movedAnnouncement(title: string, columns: BoardColumns, id: string) {
  const place = placeOf(columns, id);
  if (!place) return `Moved ${title}.`;
  return `Moved ${title} to ${place.label}, position ${place.position} of ${place.count}.`;
}

/** "Buy milk is in In progress, position 2 of 5." */
export function overAnnouncement(title: string, columns: BoardColumns, id: string) {
  const place = placeOf(columns, id);
  if (!place) return `${title} is not over a column.`;
  return `${title} is in ${place.label}, position ${place.position} of ${place.count}.`;
}
