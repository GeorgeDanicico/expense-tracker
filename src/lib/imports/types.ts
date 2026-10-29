import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";
import type { Expense } from "@/lib/expenses/types";

/**
 * Statement import: the shapes and limits shared by the parsers, the pipeline, the service and the
 * review screen (docs/statement-import-plan.md). Pure code, no Supabase, Next or UI imports. The
 * limits that the `import_batches` and `import_rows` checks repeat (rows, description, notes,
 * amount, currency, hash) are kept equal to them by hand; the migration is
 * `20261029000100_create_statement_imports.sql`.
 */

const MIB = 1024 * 1024;

/** The largest CSV body the upload accepts, in bytes. */
export const IMPORT_CSV_MAX_BYTES = 2 * MIB;
/** The largest PDF body the upload accepts, in bytes. */
export const IMPORT_PDF_MAX_BYTES = 5 * MIB;
/** The most rows a draft holds (`import_batches.row_count` and `create_import_batch` allow 1 to 500). */
export const IMPORT_MAX_ROWS = 500;
/** The most pages a PDF statement may have. */
export const IMPORT_MAX_PDF_PAGES = 30;
/** How long a draft lives after the upload, fixed: viewing doesn't extend it. */
export const IMPORT_DRAFT_HOURS = 24;

/** A description is 1 to 120 characters after trimming, as `import_rows` and `expenses` check. */
export const IMPORT_DESCRIPTION_MAX_LENGTH = 120;
/** Notes are at most 500 characters. */
export const IMPORT_NOTES_MAX_LENGTH = 500;
/** The largest amount a row may hold (`numeric(12, 2)`). */
export const IMPORT_MAX_AMOUNT = 9_999_999_999.99;
/** `import_batches.parser_id` is 1 to 60 characters. */
export const IMPORT_PARSER_ID_MAX_LENGTH = 60;
/** A currency is three uppercase ASCII letters, as `import_rows.currency` checks. */
export const IMPORT_CURRENCY_PATTERN = /^[A-Z]{3}$/;
/** `import_batches.content_hash`: 64 lowercase hexadecimal characters. */
export const IMPORT_CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The limits as one object, for callers that pass them around. */
export const ImportLimits = {
  csvMaxBytes: IMPORT_CSV_MAX_BYTES,
  pdfMaxBytes: IMPORT_PDF_MAX_BYTES,
  maxRows: IMPORT_MAX_ROWS,
  maxPdfPages: IMPORT_MAX_PDF_PAGES,
  draftHours: IMPORT_DRAFT_HOURS,
} as const;

/** What a statement was read from. Stored in `import_batches.source_kind`. */
export const IMPORT_SOURCE_KINDS = ["csv", "pdf"] as const;
export type ImportSourceKind = (typeof IMPORT_SOURCE_KINDS)[number];

/** A batch is a draft, then confirmed, then possibly undone. Stored in `import_batches.status`. */
export const IMPORT_STATUSES = ["draft", "confirmed", "undone"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** Money out is imported; money in is counted and skipped. */
export const ROW_DIRECTIONS = ["debit", "credit"] as const;
export type RowDirection = (typeof ROW_DIRECTIONS)[number];

/**
 * One transaction as a parser read it. `amount` is always positive, in major units of `currency`
 * (45.2 for 45.20); `direction` says whether it was money out or in. `expenseDate` is `YYYY-MM-DD`.
 */
export type ParsedRow = {
  expenseDate: string;
  description: string;
  amount: number;
  /** Three uppercase letters. */
  currency: string;
  direction: RowDirection;
};

/**
 * What a parser returns. `currency` is the statement's own when it has a single one; `periodStart`
 * and `periodEnd` are `YYYY-MM-DD`. `warnings` are for the review screen and must never contain
 * the text of a row.
 */
export type ParsedStatement = {
  parserId: string;
  rows: ParsedRow[];
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
  warnings?: string[];
};

/** An import as the lists and the review screen show it. */
export type ImportBatch = {
  id: string;
  status: ImportStatus;
  sourceKind: ImportSourceKind;
  parserId: string;
  currency: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  rowCount: number;
  skippedCredits: number;
  createdAt: string;
  /** Drafts only: `createdAt` plus 24 hours. */
  expiresAt: string | null;
  confirmedAt: string | null;
  /** How many expenses the confirmation created. */
  confirmedCount: number | null;
  undoneAt: string | null;
};

/** The existing expense a draft row looks like, as the review screen quotes it. */
export type DuplicateOf = Pick<Expense, "id" | "description" | "expenseDate" | "amount">;

/**
 * A draft row. `category` and `subtype` are the suggestion; `ruleMatched` says the merchant
 * classification set them. `duplicateOf` is worked out each time the draft is read, never stored.
 * `importable` is false for a row in another currency than the user's.
 */
export type DraftRow = {
  id: string;
  /** The row's place in the statement, from 1. */
  position: number;
  expenseDate: string;
  description: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
  ruleMatched: boolean;
  notes: string | null;
  duplicateOf: DuplicateOf | null;
  importable: boolean;
};

export type ImportDraft = {
  batch: ImportBatch;
  rows: DraftRow[];
};

/** The `p_batch` object of `create_import_batch`: the database fills in the user, status and expiry. */
export type CreateImportBatchPayload = {
  source_kind: ImportSourceKind;
  parser_id: string;
  content_hash: string;
  currency?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  skipped_credits?: number;
};

/** One element of the `p_rows` array of `create_import_batch`; the position is the array index. */
export type CreateImportRowPayload = {
  expense_date: string;
  description: string;
  amount: number;
  currency: string;
  notes?: string | null;
};

/** One element of the `p_rows` array of `confirm_import_batch`: a row's final values. */
export type ConfirmImportRowPayload = {
  id: string;
  description: string;
  amount: number;
  expense_date: string;
  category: ExpenseCategory;
  subtype?: ExpenseSubtype | null;
  notes?: string | null;
};

/**
 * Every way an import can be refused, so the screen can tell them apart. The upload guard, the
 * pipeline, the PDF reader and the service use them.
 */
export const IMPORT_ERROR_CODES = [
  "unsupported_type",
  "file_too_large",
  "empty_file",
  "pdf_not_supported",
  "unrecognised_layout",
  "unreadable_statement",
  "ambiguous_amounts",
  "no_text",
  "encrypted_pdf",
  "too_many_pages",
  "too_many_rows",
  "no_debits",
  "already_imported",
  "rate_limited",
] as const;

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

/** The HTTP status each code maps to: 409 conflict, 413 too large, 415 wrong type, 422 unprocessable, 429 rate limit. */
export const IMPORT_ERROR_STATUS: Record<ImportErrorCode, 409 | 413 | 415 | 422 | 429> = {
  unsupported_type: 415,
  file_too_large: 413,
  empty_file: 422,
  pdf_not_supported: 415,
  unrecognised_layout: 422,
  unreadable_statement: 422,
  ambiguous_amounts: 422,
  no_text: 422,
  encrypted_pdf: 422,
  too_many_pages: 422,
  too_many_rows: 422,
  no_debits: 422,
  already_imported: 409,
  rate_limited: 429,
};

/** The default message for each code. None of them contains text from the file. */
export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  unsupported_type: "Upload a CSV statement.",
  file_too_large: "Choose a smaller statement.",
  empty_file: "That file is empty.",
  pdf_not_supported: "PDF statements aren't supported yet.",
  unrecognised_layout: "This statement's layout isn't supported yet.",
  unreadable_statement: "This statement couldn't be read.",
  ambiguous_amounts: "The amounts in this statement can't be read without guessing.",
  no_text: "This PDF is a scan; scanned statements aren't supported.",
  encrypted_pdf: "This PDF is password protected.",
  too_many_pages: `This PDF has more than ${IMPORT_MAX_PDF_PAGES} pages.`,
  too_many_rows: `This statement has more than ${IMPORT_MAX_ROWS} transactions.`,
  no_debits: "This statement has no payments to import.",
  already_imported: "You already imported this statement.",
  rate_limited: "Too many uploads. Try again later.",
};

/** The message for a file over its limit: "Choose a statement under 2 MB." (5 MB for a PDF). */
export function tooLargeMessage(kind: ImportSourceKind): string {
  const bytes = kind === "pdf" ? IMPORT_PDF_MAX_BYTES : IMPORT_CSV_MAX_BYTES;
  return `Choose a statement under ${bytes / MIB} MB.`;
}

/**
 * A refused import. `message` is for the user and never contains text from the file; it defaults
 * to the code's message. `status` is the HTTP status the code maps to.
 */
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly status: 409 | 413 | 415 | 422 | 429;

  constructor(code: ImportErrorCode, message: string = IMPORT_ERROR_MESSAGES[code]) {
    super(message);
    this.name = "ImportError";
    this.code = code;
    this.status = IMPORT_ERROR_STATUS[code];
  }
}
