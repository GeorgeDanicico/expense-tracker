/**
 * Local wall-clock time in an IANA time zone ⇄ UTC instants, on `Intl.DateTimeFormat` alone
 * (no date library), so it runs the same in the browser, the API and the worker.
 *
 * Dates are `YYYY-MM-DD` and times `HH:MM` (or `HH:MM:SS`), as plain strings.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall clock in `timeZone` at `epochMs`, read back as if it were UTC (milliseconds dropped). */
function wallClockMs(epochMs: number, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
}

/** `timeZone`'s offset from UTC at `epochMs`, in milliseconds (Bucharest in summer: +3 h). */
function offsetMs(epochMs: number, timeZone: string) {
  const wholeSeconds = Math.floor(epochMs / 1000) * 1000;
  return wallClockMs(wholeSeconds, timeZone) - wholeSeconds;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** `date` at `time` as if it were UTC: the wall clock as a number, before any zone applies. */
export function wallClockToMs(date: string, time: string) {
  const dateMatch = DATE_PATTERN.exec(date);
  const timeMatch = TIME_PATTERN.exec(time);
  if (!dateMatch || !timeMatch) throw new RangeError(`Invalid local date or time: ${date} ${time}`);
  const [, year, month, day] = dateMatch.map(Number);
  const [, hour, minute, second = 0] = timeMatch.map((value) => Number(value ?? 0));
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** The inverse of `wallClockToMs`: `{ date: "YYYY-MM-DD", time: "HH:MM" }`, seconds dropped. */
export function msToWallClock(ms: number) {
  const iso = new Date(ms).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/**
 * The instant when the wall clock in `timeZone` shows `date` at `time`.
 *
 * Around a DST change:
 * - a time the clock skips (03:00–04:00 in Bucharest on the spring change) moves forward to the
 *   first valid minute, the end of the gap (04:00);
 * - a time the clock shows twice (03:00–04:00 on the autumn change) is the earlier instant.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string) {
  const local = wallClockToMs(date, time);
  // A zone changes its offset at most once in a couple of days, so the offsets a day either side
  // are the only two the answer can have.
  const before = offsetMs(local - DAY, timeZone);
  const after = offsetMs(local + DAY, timeZone);

  const valid = [local - before, local - after]
    .filter((candidate) => wallClockMs(candidate, timeZone) === local)
    .sort((a, b) => a - b);
  if (valid.length > 0) return new Date(valid[0]);

  // A skipped time: the gap ends at the transition, the first instant on the new offset. It lies
  // between the two candidates (a gap's width apart); find it to the minute.
  let low = Math.min(local - before, local - after);
  let high = Math.max(local - before, local - after);
  while (high - low > MINUTE) {
    const middle = low + Math.floor((high - low) / 2 / MINUTE) * MINUTE;
    if (offsetMs(middle, timeZone) === after) high = middle;
    else low = middle;
  }
  return new Date(high);
}

/** The wall clock in `timeZone` at `instant`: `{ date: "YYYY-MM-DD", time: "HH:MM" }`. */
export function utcToZoned(instant: Date, timeZone: string) {
  return msToWallClock(wallClockMs(instant.getTime(), timeZone));
}
