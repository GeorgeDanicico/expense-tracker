import { centsToAmount, detectDecimalMark, parseAmount, type DecimalMark } from "@/lib/imports/amount";
import { subtypeForCategory } from "@/lib/expenses/categories";
import { getBucharestToday } from "@/lib/calendar";
import { parseStatementDate, parseYearlessStatementDate, resolveYearlessDate } from "@/lib/imports/date";
import { blankDates, type NumberedStatement } from "@/lib/imports/ai/numbered-text";
import type { Classification } from "@/lib/imports/ai/categories";
import type { ReaderAnswer } from "@/lib/imports/ai/prompts";
import { IMPORT_CURRENCY_PATTERN, type ParsedRow } from "@/lib/imports/types";

/**
 * Code checks what the model read (docs/statement-import-plan.md, "How code checks the model").
 * Nothing it says is trusted until code has found it in the statement:
 *
 * 1. The date `d` and the amount `a` occur on the lines the row cites, as whole numbers (the
 *    amount "45.20" is not found in "145.20", nor "234.56" in "1,234.56"). Then code parses them,
 *    the amount with one decimal mark decided over every amount (`detectDecimalMark`) and the date
 *    with `parseStatementDate`: the model never supplies a number. In a CSV an amount is matched
 *    field by field, with the CSV reader's own delimiter and quoting, so "Mega Image 118,118.40"
 *    in a comma file is the store number 118 and the amount 118.40, while "1,118.40" in quotes is
 *    still the one amount 1118.40. A date printed without a year ("12.10", "12 oct.") is found the
 *    same way, and code gives it its year (`resolveYearlessDate`) from the other dates the
 *    statement prints, or else from today; the model never supplies a year either.
 * 2. Every word of the merchant `m` (case and accents folded) occurs on the cited lines, so a
 *    cleaned name can drop noise but cannot invent a shop.
 * 3. No line carries the amounts of two different transactions.
 * 4. When the statement prints its total of money out and code finds it on its line, the debits
 *    must add up to it to the cent. A difference is a warning, not a refusal.
 * 5. Lines that look like transactions that no row cites are counted in a warning.
 *
 * A row that fails 1 to 3 fails the whole statement: a partial draft would look complete. The
 * failure is a reason code and a row number, for the log. It never quotes the text.
 */

export type VerifyFailure =
  /** The model found nothing, but the statement has lines that look like transactions. */
  | "no_rows"
  /** A row cites no line, more than three, a line that doesn't exist, or lines that aren't consecutive. */
  | "bad_lines"
  | "date_not_found"
  | "date_unreadable"
  | "amount_not_found"
  | "amount_unreadable"
  /** No single decimal mark reads the amounts. */
  | "ambiguous_amounts"
  | "merchant_empty"
  | "merchant_not_found"
  /** Two transactions rest on the same line for their amounts. */
  | "line_reused"
  /** Neither the row nor the statement says which currency the amount is in. */
  | "no_currency";

/** A transaction the model read and code verified. Credits are kept (`direction`) for the pipeline to count and drop. */
export type VerifiedRow = ParsedRow & {
  /** The model's category for this row's merchant, or null when it gave none. */
  suggestion: Classification | null;
};

export type VerifyResult =
  | {
      ok: true;
      rows: VerifiedRow[];
      /** The statement's own currency when the model named one and the text bears it out. */
      currency: string | null;
      /** For the review screen. None quotes text from the statement. */
      warnings: string[];
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
 * Whether `value` (an amount as the model copied it, with its sign or currency if any) is written
 * on the line: the text occurs, and the number inside it is a whole number of the line, not a part
 * of a longer one. Dates are blanked first.
 */
function amountInText(value: string, line: string): boolean {
  const wanted = collapse(value);
  const inValue = numbers(wanted);
  if (inValue.length !== 1) return false;
  const [{ text: digits, start: offset }] = inValue;

  const haystack = blankDates(collapse(line));
  return numbers(haystack).some(
    (found) => found.text === digits && haystack.slice(found.start - offset, found.start - offset + wanted.length) === wanted,
  );
}

/**
 * Whether the amount is written on the numbered line `lineNumber`. In a PDF it is a whole number of
 * the line's text; in a CSV it is a whole number of one of the line's fields, so a number that runs
 * into the amount only through the delimiter ("118,118.40" in a comma file) is two numbers.
 */
function amountOnLine(value: string, lineNumber: number, statement: NumberedStatement): boolean {
  const fields = statement.csv?.fields[lineNumber - 1];
  if (!fields) return amountInText(value, statement.lines[lineNumber - 1]);
  return fields.some((field) => amountInText(value, field));
}

/** Whether the date, as the model copied it, is written in the text on its own: not inside a longer number or date. */
function dateOnLines(value: string, text: string): boolean {
  const wanted = collapse(value);
  if (wanted === "") return false;
  let from = 0;
  while (true) {
    const at = text.indexOf(wanted, from);
    if (at < 0) return false;
    const before = text.slice(0, at);
    const after = text.slice(at + wanted.length);
    if (!/[\d./-]$/.test(before) && !/^(?:\d|[./-]\d)/.test(after)) return true;
    from = at + 1;
  }
}

/**
 * Whether a date printed without a year, as the model copied it, is written in the text on its own:
 * not a part of a longer number or date ("12.10" is not in "112.10", "12.10.2026" or a signed
 * amount), not the first letters of a longer word ("12 oct" is not in "12 octombrie"), and not a
 * date whose year is printed right after it (the model must copy the year it is shown). When the
 * amount reads the same as the date, the text must hold it twice.
 */
function yearlessDateOnLines(value: string, text: string, amount: string): boolean {
  const wanted = collapse(value);
  if (wanted === "") return false;
  const amountDigits = numbers(collapse(amount))[0]?.text;
  const needed = amountDigits === wanted ? 2 : 1;

  let count = 0;
  let from = 0;
  while (true) {
    const at = text.indexOf(wanted, from);
    if (at < 0) break;
    const before = text.slice(0, at);
    const after = text.slice(at + wanted.length);
    const standsAlone =
      !/[\p{L}\p{N}./+-]$/u.test(before) &&
      !/^(?:\p{L}|\d|[./-]\d|,\d)/u.test(after) &&
      !/^[\s./-]*(?:19|20)\d{2}(?!\d|[.,]\d)/.test(after);
    if (standsAlone) count += 1;
    from = at + 1;
  }
  return count >= needed;
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
 * code, with the model's category for each merchant) and warnings, or the first check that failed.
 */
export function verifyReading(
  answer: ReaderAnswer,
  statement: NumberedStatement,
  options: VerifyOptions = {},
): VerifyResult {
  const { lines, transactionLines } = statement;
  const readRows = answer.r;

  if (readRows.length === 0) return transactionLines.length > 0 ? failure("no_rows") : { ok: true, rows: [], currency: null, warnings: [] };

  const cited: number[][] = [];
  for (const [index, row] of readRows.entries()) {
    const numbersCited = citedLines(row.l, lines.length);
    if (!numbersCited) return failure("bad_lines", index);
    cited.push(numbersCited);
  }

  // One decimal mark for every amount, as for a CSV's column. Nothing settling it is refused, never guessed.
  const decimal: DecimalMark | null = detectDecimalMark(readRows.map((row) => row.a));
  if (!decimal) return failure("ambiguous_amounts");

  const statementCurrency = currencyIn(answer.s.c, lines.join("\n"));
  const claimed = new Set<number>();
  const used = new Set<number>();
  const rows: VerifiedRow[] = [];
  let zeroAmounts = 0;
  let yearless = 0;
  const today = options.today ?? getBucharestToday();

  const suggestions = new Map<string, Classification>();
  for (const entry of answer.k) {
    const key = fold(collapse(entry.m));
    if (!suggestions.has(key)) suggestions.set(key, { category: entry.c, subtype: subtypeForCategory(entry.c, entry.s) });
  }

  for (const [index, row] of readRows.entries()) {
    const numbersCited = cited[index];
    const text = numbersCited.map((number) => lines[number - 1]).join(" ");

    // 1. The date and the amount are on the lines, and code reads them.
    let expenseDate: string | null;
    const dayMonth = parseStatementDate(row.d) === null ? parseYearlessStatementDate(row.d) : null;
    if (dayMonth) {
      // Printed without a year: found as written, then given a year by code, never by the model.
      if (!yearlessDateOnLines(row.d, collapse(text), row.a)) return failure("date_not_found", index);
      expenseDate = resolveYearlessDate(dayMonth, { fullDates: statement.fullDates, today });
      if (expenseDate) yearless += 1;
    } else {
      if (!dateOnLines(row.d, collapse(text))) return failure("date_not_found", index);
      expenseDate = parseStatementDate(row.d);
    }
    if (!expenseDate) return failure("date_unreadable", index);

    const onLine = numbersCited.filter((number) => amountOnLine(row.a, number, statement));
    if (onLine.length === 0) return failure("amount_not_found", index);
    const signed = parseAmount(row.a, { decimal });
    if (signed === null) return failure("amount_unreadable", index);

    // 3. A line carries one transaction's amount: take a line nobody has claimed.
    const amountLine = onLine.find((number) => !claimed.has(number));
    if (amountLine === undefined) return failure("line_reused", index);
    claimed.add(amountLine);
    numbersCited.forEach((number) => used.add(number));

    // 2. Every word of the merchant is on the lines.
    const merchant = collapse(row.m);
    const words = fold(merchant).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (words.length === 0) return failure("merchant_empty", index);
    const haystack = fold(text);
    if (!words.every((word) => haystack.includes(word))) return failure("merchant_not_found", index);

    const cents = Math.abs(signed);
    if (cents === 0) {
      zeroAmounts += 1;
      continue;
    }

    const currency = currencyIn(row.c, text) ?? statementCurrency;
    if (!currency) return failure("no_currency", index);

    rows.push({
      expenseDate,
      description: merchant,
      amount: centsToAmount(cents),
      currency,
      direction: row.t === "d" ? "debit" : "credit",
      suggestion: suggestions.get(fold(merchant)) ?? null,
    });
  }

  const warnings: string[] = [];
  if (zeroAmounts > 0) warnings.push(`${zeroAmounts} ${zeroAmounts === 1 ? "row" : "rows"} with a zero amount skipped.`);
  if (yearless > 0) {
    warnings.push(
      `${yearless} ${yearless === 1 ? "date is" : "dates are"} printed without a year; ${
        statement.fullDates.length > 0 ? "the year was worked out from the statement's other dates" : "the most recent year that isn't in the future was used"
      }. Check ${yearless === 1 ? "it" : "them"} below.`,
    );
  }

  // 4. The printed total of money out, when it is on its line and reads as an amount.
  const { t: printed, l: printedLine } = answer.s;
  let totalLine: number | null = null;
  if (printed !== null && printedLine !== null && Number.isInteger(printedLine) && printedLine >= 1 && printedLine <= lines.length) {
    if (amountOnLine(printed, printedLine, statement)) {
      totalLine = printedLine;
      const total = parseAmount(printed, { decimal });
      if (total !== null) {
        const sameCurrency = (row: VerifiedRow) => statementCurrency === null || row.currency === statementCurrency;
        const sum = rows
          .filter((row) => row.direction === "debit" && sameCurrency(row))
          .reduce((cents, row) => cents + Math.round(row.amount * 100), 0);
        const difference = Math.abs(total) - sum;
        if (difference !== 0) {
          warnings.push(
            `The rows read add up to ${money(sum)}, but the statement's printed total of money out is ${money(Math.abs(total))} (a difference of ${money(Math.abs(difference))}).`,
          );
        }
      }
    }
  }

  // 5. Lines with a date and an amount that no row cites (the printed total's line is not a transaction).
  const unread = transactionLines.filter((number) => !used.has(number) && number !== totalLine).length;
  if (unread > 0) {
    warnings.push(
      unread === 1 ? "1 line with an amount wasn't read as a transaction." : `${unread} lines with an amount weren't read as transactions.`,
    );
  }

  return { ok: true, rows, currency: statementCurrency, warnings };
}
