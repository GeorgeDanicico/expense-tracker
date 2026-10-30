import { createHash } from "node:crypto";

import { detectDelimiter, splitCsvLines, type CsvDelimiter } from "@/lib/imports/csv";
import { findPrintedDates } from "@/lib/imports/date";
import type { StatementSource } from "@/lib/imports/parser";
import { maskAccountNumbers } from "@/lib/imports/redact";

/**
 * The statement as the model reads it (docs/statement-import-plan.md, "How a statement is read"):
 * every non-empty line, masked of IBANs and card numbers, numbered `0001<tab>…`, with a
 * `--- page 2 ---` marker before each page of a PDF. The model cites line numbers, and
 * `verify.ts` looks the numbers up in `lines`, so what is sent and what is checked are the same text.
 *
 * Also counts the lines that look like a transaction (a date and an amount), which size the
 * output cap, and hashes the text: the content hash of a statement read by the model, because two
 * readings of one file can differ and the text doesn't.
 */

export type NumberedStatement = {
  /** What the model receives. */
  text: string;
  /** The masked lines; line number n (from 1) is `lines[n - 1]`. */
  lines: string[];
  /** The numbers of the lines that have a date and an amount on them. */
  transactionLines: number[];
  /** SHA-256 of `text`, as 64 lowercase hexadecimal characters. */
  hash: string;
  /**
   * Every date with a year that the statement prints, as `YYYY-MM-DD`, from any line: the context
   * that gives a date printed without a year its year. Computed from `lines`; never sent.
   */
  fullDates: string[];
  /**
   * For a CSV: the delimiter the CSV reader detects and each numbered line cut into fields with the
   * reader's own quoting rules (`fields[n - 1]` is line n), so `verify.ts` can match an amount as a
   * field and not as a stretch of text. Null for a PDF, whose columns are not delimited. Computed
   * from `lines`; never sent, and it is not part of `text` or `hash`.
   */
  csv: { delimiter: CsvDelimiter; fields: string[][] } | null;
};

/** An amount: digits with a decimal mark and one or two decimals ("45,20", "1.234,56", "-12.5"). */
const AMOUNT_IN_TEXT = /(?<!\d)(?<!\d[.,])\d[\d.,' ]*[.,]\d{1,2}(?!\d)/;

/**
 * Whether a line has a date and an amount on it. Only a date that prints its year counts (`2026-10-02`,
 * `02.10.2026`, `2 Oct 2026`): "12.10" could as well be an amount. Dates are taken out first, so
 * "12.10.2026" isn't read as the amount "12.10".
 */
export function looksLikeTransaction(line: string): boolean {
  const withoutDates = blankDates(line);
  return withoutDates !== line && AMOUNT_IN_TEXT.test(withoutDates);
}

/** The dates of a line that print a year, as `findPrintedDates` reads them. */
function datesWithYear(line: string, options?: Parameters<typeof findPrintedDates>[1]) {
  return findPrintedDates(line, options).filter((date) => date.year !== null);
}

/** The line with every date that prints a year (a 31.02.2026 too) replaced by spaces of the same length, so offsets are kept and a date's digits are never read as an amount. */
export function blankDates(line: string): string {
  let blanked = line;
  for (const { start, end } of datesWithYear(line, { impossible: true })) blanked = `${blanked.slice(0, start)}${" ".repeat(end - start)}${blanked.slice(end)}`;
  return blanked;
}

/** The dates with a year written in a line, as `YYYY-MM-DD`; one that doesn't exist (31.02.2026) is left out. */
export function fullDatesIn(line: string): string[] {
  return datesWithYear(line).map(({ day, month, year }) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

function pad(number: number): string {
  return String(number).padStart(4, "0");
}

/** Masks a line and collapses runs of spaces (tabs, which separate a PDF's columns, are kept). */
function cleanLine(line: string): string {
  return maskAccountNumbers(line).replace(/[^\S\t]+/g, " ").trim();
}

/** Numbers the lines of a CSV's text or a PDF's pages. Blank lines are dropped and not numbered. */
export function numberStatement(source: StatementSource): NumberedStatement {
  const pages = source.kind === "pdf" ? source.pages : [source.text.split(/\r\n|\r|\n/)];

  const lines: string[] = [];
  const transactionLines: number[] = [];
  const out: string[] = [];
  pages.forEach((page, index) => {
    if (source.kind === "pdf") out.push(`--- page ${index + 1} ---`);
    for (const raw of page) {
      const line = cleanLine(raw);
      if (line === "") continue;
      lines.push(line);
      const number = lines.length;
      if (looksLikeTransaction(line)) transactionLines.push(number);
      out.push(`${pad(number)}\t${line}`);
    }
  });

  const text = out.join("\n");
  const delimiter = source.kind === "csv" ? detectDelimiter(source.text.replace(/^\uFEFF/, "")) : null;
  return {
    text,
    lines,
    transactionLines,
    hash: createHash("sha256").update(text).digest("hex"),
    fullDates: lines.flatMap(fullDatesIn),
    csv: delimiter === null ? null : { delimiter, fields: splitCsvLines(lines, delimiter) },
  };
}
