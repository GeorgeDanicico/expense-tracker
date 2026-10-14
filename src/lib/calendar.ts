import type { AnalyticsPeriod } from "@/lib/types";

/**
 * Calendar dates (`YYYY-MM-DD`) and months (`YYYY-MM`) as plain strings.
 *
 * "Now" sources are named after the clock they read, because the app still mixes three:
 * - process-local: `getProcessLocalMonth` (and the `getMonthRange` fallback built on it)
 * - UTC: `getUtcToday`, `getUtcMonth`
 * - Europe/Bucharest (the application calendar): `getBucharestMonth`, `getBucharestToday`
 */

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const APPLICATION_TIMEZONE = "Europe/Bucharest";

export const ANALYTICS_PERIODS = ["3m", "6m", "1y", "2y", "custom"] as const satisfies readonly AnalyticsPeriod[];

/** Completed months covered by each preset analytics period. */
export const ANALYTICS_PERIOD_MONTHS: Record<Exclude<AnalyticsPeriod, "custom">, number> = {
  "3m": 3,
  "6m": 6,
  "1y": 12,
  "2y": 24,
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/** `month` is 1-based. */
export function toIsoMonth(year: number, month: number) {
  return `${String(year).padStart(4, "0")}-${pad2(month)}`;
}

/** `month` is 1-based. */
export function toIsoDate(year: number, month: number, day: number) {
  return `${toIsoMonth(year, month)}-${pad2(day)}`;
}

/** The `day`-th date of a `YYYY-MM` month. */
export function dateInMonth(month: string, day: number) {
  return `${month}-${pad2(day)}`;
}

function monthNumber(month: string) {
  const [year, number] = month.split("-").map(Number);
  return year * 12 + number - 1;
}

/** Pure calendar arithmetic: `addMonths("2026-12", 1) === "2027-01"`. */
export function addMonths(month: string, amount: number) {
  const index = monthNumber(month) + amount;
  return toIsoMonth(Math.floor(index / 12), (index % 12) + 1);
}

/** How many months `b` is after `a` (`monthsBetween("2026-01", "2026-03") === 2`). */
export function monthsBetween(a: string, b: string) {
  return monthNumber(b) - monthNumber(a);
}

export function daysInMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

export function lastDayOfMonth(month: string) {
  return dateInMonth(month, daysInMonth(month));
}

/** Pure calendar arithmetic on a `YYYY-MM-DD` date; no time zone is involved. */
export function addDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return toIsoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

/** Month keys from `start`'s month up to, but not including, `endExclusive`'s month. */
export function monthKeysBetween(start: string, endExclusive: string) {
  const keys: string[] = [];
  let cursor = start.slice(0, 7);
  const last = endExclusive.slice(0, 7);

  while (cursor < last) {
    keys.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }

  return keys;
}

/** Today's date on the UTC calendar. */
export function getUtcToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** The current month on the UTC calendar. */
export function getUtcMonth(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

const applicationMonthFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APPLICATION_TIMEZONE,
  year: "numeric",
  month: "2-digit",
});

/** The current month on the application (Europe/Bucharest) calendar. */
export function getBucharestMonth(now = new Date()) {
  const parts = applicationMonthFormatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")!.value;
  const month = parts.find((part) => part.type === "month")!.value;
  return `${year.padStart(4, "0")}-${month}`;
}

const applicationDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APPLICATION_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date on the application (Europe/Bucharest) calendar. */
export function getBucharestToday(now = new Date()) {
  const parts = applicationDateFormatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")!.value;
  const month = parts.find((part) => part.type === "month")!.value;
  const day = parts.find((part) => part.type === "day")!.value;
  return `${year.padStart(4, "0")}-${month}-${day}`;
}

/** Resolve main-ledger URL/API selections against the shared application calendar. */
export function resolveMainExpenseMonth(requested: string | null | undefined, now = new Date()) {
  const currentMonth = getBucharestMonth(now);
  return requested && isValidMonth(requested) && requested <= currentMonth
    ? requested
    : currentMonth;
}

export function isMonthAllowed(month: string, maxMonth?: string) {
  return isValidMonth(month) && (!maxMonth || (isValidMonth(maxMonth) && month <= maxMonth));
}

/** The current month in the server's or browser's own time zone. */
export function getProcessLocalMonth() {
  const now = new Date();
  return toIsoMonth(now.getFullYear(), now.getMonth() + 1);
}

export function isValidMonth(value: string) {
  return MONTH_PATTERN.test(value) && !Number.isNaN(new Date(`${value}-01T00:00:00`).valueOf());
}

export function isValidDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function getMonthRange(month: string) {
  const safeMonth = isValidMonth(month) ? month : getProcessLocalMonth();
  const [year, monthNumber] = safeMonth.split("-").map(Number);
  const next = new Date(year, monthNumber, 1);

  return {
    month: safeMonth,
    start: `${safeMonth}-01`,
    endExclusive: toIsoDate(next.getFullYear(), next.getMonth() + 1, 1),
  };
}

export function shiftMonth(month: string, amount: number) {
  const { month: safeMonth } = getMonthRange(month);
  const [year, monthNumber] = safeMonth.split("-").map(Number);
  const shifted = new Date(year, monthNumber - 1 + amount, 1);
  return toIsoMonth(shifted.getFullYear(), shifted.getMonth() + 1);
}

export function formatMonth(month: string, locale = "en-US") {
  const { month: safeMonth } = getMonthRange(month);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(`${safeMonth}-01T12:00:00`),
  );
}

export function formatDate(date: string, locale = "en-US") {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

export function formatDateTime(date: string, locale = "en-US") {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}
