import { decodeStatementText } from "@/lib/imports/decode";
import { statementHash } from "@/lib/imports/hash";
import { parseStatement } from "@/lib/imports/parser";
import { maskAccountNumbers } from "@/lib/imports/redact";
import {
  IMPORT_CURRENCY_PATTERN,
  IMPORT_DESCRIPTION_MAX_LENGTH,
  IMPORT_MAX_AMOUNT,
  IMPORT_MAX_ROWS,
  IMPORT_NOTES_MAX_LENGTH,
  ImportError,
  type CreateImportBatchPayload,
  type CreateImportRowPayload,
  type ImportSourceKind,
  type ParsedRow,
  type ParsedStatement,
} from "@/lib/imports/types";

/**
 * Turns an uploaded statement into draft rows, in memory (docs/statement-import-plan.md, task I4).
 * Nothing here writes, logs or keeps the file: it decodes, parses, drops the incoming payments,
 * masks account numbers, checks the limits and hashes the result. Every error it throws is an
 * `ImportError` whose message never contains text from the file.
 */

/** What `buildDraft` returns: the `create_import_batch` arguments, plus what the screen shows. */
export type StatementDraft = {
  batch: CreateImportBatchPayload & {
    source_kind: ImportSourceKind;
    parser_id: string;
    content_hash: string;
    currency: string | null;
    period_start: string | null;
    period_end: string | null;
    skipped_credits: number;
  };
  /** The debits in statement order; each one's position is its index plus one. */
  rows: CreateImportRowPayload[];
  /** Messages from the parser and the pipeline for the review screen; none carries text from a row. */
  warnings: string[];
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A parser's row is checked against the limits the database repeats, so a bad one fails here with a plain message. */
function isWellFormed(row: ParsedRow): boolean {
  return (
    DATE_PATTERN.test(row.expenseDate) &&
    IMPORT_CURRENCY_PATTERN.test(row.currency) &&
    Number.isFinite(row.amount) &&
    row.amount > 0 &&
    row.amount <= IMPORT_MAX_AMOUNT &&
    typeof row.description === "string" &&
    (row.direction === "debit" || row.direction === "credit")
  );
}

/** Cuts text after `length` UTF-16 units without splitting a surrogate pair. */
function cutAt(text: string, length: number): number {
  const code = text.charCodeAt(length - 1);
  return code >= 0xd800 && code <= 0xdbff ? length - 1 : length;
}

/**
 * Splits a description into the part that fits the expense limit and the overflow for the notes.
 * The notes are capped too; `clipped` says the end of a very long description had to be dropped.
 */
function splitDescription(text: string): { description: string; notes: string | null; clipped: boolean } {
  if (text.length <= IMPORT_DESCRIPTION_MAX_LENGTH) return { description: text, notes: null, clipped: false };
  const cut = cutAt(text, IMPORT_DESCRIPTION_MAX_LENGTH);
  const description = text.slice(0, cut).trimEnd();
  const overflow = text.slice(cut).trimStart();
  if (overflow.length <= IMPORT_NOTES_MAX_LENGTH) return { description, notes: overflow || null, clipped: false };
  const notesCut = cutAt(overflow, IMPORT_NOTES_MAX_LENGTH);
  return { description, notes: overflow.slice(0, notesCut).trimEnd(), clipped: true };
}

/** The statement's currency when the kept rows (or the parser) name exactly one. */
function statementCurrency(parsed: ParsedStatement, debits: readonly ParsedRow[]): string | null {
  if (parsed.currency && IMPORT_CURRENCY_PATTERN.test(parsed.currency)) return parsed.currency;
  const currencies = new Set(debits.map((row) => row.currency));
  return currencies.size === 1 ? [...currencies][0] : null;
}

function parse(kind: ImportSourceKind, bytes: Uint8Array): ParsedStatement {
  // Task I12 adds the PDF reader and replaces this refusal.
  if (kind === "pdf") throw new ImportError("pdf_not_supported");
  return parseStatement({ kind: "csv", text: decodeStatementText(bytes) });
}

/**
 * Parses an upload into a draft: decodes the text, finds a parser (`unrecognised_layout` when none
 * claims it), keeps the debits and counts the credits, masks IBAN- and card-number-shaped text in
 * each description and moves anything past 120 characters to the row's notes, then refuses a
 * statement with no debits (`no_debits`) or more than 500 of them (`too_many_rows`) and hashes the
 * rows. A PDF is refused (`pdf_not_supported`, 415) until I12.
 *
 * The hash covers the masked descriptions, so an account number never reaches it.
 */
export function buildDraft({ kind, bytes }: { kind: ImportSourceKind; bytes: Uint8Array }): StatementDraft {
  let parsed: ParsedStatement;
  try {
    parsed = parse(kind, bytes);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    // Whatever went wrong may mention the file; say only that it couldn't be read.
    throw new ImportError("unreadable_statement");
  }

  if (!parsed.rows.every(isWellFormed)) throw new ImportError("unreadable_statement");

  const warnings = [...(parsed.warnings ?? [])];
  const credits = parsed.rows.filter((row) => row.direction === "credit").length;
  const debits = parsed.rows
    .filter((row) => row.direction === "debit")
    .map((row) => ({ ...row, description: maskAccountNumbers(row.description.replace(/\s+/g, " ").trim()) }));

  if (debits.length === 0) throw new ImportError("no_debits");
  if (debits.length > IMPORT_MAX_ROWS) throw new ImportError("too_many_rows");
  if (debits.some((row) => row.description === "")) throw new ImportError("unreadable_statement");

  let clippedRows = 0;
  const rows = debits.map((row): CreateImportRowPayload => {
    const { description, notes, clipped } = splitDescription(row.description);
    if (clipped) clippedRows += 1;
    return {
      expense_date: row.expenseDate,
      description,
      amount: row.amount,
      currency: row.currency,
      notes,
    };
  });
  if (clippedRows > 0) {
    warnings.push(
      `${clippedRows} ${clippedRows === 1 ? "description was" : "descriptions were"} too long to keep whole; the end was cut.`,
    );
  }

  return {
    batch: {
      source_kind: kind,
      parser_id: parsed.parserId,
      content_hash: statementHash(debits),
      currency: statementCurrency(parsed, debits),
      period_start: parsed.periodStart ?? null,
      period_end: parsed.periodEnd ?? null,
      skipped_credits: credits,
    },
    rows,
    warnings,
  };
}
