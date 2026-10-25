import type { ReminderCompletion } from "@/lib/reminders/repository";
import { dueAt, nextNotifyAt, nextOccurrenceAfter, snoozeEnd, stateOf } from "@/lib/reminders/schedule";
import type { Reminder, ReminderState } from "@/lib/reminders/types";
import type { SnoozeInput } from "@/lib/validation/reminder";

// The reminders page's lists and its optimistic updates. Pure: the page passes `now`.

/** A reminder with where it stands, as `GET /api/reminders` returns it. */
export type ListedReminder = Reminder & { state: ReminderState };

export const REMINDER_TABS = ["upcoming", "overdue", "done"] as const;
export type ReminderTab = (typeof REMINDER_TABS)[number];

/** An occurrence marked done, with its reminder, for the Done tab. */
export type DoneEntry = { completion: ReminderCompletion; reminder: ListedReminder };

function dueTime(reminder: ListedReminder) {
  return reminder.nextDueAt === null ? Number.POSITIVE_INFINITY : new Date(reminder.nextDueAt).getTime();
}

/** Each reminder's state worked out again at `now`, so the lists move on while the page stays open. */
export function withCurrentState(reminders: readonly ListedReminder[], now: Date): ListedReminder[] {
  return reminders.map((reminder) => {
    const state = stateOf(reminder, now);
    return state === reminder.state ? reminder : { ...reminder, state };
  });
}

/**
 * The Upcoming and Overdue lists, from reminders whose state is current.
 *
 * - **Upcoming** holds everything still open that isn't overdue: reminders **due today** first (the
 *   page highlights them), then **upcoming** and **snoozed** ones by their due time. A snoozed
 *   reminder stays here, marked with its snooze, until the snooze ends; then it's overdue again.
 * - **Overdue** holds the overdue ones, the latest first-due (the most late) at the top.
 *
 * One-offs that are done are in neither; the Done tab lists them through their completions.
 */
export function groupReminders(reminders: readonly ListedReminder[]) {
  const upcoming = reminders
    .filter((reminder) => reminder.state === "due" || reminder.state === "upcoming" || reminder.state === "snoozed")
    .sort((a, b) => Number(b.state === "due") - Number(a.state === "due") || dueTime(a) - dueTime(b));
  const overdue = reminders
    .filter((reminder) => reminder.state === "overdue")
    .sort((a, b) => dueTime(a) - dueTime(b));
  return { upcoming, overdue };
}

/** The completions whose reminder is still listed, newest first. */
export function doneEntries(completions: readonly ReminderCompletion[], reminders: readonly ListedReminder[]): DoneEntry[] {
  const byId = new Map(reminders.map((reminder) => [reminder.id, reminder]));
  return completions
    .flatMap((completion) => {
      const reminder = byId.get(completion.reminderId);
      return reminder ? [{ completion, reminder }] : [];
    })
    .sort((a, b) => b.completion.doneAt.localeCompare(a.completion.doneAt));
}

/** `reminders` with `reminder` replacing the one with its id, or added. */
export function upsertReminder(reminders: readonly ListedReminder[], reminder: ListedReminder): ListedReminder[] {
  return reminders.some((item) => item.id === reminder.id)
    ? reminders.map((item) => (item.id === reminder.id ? reminder : item))
    : [...reminders, reminder];
}

/**
 * What marking the open occurrence done does, worked out the way the service does: the next
 * occurrence (none for a one-off), no snooze. The server's answer replaces it.
 */
export function completeLocally(reminder: ListedReminder, now: Date): ListedReminder {
  if (reminder.nextDueOn === null) return reminder;
  const nextDueOn = nextOccurrenceAfter(reminder, reminder.nextDueOn);
  const next = { ...reminder, nextDueOn, snoozedUntil: null };
  return {
    ...next,
    nextDueAt: nextDueOn === null ? null : dueAt(reminder, nextDueOn).toISOString(),
    nextNotifyAt: nextNotifyAt(next, now)?.toISOString() ?? null,
    state: stateOf(next, now),
  };
}

/** The completion marking done adds, until the refetch brings the stored one. */
export function pendingCompletion(reminder: ListedReminder, now: Date): ReminderCompletion | null {
  if (reminder.nextDueOn === null) return null;
  return {
    id: `pending-${reminder.id}-${reminder.nextDueOn}`,
    reminderId: reminder.id,
    occurrenceOn: reminder.nextDueOn,
    doneAt: now.toISOString(),
    expenseId: null,
  };
}

/** What snoozing does, worked out the way the service does. The server's answer replaces it. */
export function snoozeLocally(reminder: ListedReminder, snooze: SnoozeInput, now: Date): ListedReminder {
  if (reminder.nextDueOn === null) return reminder;
  const snoozed = { ...reminder, snoozedUntil: snoozeEnd(snooze, now, reminder.timezone).toISOString() };
  return {
    ...snoozed,
    nextNotifyAt: nextNotifyAt(snoozed, now)?.toISOString() ?? null,
    state: stateOf(snoozed, now),
  };
}

/**
 * The tab that lists reminder `id` (for `/reminders?focus=<id>`): Overdue or Upcoming while it's
 * open, Done for a one-off marked done with a completion still shown; null when it isn't listed
 * (deleted, or done before the Done tab's window).
 */
export function tabOf(
  id: string,
  groups: ReturnType<typeof groupReminders>,
  done: readonly DoneEntry[],
): ReminderTab | null {
  if (groups.overdue.some((reminder) => reminder.id === id)) return "overdue";
  if (groups.upcoming.some((reminder) => reminder.id === id)) return "upcoming";
  if (done.some((entry) => entry.reminder.id === id)) return "done";
  return null;
}
