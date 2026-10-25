import { addDays, addMonths, daysInMonth, toIsoDate } from "@/lib/calendar";
import type { ReminderRecurrence, ReminderSchedule, ReminderState } from "@/lib/reminders/types";
import { msToWallClock, utcToZoned, wallClockToMs, zonedTimeToUtc } from "@/lib/time-zone";
import type { SnoozeInput } from "@/lib/validation/reminder";

/**
 * A reminder's dates and notify times. Pure, and shared by the API, the worker and the MCP tools
 * (docs/reminders-plan.md, "Working out the dates").
 *
 * Occurrence k is the first date plus k × interval units, always counted from the first date. A
 * month or year without that day uses its last day, so a monthly reminder on 31 January falls on
 * 28/29 February and returns to 31 March. Dates are `YYYY-MM-DD` in the reminder's time zone.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const SNOOZE_TOMORROW_TIME = "09:00";

function monthsPerStep(reminder: ReminderRecurrence) {
  return reminder.repeatUnit === "year" ? 12 * reminder.repeatInterval : reminder.repeatInterval;
}

/** Occurrence `k` (0 is the first date), or null when there's none (a one-off past k = 0). */
export function occurrenceOn(reminder: ReminderRecurrence, k: number): string | null {
  if (!Number.isInteger(k) || k < 0) return null;

  switch (reminder.repeatUnit) {
    case "none":
      return k === 0 ? reminder.startsOn : null;
    case "week":
      return addDays(reminder.startsOn, 7 * reminder.repeatInterval * k);
    case "month":
    case "year": {
      const month = addMonths(reminder.startsOn.slice(0, 7), monthsPerStep(reminder) * k);
      const [year, number] = month.split("-").map(Number);
      const day = Math.min(Number(reminder.startsOn.slice(8, 10)), daysInMonth(month));
      return toIsoDate(year, number, day);
    }
  }
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (24 * HOUR));
}

function monthsBetween(a: string, b: string) {
  const [yearA, monthA] = a.split("-").map(Number);
  const [yearB, monthB] = b.split("-").map(Number);
  return (yearB - yearA) * 12 + monthB - monthA;
}

/** The first occurrence strictly after `date`, or null when there's none (a one-off already past). */
export function nextOccurrenceAfter(reminder: ReminderRecurrence, date: string): string | null {
  if (date < reminder.startsOn) return reminder.startsOn;
  if (reminder.repeatUnit === "none") return null;

  // A first guess at or just before `date`; stepping on from it takes at most two steps.
  let k = reminder.repeatUnit === "week"
    ? Math.floor(daysBetween(reminder.startsOn, date) / (7 * reminder.repeatInterval))
    : Math.floor(monthsBetween(reminder.startsOn, date) / monthsPerStep(reminder));
  let occurrence = occurrenceOn(reminder, k)!;
  while (occurrence <= date) {
    k += 1;
    occurrence = occurrenceOn(reminder, k)!;
  }
  return occurrence;
}

/** The instant of the occurrence on `date`: `date` at the reminder's time of day, in its time zone. */
export function dueAt(reminder: Pick<ReminderRecurrence, "timeOfDay" | "timezone">, date: string) {
  return zonedTimeToUtc(date, reminder.timeOfDay, reminder.timezone);
}

/**
 * When the open occurrence notifies, one instant per lead time, earliest first. Lead times are
 * subtracted in local wall-clock time: "1 day before 09:00" is 09:00 the day before, across a DST
 * change too. Empty once a one-off is done. Ignores the mute and snoozes (see `nextNotifyAt`).
 */
export function notifyTimes(
  reminder: Pick<ReminderSchedule, "timeOfDay" | "timezone" | "leadMinutes" | "nextDueOn">,
): Date[] {
  const { nextDueOn } = reminder;
  if (nextDueOn === null) return [];

  const local = wallClockToMs(nextDueOn, reminder.timeOfDay);
  const times = new Set<number>();
  for (const lead of reminder.leadMinutes) {
    const { date, time } = msToWallClock(local - lead * MINUTE);
    times.add(zonedTimeToUtc(date, time, reminder.timezone).getTime());
  }
  return [...times].sort((a, b) => a - b).map((time) => new Date(time));
}

/**
 * The next time to notify after `after` (exclusive): the last notification sent, or the moment
 * the reminder is saved. Null when muted, done, or nothing is left for the open occurrence.
 *
 * The times are the open occurrence's notify times plus the end of a snooze. While a snooze is
 * set, the notify times before it are dropped: the snooze's end notifies instead.
 *
 * If several times between `after` and `now` were missed (the worker was down), only the latest
 * of them is returned, so a restart never brings a burst; otherwise the first time after `now`.
 *
 * Saving a reminder stores `nextNotifyAt(reminder, now)`. A worker that claims a reminder whose
 * stored time `claimed` has passed sends one notification for the latest time it missed,
 * `nextNotifyAt(reminder, new Date(claimed.getTime() - 1), now)`, then stores
 * `nextNotifyAt(reminder, now)`. Marking done or snoozing a reminder replaces `snoozedUntil`
 * (cleared on done), so a snooze never outlives its occurrence.
 */
export function nextNotifyAt(reminder: ReminderSchedule, after: Date, now: Date = after): Date | null {
  if (reminder.notificationsMuted || reminder.nextDueOn === null) return null;

  const snoozeEnd = reminder.snoozedUntil === null ? null : new Date(reminder.snoozedUntil).getTime();
  const times = notifyTimes(reminder)
    .map((time) => time.getTime())
    .filter((time) => snoozeEnd === null || time >= snoozeEnd);
  if (snoozeEnd !== null) times.push(snoozeEnd);

  const pending = [...new Set(times)].filter((time) => time > after.getTime()).sort((a, b) => a - b);
  const missed = pending.filter((time) => time <= now.getTime());
  const next = missed.length > 0 ? missed[missed.length - 1] : pending[0];
  return next === undefined ? null : new Date(next);
}

/**
 * Where the reminder stands at `now`: `done` without an open occurrence, `snoozed` while a snooze
 * lasts, `overdue` once the occurrence's time has passed, `due` earlier on its day, and `upcoming`
 * before that day.
 */
export function stateOf(
  reminder: Pick<ReminderSchedule, "timeOfDay" | "timezone" | "nextDueOn" | "snoozedUntil">,
  now: Date,
): ReminderState {
  if (reminder.nextDueOn === null) return "done";
  if (reminder.snoozedUntil !== null && new Date(reminder.snoozedUntil).getTime() > now.getTime()) {
    return "snoozed";
  }
  if (now.getTime() >= dueAt(reminder, reminder.nextDueOn).getTime()) return "overdue";
  return utcToZoned(now, reminder.timezone).date === reminder.nextDueOn ? "due" : "upcoming";
}

/** When a snooze chosen at `now` ends: an hour later, or tomorrow at 09:00 in `timeZone`. */
export function snoozeEnd(snooze: SnoozeInput, now: Date, timeZone: string): Date {
  switch (snooze.kind) {
    case "hour":
      return new Date(now.getTime() + HOUR);
    case "tomorrow":
      return zonedTimeToUtc(addDays(utcToZoned(now, timeZone).date, 1), SNOOZE_TOMORROW_TIME, timeZone);
    case "until":
      return new Date(snooze.until);
  }
}
