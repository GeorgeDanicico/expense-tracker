"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { useTodoApi, type TodoChanges } from "@/components/todos/todo-api";
import { ApiError } from "@/lib/api/client";
import { todosApiKey, type TodosResponse } from "@/lib/api/keys";
import { applyMove, upsertTodo } from "@/lib/todos/board";
import type { TodoStatus } from "@/lib/todos/types";
import type { TodoMove } from "@/lib/validation/todo";

/** How often the board refetches while the tab is visible (SWR skips hidden tabs). */
export const BOARD_REFRESH_MS = 15_000;

/** How far back each "Show older" reaches in the Done column, in days; after the last, all of it. */
export const OLDER_DONE_STEPS = [90, 365] as const;
const ALL_TIME = "1970-01-01T00:00:00.000Z";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The `doneSince` for the `step`-th "Show older" (1-based); null for the default 30 days. */
export function doneSinceForStep(step: number, now = Date.now()): string | null {
  if (step <= 0) return null;
  const days = OLDER_DONE_STEPS[step - 1];
  return days === undefined ? ALL_TIME : new Date(now - days * DAY_MS).toISOString();
}

/**
 * The family board: its cards from `GET /api/todos` (revalidated on focus and every 15 s while
 * visible), the Done column's reach, and the writes. A move shows at once and rolls back when the
 * server refuses it (a 409 when the board changed under it), then the board refetches.
 * Pass `enabled: false` for a user without a family, so nothing is fetched.
 */
export function useTodoBoard({ enabled = true }: { enabled?: boolean } = {}) {
  const api = useTodoApi();
  const [olderStep, setOlderStep] = useState(0);
  const [doneSince, setDoneSince] = useState<string | null>(null);
  const [moveError, setMoveError] = useState("");
  const paused = useRef(false);

  const key = enabled ? todosApiKey(doneSince) : null;
  const { data, error, isLoading, mutate } = useSWR<TodosResponse>(key, {
    revalidateOnFocus: true,
    refreshInterval: (latest) => (latest ? BOARD_REFRESH_MS : 0),
    keepPreviousData: true,
    // A drag in progress keeps its own copy of the columns; don't refetch under it.
    isPaused: () => paused.current,
    shouldRetryOnError: (caught: unknown) => !(caught instanceof ApiError && [401, 403, 404].includes(caught.status)),
  });

  const setDragging = useCallback((dragging: boolean) => {
    paused.current = dragging;
  }, []);

  const showOlder = useCallback(() => {
    const next = olderStep + 1;
    setOlderStep(next);
    setDoneSince(doneSinceForStep(next));
  }, [olderStep]);

  const add = useCallback(async (title: string, status: TodoStatus) => {
    const todo = await api.create({ title, status });
    await mutate((current) => ({ todos: upsertTodo(current?.todos ?? [], todo) }), { revalidate: false });
    return todo;
  }, [api, mutate]);

  const update = useCallback(async (id: string, changes: TodoChanges) => {
    const todo = await api.update(id, changes);
    await mutate((current) => ({ todos: upsertTodo(current?.todos ?? [], todo) }), { revalidate: false });
    return todo;
  }, [api, mutate]);

  const remove = useCallback(async (id: string) => {
    await api.remove(id);
    await mutate((current) => ({ todos: (current?.todos ?? []).filter((todo) => todo.id !== id) }), { revalidate: false });
  }, [api, mutate]);

  const move = useCallback(async (id: string, target: TodoMove) => {
    setMoveError("");
    try {
      await mutate(async (current) => {
        const todo = await api.move(id, target);
        return { todos: upsertTodo(current?.todos ?? [], todo) };
      }, {
        optimisticData: (current) => ({ todos: applyMove(current?.todos ?? [], id, target) }),
        rollbackOnError: true,
        populateCache: true,
        revalidate: false,
      });
      return true;
    } catch (caught) {
      setMoveError(caught instanceof ApiError && caught.status === 409
        ? "Someone else changed the board, so that card went back. The board is up to date now; try again."
        : caught instanceof Error ? caught.message : "The card could not be moved.");
      void mutate();
      return false;
    }
  }, [api, mutate]);

  return useMemo(() => ({
    todos: data?.todos,
    error: error as unknown,
    isLoading,
    /** True when the server answered 404: the caller has no family (or the family feature is off). */
    noFamily: error instanceof ApiError && error.status === 404,
    refresh: () => void mutate(),
    canShowOlder: olderStep <= OLDER_DONE_STEPS.length,
    showOlder,
    showingOlder: olderStep > 0,
    add,
    update,
    remove,
    move,
    moveError,
    dismissMoveError: () => setMoveError(""),
    setDragging,
  }), [data, error, isLoading, mutate, olderStep, showOlder, add, update, remove, move, moveError, setDragging]);
}

export type TodoBoardState = ReturnType<typeof useTodoBoard>;
