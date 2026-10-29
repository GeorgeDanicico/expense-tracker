import { centsToAmount, detectDecimalMark, parseAmount, type DecimalMark } from "@/lib/imports/amount";
import { readCsv } from "@/lib/imports/csv";
import { parseStatementDate } from "@/lib/imports/date";
import type { StatementParser, StatementSource } from "@/lib/imports/parser";
import {
  IMPORT_CURRENCY_PATTERN,
  ImportError,
  type ParsedRow,
  type ParsedStatement,
} from "@/lib/imports/types";

/**
 * The baseline CSV parser: a statement whose header names a date, a description and an amount (or
 * a debit) column. It never picks a column by position. Per-bank parsers are registered before it.
 *
 * - The header row is the first of the first 20 records whose cells, compared by name, include a
 *   date, a description and an amount or debit column. Records above it (account details, a title)
 *   are ignored.
 * - Money is either one signed column ("Amount": negative is money out, positive is money in) or
 *   separate "Debit" and "Credit" columns. When an amount column exists, debit and credit columns
 *   are ignored. A debit-only file takes every value as money out.
 * - The decimal mark is decided once per amount column (`detectDecimalMark`); a column where
 *   nothing settles it is refused (`ambiguous_amounts`).
 * - The currency comes from a currency column, or else from a code or symbol written in the
 *   amount ("45,20 RON", "€45.20"). A statement with neither is refused: the row type needs a
 *   currency and one isn't guessed.
 * - Credits are kept as rows with `direction: "credit"` for the pipeline to count and drop.
 * - A line with neither a date nor an amount (a blank-ish line, a footer) is skipped and counted
 *   in a warning. Any other line that can't be read refuses the whole file ("Row 14 couldn't be
 *   read."), because dropping a payment silently is worse than a refusal. Messages carry the row
 *   number, never its text.
 */

export const GENERIC_CSV_PARSER_ID = "generic-csv";

/** How many records are searched for the header row. */
const HEADER_SCAN_RECORDS = 20;

/**
 * Header names by role, after normalisation (lower case, accents removed, punctuation as spaces),
 * in priority order when a file has several. English only; the list grows when real samples show
 * other names. A "value date" is deliberately not a date: it is a settlement date, and which date
 * an expense carries is a per-bank decision.
 */
const DATE_NAMES = ["date", "transaction date", "posting date", "booking date"] as const;
const DESCRIPTION_NAMES = [
  "description",
  "transaction description",
  "details",
  "transaction details",
  "merchant",
  "merchant name",
  "payee",
  "narrative",
] as const;
const AMOUNT_NAMES = ["amount", "transaction amount"] as const;
const DEBIT_NAMES = ["debit", "debit amount", "withdrawal", "withdrawals", "paid out", "money out"] as const;
const CREDIT_NAMES = ["credit", "credit amount", "deposit", "deposits", "paid in", "money in"] as const;
const CURRENCY_NAMES = ["currency", "currency code", "ccy"] as const;

type Layout = {
  /** The index of the header record. */
  header: number;
  date: number;
  description: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  currency: number | null;
};

function normaliseHeader(cell: string): string {
  return cell
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mapHeader(cells: readonly string[], header: number): Layout | null {
  const names = cells.map(normaliseHeader);
  const pick = (synonyms: readonly string[]): number | null => {
    for (const name of synonyms) {
      const index = names.indexOf(name);
      if (index >= 0) return index;
    }
    return null;
  };

  const date = pick(DATE_NAMES);
  const description = pick(DESCRIPTION_NAMES);
  if (date === null || description === null) return null;

  const amount = pick(AMOUNT_NAMES);
  const debit = amount === null ? pick(DEBIT_NAMES) : null;
  if (amount === null && debit === null) return null;
  const credit = amount === null ? pick(CREDIT_NAMES) : null;

  return { header, date, description, amount, debit, credit, currency: pick(CURRENCY_NAMES) };
}

function findLayout(records: readonly string[][]): Layout | null {
  const scanned = Math.min(records.length, HEADER_SCAN_RECORDS);
  for (let index = 0; index < scanned; index += 1) {
    const layout = mapHeader(records[index], index);
    if (layout) return layout;
  }
  return null;
}

const cellOf = (record: readonly string[], index: number | null): string =>
  index === null ? "" : (record[index] ?? "").trim();

/** A currency written in an amount: a three-letter code, "lei", or a euro or pound sign. */
function currencyIn(text: string): string | null {
  const code = /(?<!\p{L})[A-Z]{3}(?!\p{L})/u.exec(text);
  if (code) return code[0];
  if (/(?<!\p{L})lei(?!\p{L})/iu.test(text)) return "RON";
  if (text.includes("€")) return "EUR";
  if (text.includes("£")) return "GBP";
  return null;
}

function unreadableRow(ordinal: number): ImportError {
  return new ImportError("unreadable_statement", `Row ${ordinal} of this statement couldn't be read.`);
}

function matches(source: StatementSource): boolean {
  if (source.kind !== "csv") return false;
  const { records } = readCsv(source.text, { maxRecords: HEADER_SCAN_RECORDS });
  return findLayout(records) !== null;
}

function parse(source: StatementSource): ParsedStatement {
  if (source.kind !== "csv") throw new ImportError("unrecognised_layout");
  const { records } = readCsv(source.text);
  const layout = findLayout(records);
  if (!layout) throw new ImportError("unrecognised_layout");

  const data = records
    .slice(layout.header + 1)
    .filter((record) => record.some((cell) => cell.trim() !== ""));

  const decimalFor = (index: number | null): DecimalMark => {
    if (index === null) return ".";
    const cells = data.map((record) => cellOf(record, index)).filter((cell) => cell !== "");
    const mark = detectDecimalMark(cells);
    if (!mark) throw new ImportError("ambiguous_amounts");
    return mark;
  };
  const marks = {
    amount: decimalFor(layout.amount),
    debit: decimalFor(layout.debit),
    credit: decimalFor(layout.credit),
  };

  const rows: ParsedRow[] = [];
  let skippedLines = 0;
  let zeroAmounts = 0;

  data.forEach((record, position) => {
    const ordinal = position + 1;
    const dateText = cellOf(record, layout.date);
    const amountText = cellOf(record, layout.amount);
    const debitText = cellOf(record, layout.debit);
    const creditText = cellOf(record, layout.credit);

    if (dateText === "" && amountText === "" && debitText === "" && creditText === "") {
      skippedLines += 1;
      return;
    }

    const expenseDate = parseStatementDate(dateText);
    const description = cellOf(record, layout.description).replace(/\s+/g, " ").trim();
    if (!expenseDate || description === "") throw unreadableRow(ordinal);

    let cents: number;
    let direction: ParsedRow["direction"];
    let moneyText: string;
    if (layout.amount !== null) {
      const parsed = parseAmount(amountText, { decimal: marks.amount });
      if (parsed === null) throw unreadableRow(ordinal);
      cents = Math.abs(parsed);
      direction = parsed < 0 ? "debit" : "credit";
      moneyText = amountText;
    } else {
      const debit = debitText === "" ? null : parseAmount(debitText, { decimal: marks.debit });
      const credit = creditText === "" ? null : parseAmount(creditText, { decimal: marks.credit });
      if (debit === null && credit === null) throw unreadableRow(ordinal);
      if ((debitText !== "" && debit === null) || (creditText !== "" && credit === null)) {
        throw unreadableRow(ordinal);
      }
      if (debit && credit) throw unreadableRow(ordinal);
      if (debit) {
        cents = Math.abs(debit);
        direction = "debit";
        moneyText = debitText;
      } else {
        cents = Math.abs(credit ?? 0);
        direction = "credit";
        moneyText = creditText;
      }
    }

    if (cents === 0) {
      zeroAmounts += 1;
      return;
    }

    let currency: string | null;
    if (layout.currency !== null) {
      currency = cellOf(record, layout.currency).toUpperCase();
      if (!IMPORT_CURRENCY_PATTERN.test(currency)) throw unreadableRow(ordinal);
    } else {
      currency = currencyIn(moneyText);
      if (!currency) {
        throw new ImportError("unreadable_statement", "This statement doesn't say which currency its amounts are in.");
      }
    }

    rows.push({ expenseDate, description, amount: centsToAmount(cents), currency, direction });
  });

  const dates = rows.map((row) => row.expenseDate).sort();
  const currencies = new Set(rows.map((row) => row.currency));
  const warnings: string[] = [];
  if (skippedLines > 0) {
    warnings.push(`${skippedLines} ${skippedLines === 1 ? "line" : "lines"} without a date or an amount skipped.`);
  }
  if (zeroAmounts > 0) {
    warnings.push(`${zeroAmounts} ${zeroAmounts === 1 ? "row" : "rows"} with a zero amount skipped.`);
  }

  return {
    parserId: GENERIC_CSV_PARSER_ID,
    rows,
    ...(currencies.size === 1 ? { currency: [...currencies][0] } : {}),
    ...(dates.length > 0 ? { periodStart: dates[0], periodEnd: dates[dates.length - 1] } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export const genericCsvParser: StatementParser = {
  id: GENERIC_CSV_PARSER_ID,
  label: "Generic CSV",
  kinds: ["csv"],
  matches,
  parse,
};
