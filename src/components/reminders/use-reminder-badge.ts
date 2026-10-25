"use client";

import { useEffect } from "react";
import useSWR from "swr";

import { REMINDERS_SUMMARY_API_KEY, type RemindersSummaryResponse } from "@/lib/api/keys";

/** How often the badge refetches while the tab is visible (SWR skips hidden tabs). */
export const REMINDER_BADGE_REFRESH_MS = 5 * 60_000;

/** The badge's text: nothing at 0, the count up to 9, then "9+". */
export function badgeText(count: number) {
  if (count <= 0) return null;
  return count > 9 ? "9+" : String(count);
}

/**
 * Calls `onNotification` for every `{ type: "notification" }` message the service worker posts
 * (it posts one to each open window on every push). Returns the unsubscribe; a no-op without a
 * service worker container.
 */
export function onServiceWorkerNotification(
  container: Pick<EventTarget, "addEventListener" | "removeEventListener"> | undefined | null,
  onNotification: () => void,
) {
  if (!container) return () => {};
  const listener = (event: Event) => {
    const data = (event as MessageEvent).data as unknown;
    if (data && typeof data === "object" && (data as { type?: unknown }).type === "notification") onNotification();
  };
  container.addEventListener("message", listener);
  return () => container.removeEventListener("message", listener);
}

/**
 * What the Reminders nav badge shows: due + overdue from `GET /api/reminders/summary`, revalidated
 * on focus, every 5 minutes and when a push arrives. The reminders page mutates the same key after
 * every write. `enabled: false` neither fetches nor listens (nav rows without a badge).
 */
export function useReminderBadge(enabled = true) {
  const { data, mutate } = useSWR<RemindersSummaryResponse>(enabled ? REMINDERS_SUMMARY_API_KEY : null, {
    revalidateOnFocus: true,
    refreshInterval: REMINDER_BADGE_REFRESH_MS,
    shouldRetryOnError: false,
  });

  useEffect(() => {
    if (!enabled || typeof navigator === "undefined") return;
    return onServiceWorkerNotification(navigator.serviceWorker, () => void mutate());
  }, [enabled, mutate]);

  const due = data?.due ?? 0;
  const overdue = data?.overdue ?? 0;
  return { due, overdue, count: due + overdue };
}
