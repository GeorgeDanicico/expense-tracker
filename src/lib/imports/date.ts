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
const NAMED_DAY_MONTH = /^(\d{1,2})\s+(\p{L}{3,10})\.?$/u;

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

// ---------------------------------------------------------------------------------------------
// Dates found in a line of text

/**
 * A date as a statement line prints it. `year` is null when the line prints none ("12.10", "12 Oct");
 * `start` and `end` are its place in the text, so a caller can blank it or look beside it.
 */
export type PrintedDate = { day: number; month: number; year: number | null; start: number; end: number };

/** Spaces as a PDF or a CSV prints them (non-breaking ones included), never a tab: a tab ends a column. */
const SP = String.raw`[  ]`;
const YEAR = String.raw`(?:19|20)\d{2}(?!\d|[.,]\d)`;

/** `2026-10-02`, with the time that may follow it left alone. */
const ISO_IN_TEXT = /(?<![\d./-])(\d{4})-(\d{1,2})-(\d{1,2})(?!\d|[./-]\d)/g;
/** `12.10.2026`, `12/10/2026`, `12-10-2026` and, without a year, `12.10`, `12/10`, `12.10.`: day first, one separator throughout. */
const NUMERIC_IN_TEXT = /(?<![\d./-])(\d{1,2})([./-])(\d{1,2})(?:\2(\d{4}))?(?!\d)(?![./-]\d)/g;
/** `12 Oct 2026`, `12 oct. 2026`, `12 octombrie 2026`, `12-Oct-2026`, and the same without the year. */
const DAY_NAME_IN_TEXT = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(\d{1,2})(?:${SP}+|${SP}*[-.]${SP}*)(\p{L}{3,10})(?!\p{L})\.?(?:(?:${SP}+|${SP}*[-.,]${SP}*)(${YEAR}))?`,
  "gu",
);
/** `Oct 12, 2026`, `October 12 2026`, and `Oct 12`. */
const NAME_DAY_IN_TEXT = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(\p{L}{3,10})(?!\p{L})\.?${SP}+(\d{1,2})(?!\d|[.,]\d)(?:,?${SP}+(${YEAR}))?`,
  "gu",
);

function monthByName(name: string): number | null {
  return MONTH_NAMES[name.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase()] ?? null;
}

/** A date that exists: its day in its month, in some year when there is none, and a real date when there is. */
function real(day: number, month: number, year: number | null): boolean {
  if (month < 1 || month > 12 || day < 1 || day > LONGEST_MONTH[month - 1]) return false;
  return year === null || dateOf(year, { day, month }) !== null;
}

/**
 * Every date a line prints, in the forms statements use: `YYYY-MM-DD`; day first with `.`, `/` or `-`
 * (`12.10.2026`, `12/10`, with or without a year); a day and a month name, English or Romanian
 * (`12 Oct 2026`, `12 oct.`, `12 octombrie 2026`, `12-Oct-2026`); and a month name first (`Oct 12, 2026`).
 * Numeric dates are day first throughout, so `10/12` is the tenth of December and never October
 * the twelfth. A date that is no date (31.02.2026, `12.50`, `Foo 12`) is left out, as is one that is
 * only a part of a longer number ("112.10", "12.10.20268", "12.10.26").
 *
 * A number like "12.10" is a date as much as an amount, and nothing in the text tells which: the
 * caller has the row's own date to compare with, and finds the amount by its own rules.
 * Dates are returned in the order they are printed; where two forms would read the same characters,
 * the one listed above first wins. With `impossible`, a date that doesn't exist is returned too, for
 * a caller that only wants its characters out of the way.
 */
export function findPrintedDates(text: string, options: { impossible?: boolean } = {}): PrintedDate[] {
  const found: PrintedDate[] = [];

  for (const match of text.matchAll(ISO_IN_TEXT)) {
    const [whole, year, month, day] = match;
    found.push({ day: Number(day), month: Number(month), year: Number(year), start: match.index, end: match.index + whole.length });
  }
  for (const match of text.matchAll(NUMERIC_IN_TEXT)) {
    const [whole, day, , month, year] = match;
    found.push({ day: Number(day), month: Number(month), year: year ? Number(year) : null, start: match.index, end: match.index + whole.length });
  }
  for (const match of text.matchAll(DAY_NAME_IN_TEXT)) {
    const [whole, day, name, year] = match;
    const month = monthByName(name);
    if (month) found.push({ day: Number(day), month, year: year ? Number(year) : null, start: match.index, end: match.index + whole.length });
  }
  for (const match of text.matchAll(NAME_DAY_IN_TEXT)) {
    const [whole, name, day, year] = match;
    const month = monthByName(name);
    if (month) found.push({ day: Number(day), month, year: year ? Number(year) : null, start: match.index, end: match.index + whole.length });
  }

  // The forms are listed by priority: keep a date unless it shares characters with one kept before it.
  const kept: PrintedDate[] = [];
  for (const date of found) {
    if ((options.impossible || real(date.day, date.month, date.year)) && !kept.some((other) => date.start < other.end && other.start < date.end)) kept.push(date);
  }
  return kept.sort((a, b) => a.start - b.start);
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
