import "server-only";

import { DomainError } from "@/lib/errors";
import { getRepositories } from "@/lib/repositories";
import { positionBetween } from "@/lib/todos/position";
import { PositionTakenError } from "@/lib/todos/repository";
import type { Todo } from "@/lib/todos/types";
import type { TodoInput, TodoMove } from "@/lib/validation/todo";

// Use cases shared by the REST routes and the MCP tools; each transport only reshapes the result.

/** How far back the Done column reaches by default; older Done cards sit behind "Show older". */
export const DONE_WINDOW_DAYS = 30;

/** How many times a write that lost a race for a position is tried in all before its 409 goes through. */
export const POSITION_ATTEMPTS = 3;

export const TODO_NOT_FOUND_MESSAGE = "To-do not found.";
export const ANCHOR_GONE_MESSAGE = "The board changed. Refresh it and try again.";

/** The default `doneSince`: `DONE_WINDOW_DAYS` before `now`, as an ISO timestamp. */
export function defaultDoneSince(now: Date = new Date()): string {
  return new Date(now.getTime() - DONE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Runs `write` until it doesn't lose a race for a position: a `PositionTakenError` runs it again
 * (it should recompute its key each time), up to `POSITION_ATTEMPTS` attempts in all, after which
 * the last `PositionTakenError` (a 409) propagates. Any other error propagates at once.
 */
export async function retryOnPositionTaken<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      if (!(error instanceof PositionTakenError) || attempt >= POSITION_ATTEMPTS) throw error;
    }
  }
}

/** The caller's family board: To do, In progress, and Done cards completed at or after `doneSince`. */
export async function listTodos(doneSince: string = defaultDoneSince()): Promise<Todo[]> {
  return getRepositories().todos.list({ doneSince });
}

/** Adds a card at the top of its column (the repository picks the key), retrying a lost race. */
export async function createTodo(userId: string, input: TodoInput): Promise<Todo> {
  const { todos } = getRepositories();
  return retryOnPositionTaken(() => todos.create(userId, input));
}

/**
 * Moves a card next to the anchors the client saw (see `TodoRepository.slotNear`). Throws a 404
 * `DomainError` when the caller's family has no such card, and a 409 one when an anchor is gone,
 * in another column, or the card itself, so the client re-syncs. A racing move that takes the key
 * first makes it look up the slot again and retry.
 */
export async function moveTodo(id: string, { status, beforeId, afterId }: TodoMove): Promise<Todo> {
  const { todos } = getRepositories();
  if (!(await todos.get(id))) throw new DomainError(TODO_NOT_FOUND_MESSAGE, 404);

  return retryOnPositionTaken(async () => {
    const slot = await todos.slotNear(status, { beforeId, afterId }, id);
    if (!slot) throw new DomainError(ANCHOR_GONE_MESSAGE, 409);
    const moved = await todos.setPosition(id, status, positionBetween(slot.before, slot.after));
    // Deleted by someone else between the read and the write.
    if (!moved) throw new DomainError(TODO_NOT_FOUND_MESSAGE, 404);
    return moved;
  });
}
