"use client";

import { createContext, useContext, type ReactNode } from "react";

import { apiRequest } from "@/lib/api/client";
import {
  todoApiUrl,
  todoMoveApiUrl,
  TODOS_API_KEY,
  type TodoResponse,
} from "@/lib/api/keys";
import type { Todo, TodoStatus } from "@/lib/todos/types";
import type { TodoMove } from "@/lib/validation/todo";

/** A change to a card's fields, as `PATCH /api/todos/[id]` takes it. */
export type TodoChanges = Partial<{
  title: string;
  notes: string;
  assigneeMemberId: string | null;
  dueDate: string | null;
}>;

/** The board's writes. The page uses the REST API; `/dev/preview` swaps in an in-memory one. */
export type TodoApi = {
  create(input: { title: string; status: TodoStatus; assigneeMemberId?: string | null; dueDate?: string }): Promise<Todo>;
  update(id: string, changes: TodoChanges): Promise<Todo>;
  remove(id: string): Promise<void>;
  move(id: string, move: TodoMove): Promise<Todo>;
};

export const restTodoApi: TodoApi = {
  async create(input) {
    return (await apiRequest<TodoResponse>(TODOS_API_KEY, { method: "POST", body: JSON.stringify(input) })).todo;
  },
  async update(id, changes) {
    return (await apiRequest<TodoResponse>(todoApiUrl(id), { method: "PATCH", body: JSON.stringify(changes) })).todo;
  },
  async remove(id) {
    await apiRequest<{ success: true }>(todoApiUrl(id), { method: "DELETE" });
  },
  async move(id, move) {
    return (await apiRequest<TodoResponse>(todoMoveApiUrl(id), { method: "POST", body: JSON.stringify(move) })).todo;
  },
};

const TodoApiContext = createContext<TodoApi>(restTodoApi);

export function TodoApiProvider({ api, children }: { api: TodoApi; children: ReactNode }) {
  return <TodoApiContext.Provider value={api}>{children}</TodoApiContext.Provider>;
}

export function useTodoApi() {
  return useContext(TodoApiContext);
}
