import { isValidDate } from "@/lib/calendar";

/**
 * Reads a statement date as `YYYY-MM-DD`, day first throughout (the app is Europe/Bucharest):
 * `YYYY-MM-DD`, `DD.MM.YYYY`, `DD/MM/YYYY` and `DD-MM-YYYY`, with one or two digits for the day
 * and month. A timestamp ("2026-10-03T14:05:09Z", "03.10.2026 14:05") keeps only its date as
 * written: the time and any offset are dropped, not converted. Returns null for an impossible
 * date (31.02.2026), two-digit years and anything else.
 */
const TIME = String.raw`(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?\s*(?:Z|[+-]\d{2}(?::?\d{2})?)?)?`;
const ISO = new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})${TIME}$`);
const DAY_FIRST = new RegExp(String.raw`^(\d{1,2})([./-])(\d{1,2})\2(\d{4})${TIME}$`);

export function parseStatementDate(text: string): string | null {
  const value = text.trim();
  let year: string;
  let month: string;
  let day: string;

  const iso = ISO.exec(value);
  const dayFirst = iso ? null : DAY_FIRST.exec(value);
  if (iso) [, year, month, day] = iso;
  else if (dayFirst) [, day, , month, year] = dayFirst;
  else return null;

  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isValidDate(date) ? date : null;
}

// ---------------------------------------------------------------------------------------------
// Dates printed without a year

/** A day and month with no year yet. `month` is 1 to 12; `day` exists in that month in some year (29 February does). */
export type DayMonth = { day: number; month: number };

/**
 * Month names and abbreviations as statements print them, English and Romanian, after case and
 * accents are folded. "mar" is March in both languages and "mai" is Romanian for May, so no name
 * is ambiguous.
 */
const MONTH_NAMES: Record<string, number> = {
  ian: 1, ianuarie: 1, jan: 1, january: 1,
  feb: 2, februarie: 2, february: 2,
  mar: 3, martie: 3, march: 3,
  apr: 4, aprilie: 4, april: 4,
  mai: 5, may: 5,
  iun: 6, iunie: 6, jun: 6, june: 6,
  iul: 7, iulie: 7, jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, septembrie: 9, september: 9,
  oct: 10, octombrie: 10, october: 10,
  nov: 11, noiembrie: 11, november: 11,
  dec: 12, decembrie: 12, december: 12,
};

const NUMERIC_DAY_MONTH = /^(\d{1,2})[./-](\d{1,2})\.?$/;
const NAMED_DAY_MONTH = /^(\d{1,2})\s+(\p{L}{3,9})\.?$/u;

const LONGEST_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Reads a date printed without a year: `12.10`, `12/10`, `12-10` (a trailing dot is allowed,
 * "12.10."), `12 Oct`, `12 oct.`, `12 octombrie`. Day first, as `parseStatementDate` reads full
 * dates, so "10/25" is no date (there is no month 25) and is never read as the 25th of October.
 * Returns null for a day or month that does not exist in any year (31.11, 30.02), for a name that
 * is not a month, and for anything that carries a year: full dates go through `parseStatementDate`.
 */
export function parseYearlessStatementDate(text: string): DayMonth | null {
  const value = text.trim().normalize("NFKD").replace(/\p{M}+/gu, "");

  let day: number;
  let month: number;
  const numeric = NUMERIC_DAY_MONTH.exec(value);
  const named = numeric ? null : NAMED_DAY_MONTH.exec(value);
  if (numeric) {
    day = Number(numeric[1]);
    month = Number(numeric[2]);
  } else if (named) {
    day = Number(named[1]);
    month = MONTH_NAMES[named[2].toLowerCase()] ?? 0;
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > LONGEST_MONTH[month - 1]) return null;
  return { day, month };
}

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function dateOf(year: number, { day, month }: DayMonth): string | null {
  const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidDate(date) ? date : null;
}

/**
 * Gives a day and month their year, in code: the model never supplies one (docs/statement-import-plan.md,
 * "How code checks the model").
 *
 * - With `fullDates` (every date with a year that the statement prints, such as the period in its
 *   heading or the dates of other rows), the year that puts the date inside the span from the
 *   earliest to the latest of them, or else nearest to it. A December to January statement works
 *   because both years are tried. A tie, between two years at the same distance or two years that
 *   both fall inside a span of more than a year, is refused rather than guessed.
 * - Without any, the most recent occurrence of the day and month that is not after `today`
 *   (`YYYY-MM-DD`, Europe/Bucharest). 29 February goes back to the last leap year.
 *
 * Returns null when no year fits (29 February in a span with no leap year) or the choice is a tie.
 */
export function resolveYearlessDate(
  dayMonth: DayMonth,
  context: { fullDates: readonly string[]; today: string },
): string | null {
  const known = context.fullDates.filter((date) => isValidDate(date)).sort();

  if (known.length === 0) {
    const todayYear = Number(context.today.slice(0, 4));
    for (let year = todayYear; year > todayYear - 9; year -= 1) {
      const date = dateOf(year, dayMonth);
      if (date && date <= context.today) return date;
    }
    return null;
  }

  const first = known[0];
  const last = known[known.length - 1];
  const firstDay = dayNumber(first);
  const lastDay = dayNumber(last);

  let best: { date: string; distance: number } | null = null;
  let tied = false;
  for (let year = Number(first.slice(0, 4)) - 1; year <= Number(last.slice(0, 4)) + 1; year += 1) {
    const date = dateOf(year, dayMonth);
    if (!date) continue;
    const at = dayNumber(date);
    const distance = at < firstDay ? firstDay - at : at > lastDay ? at - lastDay : 0;
    if (!best || distance < best.distance) {
      best = { date, distance };
      tied = false;
    } else if (distance === best.distance) {
      tied = true;
    }
  }
  return best && !tied ? best.date : null;
}
