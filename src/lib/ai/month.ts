import { addMonths, APPLICATION_TIMEZONE, getBucharestMonth } from "@/lib/calendar";
import { zonedTimeToUtc } from "@/lib/time-zone";

/** A calendar month of the AI budget: Europe/Bucharest, from the 1st at midnight to the 1st of the next month. */
export type AiMonth = {
  /** `YYYY-MM`. */
  key: string;
  /** The instant the month began; spend counts from here. */
  start: Date;
  /** The instant the next month begins and the budget starts again. */
  resetsAt: Date;
};

/** The budget month `now` falls in. */
export function aiMonthAt(now: Date): AiMonth {
  const key = getBucharestMonth(now);
  return {
    key,
    start: zonedTimeToUtc(`${key}-01`, "00:00", APPLICATION_TIMEZONE),
    resetsAt: zonedTimeToUtc(`${addMonths(key, 1)}-01`, "00:00", APPLICATION_TIMEZONE),
  };
}

const dayFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: APPLICATION_TIMEZONE });

/** "1 November": the day, in Bucharest, of an instant such as `AiMonth.resetsAt`. */
export function formatResetDay(resetsAt: Date) {
  return dayFormatter.format(resetsAt);
}
