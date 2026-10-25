"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { useReminderApi, type ReminderFields } from "@/components/reminders/reminder-api";
import { ApiError } from "@/lib/api/client";
import { REMINDERS_API_KEY, REMINDERS_SUMMARY_API_KEY, type RemindersResponse } from "@/lib/api/keys";
import {
  completeLocally,
  pendingCompletion,
  snoozeLocally,
  upsertReminder,
  withCurrentState,
} from "@/lib/reminders/list";
import type { SnoozeInput } from "@/lib/validation/reminder";

/** How often the list refetches while the tab is visible (SWR skips hidden tabs). */
export const REMINDERS_REFRESH_MS = 60_000;
/** How often the page works the states out again (a reminder turning due or overdue). */
export const NOW_TICK_MS = 30_000;

/** The current time, moving on every `intervalMs`. */
export function useNow(intervalMs = NOW_TICK_MS) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const EMPTY: RemindersResponse = { reminders: [], completions: [] };

/**
 * The caller's reminders from `GET /api/reminders` (revalidated on focus and every minute while
 * visible) with their states worked out again at `now`, and the writes. Mark done and snooze show
 * at once and roll back when the server refuses them, then the list refetches.
 */
export function useReminders(now: Date) {
  const api = useReminderApi();
  const { mutate: mutateKey } = useSWRConfig();
  const [actionError, setActionError] = useState("");
  const { data, error, isLoading, mutate } = useSWR<RemindersResponse>(REMINDERS_API_KEY, {
    revalidateOnFocus: true,
    refreshInterval: (latest) => (latest ? REMINDERS_REFRESH_MS : 0),
    keepPreviousData: true,
    shouldRetryOnError: (caught: unknown) => !(caught instanceof ApiError && [401, 403, 404].includes(caught.status)),
  });

  // The nav badge (R9) reads the summary; keep it in step with every write.
  const refreshSummary = useCallback(() => void mutateKey(REMINDERS_SUMMARY_API_KEY), [mutateKey]);

  const add = useCallback(async (fields: ReminderFields) => {
    const reminder = await api.create(fields);
    await mutate((current = EMPTY) => ({ ...current, reminders: upsertReminder(current.reminders, reminder) }), { revalidate: false });
    refreshSummary();
    return reminder;
  }, [api, mutate, refreshSummary]);

  const update = useCallback(async (id: string, fields: ReminderFields) => {
    const reminder = await api.update(id, fields);
    await mutate((current = EMPTY) => ({ ...current, reminders: upsertReminder(current.reminders, reminder) }), { revalidate: false });
    refreshSummary();
    return reminder;
  }, [api, mutate, refreshSummary]);

  const remove = useCallback(async (id: string) => {
    await api.remove(id);
    await mutate((current = EMPTY) => ({
      reminders: current.reminders.filter((reminder) => reminder.id !== id),
      completions: current.completions.filter((completion) => completion.reminderId !== id),
    }), { revalidate: false });
    refreshSummary();
  }, [api, mutate, refreshSummary]);

  /** Runs an optimistic write; on failure rolls back, shows why and refetches. True when it worked. */
  const optimistic = useCallback(async (
    write: (current: RemindersResponse) => Promise<RemindersResponse>,
    preview: (current: RemindersResponse) => RemindersResponse,
    fallback: string,
  ) => {
    setActionError("");
    try {
      await mutate(async (current = EMPTY) => write(current), {
        optimisticData: (current = EMPTY) => preview(current),
        rollbackOnError: true,
        populateCache: true,
        revalidate: false,
      });
      return true;
    } catch (caught) {
      setActionError(caught instanceof ApiError && caught.status === 409
        ? "That reminder changed somewhere else, so it went back. The list is up to date now; try again."
        : caught instanceof Error ? caught.message : fallback);
      void mutate();
      return false;
    } finally {
      refreshSummary();
    }
  }, [mutate, refreshSummary]);

  const complete = useCallback(async (id: string) => {
    const at = new Date();
    const withCompletion = (current: RemindersResponse) => {
      const reminder = current.reminders.find((item) => item.id === id);
      const completion = reminder ? pendingCompletion(reminder, at) : null;
      return completion ? [completion, ...current.completions] : current.completions;
    };
    const done = await optimistic(
      async (current) => {
        const reminder = await api.complete(id);
        return { reminders: upsertReminder(current.reminders, reminder), completions: withCompletion(current) };
      },
      (current) => ({
        reminders: current.reminders.map((reminder) => (reminder.id === id ? completeLocally(reminder, at) : reminder)),
        completions: withCompletion(current),
      }),
      "The reminder could not be marked done.",
    );
    // The stored completion replaces the pending one.
    if (done) void mutate();
    return done;
  }, [api, mutate, optimistic]);

  const snooze = useCallback((id: string, input: SnoozeInput) => {
    const at = new Date();
    return optimistic(
      async (current) => ({ ...current, reminders: upsertReminder(current.reminders, await api.snooze(id, input)) }),
      (current) => ({
        ...current,
        reminders: current.reminders.map((reminder) => (reminder.id === id ? snoozeLocally(reminder, input, at) : reminder)),
      }),
      "The reminder could not be snoozed.",
    );
  }, [api, optimistic]);

  const reminders = useMemo(() => (data ? withCurrentState(data.reminders, now) : undefined), [data, now]);

  return useMemo(() => ({
    reminders,
    completions: data?.completions,
    error: error as unknown,
    isLoading,
    refresh: () => void mutate(),
    add,
    update,
    remove,
    complete,
    snooze,
    actionError,
    dismissActionError: () => setActionError(""),
  }), [reminders, data, error, isLoading, mutate, add, update, remove, complete, snooze, actionError]);
}

export type RemindersState = ReturnType<typeof useReminders>;
