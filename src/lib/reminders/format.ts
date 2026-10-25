import { getBucharestToday } from "@/lib/calendar";
import type { Reminder, RepeatUnit } from "@/lib/reminders/types";
import { utcToZoned } from "@/lib/time-zone";

// How the reminders page words a reminder's dates, repeat and lateness. Pure, so it's tested
// directly; the page passes `now`.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(withYear: boolean) {
  const key = withYear ? "year" : "day";
  let formatter = dayFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
    dayFormatters.set(key, formatter);
  }
  return formatter;
}

/** "Fri 31 Oct" for a `YYYY-MM-DD` date this year, "Fri 29 Oct 2027" in another year. */
export function formatDay(date: string, now: Date = new Date()) {
  const withYear = date.slice(0, 4) !== getBucharestToday(now).slice(0, 4);
  // en-GB puts a comma after the weekday in some engines; the plan's format has none.
  return dayFormatter(withYear).format(new Date(`${date}T12:00:00Z`)).replace(",", "");
}

/** "Fri 31 Oct, 09:00": an instant on the wall clock of `timeZone`. */
export function formatInstant(instant: string, timeZone: string, now: Date = new Date()) {
  const { date, time } = utcToZoned(new Date(instant), timeZone);
  return `${formatDay(date, now)}, ${time}`;
}

/**
 * The open occurrence, "Fri 31 Oct, 09:00", read from `nextDueAt` so a time the spring DST change
 * skips shows when it really falls. Null once a one-off is done.
 */
export function formatDueAt(reminder: Pick<Reminder, "nextDueAt" | "timezone">, now: Date = new Date()) {
  return reminder.nextDueAt === null ? null : formatInstant(reminder.nextDueAt, reminder.timezone, now);
}

const UNIT_NAMES: Record<Exclude<RepeatUnit, "none">, { one: string; many: string; adverb: string }> = {
  week: { one: "week", many: "weeks", adverb: "Weekly" },
  month: { one: "month", many: "months", adverb: "Monthly" },
  year: { one: "year", many: "years", adverb: "Yearly" },
};

/** "Once", "Weekly", "Monthly", "Yearly", or "Every 2 weeks". */
export function repeatLabel(unit: RepeatUnit, interval: number) {
  if (unit === "none") return "Once";
  const names = UNIT_NAMES[unit];
  return interval === 1 ? names.adverb : `Every ${interval} ${names.many}`;
}

/** The unit's name after "Every N", for the form: "week" or "weeks". */
export function repeatUnitName(unit: Exclude<RepeatUnit, "none">, interval: number) {
  return interval === 1 ? UNIT_NAMES[unit].one : UNIT_NAMES[unit].many;
}

function plural(count: number, one: string) {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/**
 * How late an overdue occurrence is at `now`: "Just now" in its first minute, then "5 minutes
 * late", "3 hours late", "2 days late". Rounded down.
 */
export function overdueText(nextDueAt: string, now: Date = new Date()) {
  const late = now.getTime() - new Date(nextDueAt).getTime();
  if (late < MINUTE) return "Just now";
  if (late < HOUR) return `${plural(Math.floor(late / MINUTE), "minute")} late`;
  if (late < DAY) return `${plural(Math.floor(late / HOUR), "hour")} late`;
  return `${plural(Math.floor(late / DAY), "day")} late`;
}

/** "Snoozed until Sat 1 Nov, 09:00". */
export function snoozedText(reminder: Pick<Reminder, "snoozedUntil" | "timezone">, now: Date = new Date()) {
  return reminder.snoozedUntil === null ? null : `Snoozed until ${formatInstant(reminder.snoozedUntil, reminder.timezone, now)}`;
}

/** The Done tab's reach, matching the API's default `doneSince` (`DONE_WINDOW_DAYS` in the service). */
export const DONE_WINDOW_DAYS_LABEL = "Showing the last 30 days.";
