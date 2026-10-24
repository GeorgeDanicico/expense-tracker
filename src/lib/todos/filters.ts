import { getBucharestToday } from "@/lib/calendar";
import type { Todo } from "@/lib/todos/types";

/** Everyone, the caller ("me"), one member by member id, or cards with no assignee. */
export type TodoAssigneeFilter = "all" | "me" | "unassigned" | (string & {});

/** Whether the card matches the assignee filter; `myMemberId` is the caller's member id. */
export function matchesAssignee(todo: Pick<Todo, "assignee">, filter: TodoAssigneeFilter, myMemberId: string | null) {
  const assigneeId = todo.assignee?.memberId ?? null;
  if (filter === "all") return true;
  if (filter === "unassigned") return assigneeId === null;
  if (filter === "me") return myMemberId !== null && assigneeId === myMemberId;
  return assigneeId === filter;
}

/** Due today on the Europe/Bucharest calendar, whatever its column. */
export function isDueToday(todo: Pick<Todo, "dueDate">, now = new Date()) {
  return todo.dueDate !== null && todo.dueDate === getBucharestToday(now);
}

/** Due before today on the Europe/Bucharest calendar and not done. */
export function isOverdue(todo: Pick<Todo, "dueDate" | "status">, now = new Date()) {
  return todo.dueDate !== null && todo.status !== "done" && todo.dueDate < getBucharestToday(now);
}

export type TodoDueFilter = "any" | "today" | "overdue";

export type TodoFilters = {
  assignee: TodoAssigneeFilter;
  due: TodoDueFilter;
};

export const DEFAULT_TODO_FILTERS: TodoFilters = { assignee: "all", due: "any" };

/** The cards matching both filters, in their original order. */
export function filterTodos<T extends Todo>(
  todos: readonly T[],
  filters: TodoFilters,
  myMemberId: string | null,
  now = new Date(),
): T[] {
  return todos.filter((todo) => matchesAssignee(todo, filters.assignee, myMemberId)
    && (filters.due === "any"
      || (filters.due === "today" ? isDueToday(todo, now) : isOverdue(todo, now))));
}

/** The query parameters the board keeps its filters in: `?member=` (assignee) and `?due=`. */
export const TODO_MEMBER_PARAM = "member";
export const TODO_DUE_PARAM = "due";

/**
 * The filters in a board URL. A missing or empty `?member=` is everyone, and `?due=` other than
 * `today` or `overdue` is ignored. `memberIds`, once the family has loaded, turns a `?member=` that
 * names nobody in the family (someone who left, a mistyped link) back into everyone, so the board
 * never sits empty behind a chip that isn't there.
 */
export function parseTodoFilters(
  params: { get(name: string): string | null },
  memberIds?: readonly string[],
): TodoFilters {
  const member = params.get(TODO_MEMBER_PARAM)?.trim() ?? "";
  const due = params.get(TODO_DUE_PARAM);
  let assignee: TodoAssigneeFilter = DEFAULT_TODO_FILTERS.assignee;
  if (member === "me" || member === "unassigned") assignee = member;
  else if (member && member !== "all") {
    const known = memberIds?.find((id) => id.toLowerCase() === member.toLowerCase());
    assignee = memberIds === undefined ? member : (known ?? DEFAULT_TODO_FILTERS.assignee);
  }
  return { assignee, due: due === "today" || due === "overdue" ? due : DEFAULT_TODO_FILTERS.due };
}

/** The board URL for `filters`, keeping any other query parameters; defaults leave the URL clean. */
export function todoFiltersHref(pathname: string, current: { toString(): string }, filters: TodoFilters) {
  const params = new URLSearchParams(current.toString());
  if (filters.assignee === "all") params.delete(TODO_MEMBER_PARAM);
  else params.set(TODO_MEMBER_PARAM, filters.assignee);
  if (filters.due === "any") params.delete(TODO_DUE_PARAM);
  else params.set(TODO_DUE_PARAM, filters.due);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Whether any filter is on, so the board says how many cards it is hiding. */
export function hasTodoFilters(filters: TodoFilters) {
  return filters.assignee !== DEFAULT_TODO_FILTERS.assignee || filters.due !== DEFAULT_TODO_FILTERS.due;
}

/** What quick add pre-fills under `filters`, so the new card matches them where it can. */
export type QuickAddFields = { assigneeMemberId?: string | null; dueDate?: string };

/**
 * The fields a card added under `filters` starts with: the filtered assignee (Me is the caller,
 * Unassigned is nobody) and, under Due today, today's Bucharest date. Overdue can't be pre-filled
 * (a new card isn't overdue), so the card is added without a due date and the board says it's hidden.
 */
export function quickAddFields(filters: TodoFilters, myMemberId: string | null, now = new Date()): QuickAddFields {
  const fields: QuickAddFields = {};
  if (filters.assignee === "me") {
    if (myMemberId) fields.assigneeMemberId = myMemberId;
  } else if (filters.assignee === "unassigned") {
    fields.assigneeMemberId = null;
  } else if (filters.assignee !== "all") {
    fields.assigneeMemberId = filters.assignee;
  }
  if (filters.due === "today") fields.dueDate = getBucharestToday(now);
  return fields;
}

/** The filter that hides `todo`, by its chip's label ("Overdue"), or null when the card is shown. */
export function hidingFilter(
  todo: Pick<Todo, "assignee" | "dueDate" | "status">,
  filters: TodoFilters,
  myMemberId: string | null,
  now = new Date(),
): string | null {
  if (!matchesAssignee(todo, filters.assignee, myMemberId)) {
    return filters.assignee === "me" ? "Me" : filters.assignee === "unassigned" ? "Unassigned" : "member";
  }
  if (filters.due === "today" && !isDueToday(todo, now)) return "Due today";
  if (filters.due === "overdue" && !isOverdue(todo, now)) return "Overdue";
  return null;
}

/** "Added — hidden by the Overdue filter." for a card quick add created that the filters hide. */
export function hiddenByFilterNotice(filter: string) {
  return `Added — hidden by the ${filter} filter.`;
}
