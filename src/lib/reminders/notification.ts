import { formatDay } from "@/lib/reminders/format";
import { dueAt, nextNotifyAt } from "@/lib/reminders/schedule";
import type { Reminder, ReminderSchedule } from "@/lib/reminders/types";
import { utcToZoned } from "@/lib/time-zone";

// What the worker queues for a due reminder (docs/reminders-plan.md, "R8: Reminder notifications").
// Pure, so it's tested directly with a fixed notify time.

const DAY = 24 * 60 * 60_000;

/** The reminder fields the worker needs to queue its notification. */
export type NotifiableReminder = ReminderSchedule & Pick<Reminder, "id" | "title">;

/** The push payload of a reminder notification, as stored in `notifications.payload`. */
export type ReminderPayload = { title: string; body: string; url: string; tag: string };

/** The page the notification opens: the reminders page, scrolled to this one. */
export function reminderUrl(id: string) {
  return `/reminders?focus=${encodeURIComponent(id)}`;
}

/** The outbox key of one notify time: a re-run (or a second worker) queues it only once. */
export function reminderDedupeKey(id: string, notifyAt: Date) {
  return `reminder:${id}:${notifyAt.toISOString()}`;
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

/**
 * The body for a notification sent at `at` about the open occurrence, on the wall clock of
 * the reminder's time zone: "Due now" once the occurrence's time has come (a lead time of zero, or
 * a snooze that ends after it), "Due today at 09:00", "Due tomorrow at 09:00", else
 * "Due in 3 days, Fri 31 Oct". The time is read from the occurrence's instant, so a time the
 * spring DST change skips shows when it really falls.
 */
export function reminderBody(
  reminder: Pick<ReminderSchedule, "timeOfDay" | "timezone" | "nextDueOn">,
  at: Date,
): string {
  if (reminder.nextDueOn === null) return "Due now";
  const due = dueAt(reminder, reminder.nextDueOn);
  if (at.getTime() >= due.getTime()) return "Due now";

  const today = utcToZoned(at, reminder.timezone).date;
  const dueLocal = utcToZoned(due, reminder.timezone);
  const days = daysBetween(today, dueLocal.date);
  if (days <= 0) return `Due today at ${dueLocal.time}`;
  if (days === 1) return `Due tomorrow at ${dueLocal.time}`;
  return `Due in ${days} days, ${formatDay(dueLocal.date, at)}`;
}

/** The payload for a notification queued at `at`. */
export function reminderPayload(reminder: NotifiableReminder, at: Date): ReminderPayload {
  return {
    title: reminder.title,
    body: reminderBody(reminder, at),
    url: reminderUrl(reminder.id),
    tag: `reminder:${reminder.id}`,
  };
}

/** What a claimed reminder does this tick: the notification to queue (if any) and what to store. */
export type ReminderNotificationPlan = {
  /** The notify time sent for, and its outbox row; null when nothing is due after all. */
  notification: { notifyAt: Date; dedupeKey: string; payload: ReminderPayload } | null;
  /** The new `next_notify_at`. */
  nextNotifyAt: Date | null;
};

/**
 * Plans a claimed reminder whose stored `next_notify_at` is `claimed`, at `now`, as
 * `nextNotifyAt`'s comment says: one notification for the latest time missed since `claimed`
 * (inclusive), so a worker that was down sends one, not a burst; then `nextNotifyAt(reminder, now)`.
 * A muted or done reminder, or a stored time still ahead, queues nothing.
 *
 * The body is worded at `now`, which is the notify time give or take a tick, but after the worker
 * was down it says how far off the occurrence really is ("Due tomorrow", not the "Due in 7 days" of
 * a week-before notify time it missed).
 */
export function planReminderNotification(reminder: NotifiableReminder, claimed: Date, now: Date): ReminderNotificationPlan {
  const latest = claimed.getTime() <= now.getTime() ? nextNotifyAt(reminder, new Date(claimed.getTime() - 1), now) : null;
  const notification = latest !== null && latest.getTime() <= now.getTime()
    ? { notifyAt: latest, dedupeKey: reminderDedupeKey(reminder.id, latest), payload: reminderPayload(reminder, now) }
    : null;
  return { notification, nextNotifyAt: nextNotifyAt(reminder, now) };
}
