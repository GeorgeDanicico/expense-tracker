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
