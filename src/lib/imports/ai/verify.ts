import { centsToAmount, parseAmount } from "@/lib/imports/amount";
import { subtypeForCategory } from "@/lib/expenses/categories";
import { getBucharestToday } from "@/lib/calendar";
import { findPrintedDates, parseStatementDate, parseYearlessStatementDate, resolveYearlessDate } from "@/lib/imports/date";
import { blankDates, type NumberedStatement } from "@/lib/imports/ai/numbered-text";
import type { Classification } from "@/lib/imports/ai/categories";
import type { ReaderAnswer } from "@/lib/imports/ai/prompts";
import { IMPORT_CURRENCY_PATTERN, type ParsedRow } from "@/lib/imports/types";

/**
 * Code checks what the model read (docs/statement-import-plan.md, "How code checks the model").
 * The model normalises: it returns each date as `YYYY-MM-DD` and each amount as a plain decimal
 * ("1234.56"), whatever format the statement prints. So nothing it says is trusted until code has
 * found it in the lines the row cites, a spot check per row:
 *
 * 1. The lines are one to three consecutive lines that exist.
 * 2. The amount is a number of a cited line, as a whole number (45.20 is not found in "145.20", nor
 *    234.56 in "1,234.56"), read to the cent. Each number is read with both decimal marks where it
 *    could be either ("1.234" is 1234.00 or no amount, "1,234.56" and "1.234,56" are 1234.56), so
 *    the model's 1234.56 is found in "1.234,56", "1,234.56" and "1 234,56" alike. In a CSV an amount
 *    is a number of one field, with the CSV reader's own delimiter and quoting: "Mega Image 118,118.40"
 *    in a comma file is the store number 118 and the amount 118.40, while "1,118.40" in quotes is
 *    still the one amount 1118.40.
 * 3. A date printed on a cited line has the row's day and month (`findPrintedDates` reads the forms
 *    statements use, day first: "12.10.2026", "12 Oct 2026", "12 octombrie 2026", "Oct 12, 2026").
 *    When that date prints its year, the model's year must be the same. When the line prints none
 *    ("12.10", "12 oct."), code gives the date its year (`resolveYearlessDate`) from the other dates
 *    the statement prints, or else from today, and the model's year is ignored.
 * 4. The merchant has a word in it. The model may clean a name, so its words are not looked for.
 * 5. No line carries the amounts of two different transactions.
 *
 * A row that fails a check is dropped, not fatal, and the review screen says how many were. The
 * statement is refused (`unverified_statement`) only when the model returned rows and none survived
 * or more than half were dropped, because a draft that lost most of the statement would look
 * complete; and it is refused when the model found nothing in a statement full of transactions
 * (`no_rows`) or no currency can be told (`no_currency`).
 *
 * Statement-wide, and only ever a warning: when the statement prints its total of money out and
 * code finds it on its line, the debits are compared with it to the cent; lines that look like
 * transactions that no row cites are counted. A failure is a reason code and a row number, for the
 * log. It never quotes the text.
 */

export type VerifyFailure =
  /** The model found nothing, but the statement has lines that look like transactions. */
  | "no_rows"
  /** A row cites no line, more than three, a line that doesn't exist, or lines that aren't consecutive. */
  | "bad_lines"
  /** The model's date is not a date, or a date without a year that no year can be given. */
  | "date_unreadable"
  /** No cited line prints a date with the row's day and month. */
  | "date_not_found"
  /** The cited line prints the date with another year than the model gave. */
  | "date_year_mismatch"
  | "amount_unreadable"
  | "amount_not_found"
  | "merchant_empty"
  /** Two transactions rest on the same line for their amounts. */
  | "line_reused"
  /** Neither the row nor the statement says which currency the amount is in. */
  | "no_currency";

/** A transaction the model read and code verified. Credits are kept (`direction`) for the pipeline to count and drop. */
export type VerifiedRow = ParsedRow & {
  /** The model's category for this row's merchant, or null when it gave none. */
  suggestion: Classification | null;
};

/** A row that failed a check and was left out: the reason and its zero-based position in the model's answer, never its text. */
export type DroppedRow = { reason: VerifyFailure; row: number };

export type VerifyResult =
  | {
      ok: true;
      rows: VerifiedRow[];
      /** The statement's own currency when the model named one and the text bears it out. */
      currency: string | null;
      /** For the review screen. None quotes text from the statement. */
      warnings: string[];
      /** The rows left out, for the log. */
      dropped: DroppedRow[];
    }
  | { ok: false; reason: VerifyFailure; /** The zero-based row the check failed on, when one did. */ row: number | null };

/** Whitespace of any kind (including non-breaking spaces) as one space. */
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** Lower case, accents removed. */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

/**
 * A whole number as written in a statement, with thousands groups: "1,234.56", "1.234,56",
 * "1 234,56", "45.20", "7". The first alternative needs a thousands group; the second takes
 * the rest, so "4.50 1,234.56" is two numbers and "1,234.56" is one.
 */
const NUMBER = /\d{1,3}(?:[ '’.,]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d{1,2})?(?![\d])/g;

function numbers(text: string): { text: string; start: number }[] {
  return [...text.matchAll(NUMBER)].map((match) => ({ text: match[0], start: match.index }));
}

/**
 * The model's amount as cents: a plain decimal with a dot ("1234.56", "45.2", "45"). A sign is
 * ignored, since the direction is `t`'s; anything else (a thousands separator, a comma, a currency)
 * is not what the prompt asks for, and the row is dropped.
 */
function plainCents(value: string): number | null {
  const match = /^[-+]?(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
}

/**
 * Every amount, in cents, that the whole numbers of the text can be read as. A number whose decimal
 * mark is a dot or a comma is read both ways and the readings that make an amount are kept
 * ("1.234" is 1234.00 with a decimal comma and no amount with a decimal point; "45,20" is 45.20),
 * so no decimal mark is decided for the statement. Dates are blanked first.
 */
function amountsIn(text: string): number[] {
  const readings: number[] = [];
  for (const { text: digits } of numbers(blankDates(collapse(text)))) {
    for (const decimal of [".", ","] as const) {
      const cents = parseAmount(digits, { decimal });
      if (cents !== null) readings.push(Math.abs(cents));
    }
  }
  return readings;
}

/**
 * Whether the amount is written on the numbered line `lineNumber`. In a PDF it is a whole number of
 * the line's text; in a CSV it is a whole number of one of the line's fields, so a number that runs
 * into the amount only through the delimiter ("118,118.40" in a comma file) is two numbers.
 */
function amountOnLine(cents: number, lineNumber: number, statement: NumberedStatement): boolean {
  const fields = statement.csv?.fields[lineNumber - 1];
  const texts = fields ?? [statement.lines[lineNumber - 1]];
  return texts.some((text) => amountsIn(text).includes(cents));
}

/** The day, month and year of a date the model gave: a full date (`YYYY-MM-DD`, or any form `parseStatementDate` reads) or, failing that, a day and month. */
function modelDate(value: string): { day: number; month: number; year: number | null } | null {
  const full = parseStatementDate(value);
  if (full) return { year: Number(full.slice(0, 4)), month: Number(full.slice(5, 7)), day: Number(full.slice(8, 10)) };
  const dayMonth = parseYearlessStatementDate(value);
  return dayMonth ? { ...dayMonth, year: null } : null;
}

type DateCheck = { date: string; yearless: boolean } | { failure: "date_unreadable" | "date_not_found" | "date_year_mismatch" };

/**
 * Checks the model's date against what the cited lines print: a date with the same day and month
 * must be there, and when it prints its year the model's must be the same. When no such date prints
 * a year, code gives the day and month their year and the model's is ignored.
 */
function checkDate(value: string, lines: readonly string[], statement: NumberedStatement, today: string): DateCheck {
  const wanted = modelDate(value);
  if (!wanted) return { failure: "date_unreadable" };

  const printed = lines.flatMap((line) => findPrintedDates(line)).filter((date) => date.day === wanted.day && date.month === wanted.month);
  if (printed.length === 0) return { failure: "date_not_found" };

  const years = printed.flatMap((date) => (date.year === null ? [] : [date.year]));
  if (years.length > 0) {
    if (wanted.year === null || !years.includes(wanted.year)) return { failure: "date_year_mismatch" };
    return { date: `${String(wanted.year).padStart(4, "0")}-${String(wanted.month).padStart(2, "0")}-${String(wanted.day).padStart(2, "0")}`, yearless: false };
  }

  const date = resolveYearlessDate(wanted, { fullDates: statement.fullDates, today });
  return date ? { date, yearless: true } : { failure: "date_unreadable" };
}

const CURRENCY_SYMBOLS: Record<string, RegExp> = {
  EUR: /€/,
  GBP: /£/,
  USD: /\$/,
  RON: /(?<![\p{L}])lei(?![\p{L}])/iu,
};

/** The currency code when the model's claim is written in the text (as the code or its symbol), else null. */
function currencyIn(claim: string | null, text: string): string | null {
  const code = claim?.trim().toUpperCase() ?? "";
  if (!IMPORT_CURRENCY_PATTERN.test(code)) return null;
  if (new RegExp(`(?<![\\p{L}])${code}(?![\\p{L}])`, "iu").test(text)) return code;
  return CURRENCY_SYMBOLS[code]?.test(text) ? code : null;
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

function failure(reason: VerifyFailure, row: number | null = null): VerifyResult {
  return { ok: false, reason, row };
}

/** The line numbers if they are one to three consecutive lines of the statement, else null. */
function citedLines(lines: readonly number[], lineCount: number): number[] | null {
  if (lines.length < 1 || lines.length > 3) return null;
  for (let index = 0; index < lines.length; index += 1) {
    if (!Number.isInteger(lines[index]) || lines[index] < 1 || lines[index] > lineCount) return null;
    if (index > 0 && lines[index] !== lines[index - 1] + 1) return null;
  }
  return [...lines];
}

export type VerifyOptions = {
  /** Today as `YYYY-MM-DD` in Europe/Bucharest (the default), for dates printed without a year in a statement that prints no date with one. */
  today?: string;
};

/**
 * Checks the model's reading against the numbered statement. Returns the verified rows (typed by
 * code, with the model's category for each merchant), the rows left out and warnings, or the first
 * check that failed when the statement can't be trusted.
 */
export function verifyReading(
  answer: ReaderAnswer,
  statement: NumberedStatement,
  options: VerifyOptions = {},
): VerifyResult {
  const { lines, transactionLines } = statement;
  const readRows = answer.r;

  if (readRows.length === 0) {
    return transactionLines.length > 0 ? failure("no_rows") : { ok: true, rows: [], currency: null, warnings: [], dropped: [] };
  }

  const statementCurrency = currencyIn(answer.s.c, lines.join("\n"));
  const claimed = new Set<number>();
  const used = new Set<number>();
  const rows: VerifiedRow[] = [];
  const dropped: DroppedRow[] = [];
  let zeroAmounts = 0;
  let yearless = 0;
  const today = options.today ?? getBucharestToday();

  const suggestions = new Map<string, Classification>();
  for (const entry of answer.k) {
    const key = fold(collapse(entry.m));
    if (!suggestions.has(key)) suggestions.set(key, { category: entry.c, subtype: subtypeForCategory(entry.c, entry.s) });
  }

  for (const [index, row] of readRows.entries()) {
    const drop = (reason: VerifyFailure) => {
      dropped.push({ reason, row: index });
    };

    // 1. The lines.
    const numbersCited = citedLines(row.l, lines.length);
    if (!numbersCited) {
      drop("bad_lines");
      continue;
    }
    const cited = numbersCited.map((number) => lines[number - 1]);
    const text = cited.join(" ");

    // 2. The amount is on a cited line, to the cent, and not on one another row has taken.
    const cents = plainCents(row.a);
    if (cents === null) {
      drop("amount_unreadable");
      continue;
    }
    const onLine = numbersCited.filter((number) => amountOnLine(cents, number, statement));
    if (onLine.length === 0) {
      drop("amount_not_found");
      continue;
    }
    const amountLine = onLine.find((number) => !claimed.has(number));
    if (amountLine === undefined) {
      drop("line_reused");
      continue;
    }

    // 3. The date's day and month are printed there, and its year is, or code gives it one.
    const checked = checkDate(row.d, cited, statement, today);
    if ("failure" in checked) {
      drop(checked.failure);
      continue;
    }

    // 4. The merchant is a name.
    const merchant = collapse(row.m);
    if (fold(merchant).split(/[^\p{L}\p{N}]+/u).filter(Boolean).length === 0) {
      drop("merchant_empty");
      continue;
    }

    // The row stands: its line is taken and its lines are read.
    claimed.add(amountLine);
    numbersCited.forEach((number) => used.add(number));
    if (checked.yearless) yearless += 1;

    if (cents === 0) {
      zeroAmounts += 1;
      continue;
    }

    const currency = currencyIn(row.c, text) ?? statementCurrency;
    if (!currency) return failure("no_currency", index);

    rows.push({
      expenseDate: checked.date,
      description: merchant,
      amount: centsToAmount(cents),
      currency,
      direction: row.t === "d" ? "debit" : "credit",
      suggestion: suggestions.get(fold(merchant)) ?? null,
    });
  }

  // A draft that lost most of the statement would look complete.
  if (dropped.length * 2 > readRows.length) {
    return failure(dropped[0].reason, dropped[0].row);
  }

  const warnings: string[] = [];
  if (zeroAmounts > 0) warnings.push(`${zeroAmounts} ${zeroAmounts === 1 ? "row" : "rows"} with a zero amount skipped.`);
  if (dropped.length > 0) {
    warnings.push(
      `${dropped.length} ${dropped.length === 1 ? "row the AI read couldn't" : "rows the AI read couldn't"} be matched to the statement and ${dropped.length === 1 ? "was" : "were"} left out.`,
    );
  }
  if (yearless > 0) {
    warnings.push(
      `${yearless} ${yearless === 1 ? "date is" : "dates are"} printed without a year; ${
        statement.fullDates.length > 0 ? "the year was worked out from the statement's other dates" : "the most recent year that isn't in the future was used"
      }. Check ${yearless === 1 ? "it" : "them"} below.`,
    );
  }

  // The printed total of money out, when it is on its line and reads as an amount.
  const { t: printed, l: printedLine } = answer.s;
  let totalLine: number | null = null;
  if (printed !== null && printedLine !== null && Number.isInteger(printedLine) && printedLine >= 1 && printedLine <= lines.length) {
    const total = plainCents(printed);
    if (total !== null && amountOnLine(total, printedLine, statement)) {
      totalLine = printedLine;
      const sameCurrency = (row: VerifiedRow) => statementCurrency === null || row.currency === statementCurrency;
      const sum = rows
        .filter((row) => row.direction === "debit" && sameCurrency(row))
        .reduce((total, row) => total + Math.round(row.amount * 100), 0);
      const difference = Math.abs(total) - sum;
      if (difference !== 0) {
        warnings.push(
          `The rows read add up to ${money(sum)}, but the statement's printed total of money out is ${money(Math.abs(total))} (a difference of ${money(Math.abs(difference))}).`,
        );
      }
    }
  }

  // Lines with a date and an amount that no row cites (the printed total's line is not a transaction).
  const unread = transactionLines.filter((number) => !used.has(number) && number !== totalLine).length;
  if (unread > 0) {
    warnings.push(
      unread === 1 ? "1 line with an amount wasn't read as a transaction." : `${unread} lines with an amount weren't read as transactions.`,
    );
  }

  return { ok: true, rows, currency: statementCurrency, warnings, dropped };
}
