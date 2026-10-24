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
