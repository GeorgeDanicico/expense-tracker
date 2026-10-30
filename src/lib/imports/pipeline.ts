import {
  assignCategories,
  planCategories,
  type Assignment,
  type Classification,
  type MerchantHistory,
} from "@/lib/imports/ai/categories";
import { numberStatement, type NumberedStatement } from "@/lib/imports/ai/numbered-text";
import { STATEMENT_CATEGORISE_PROMPT_ID, STATEMENT_READER_PROMPT_ID } from "@/lib/imports/ai/prompts";
import { categoriseMerchants, readStatement, type StatementAi } from "@/lib/imports/ai/reader";
import { verifyReading, type VerifiedRow } from "@/lib/imports/ai/verify";
import { decodeStatementText } from "@/lib/imports/decode";
import { statementHash } from "@/lib/imports/hash";
import { findParser, parseStatement, UnrecognisedLayoutError, type StatementSource } from "@/lib/imports/parser";
import { extractPdfText } from "@/lib/imports/pdf-text";
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
  type ImportErrorCode,
  type ImportSourceKind,
  type ParsedRow,
  type ParsedStatement,
} from "@/lib/imports/types";

/**
 * Turns an uploaded statement into draft rows, in memory (docs/statement-import-plan.md, tasks I4
 * and I17). Nothing here writes, logs or keeps the file: it decodes, parses, drops the incoming
 * payments, masks account numbers, checks the limits and hashes the result. Every error it throws
 * is an `ImportError` whose message never contains text from the file.
 *
 * Who reads the rows depends on the file and on the user's AI state (`options.ai`, present only
 * when they opted in):
 *
 * - A PDF with AI on: the model reads the numbered text (mode "read") and code checks every row
 *   against that text before anything becomes a draft, whether or not a parser would have claimed
 *   it. If the model can't be asked (the flag is off, the month's budget is used up, the statement
 *   is too long) or its answer doesn't hold up, a parser that claims the file reads it instead, as
 *   with AI off. With no parser either, the user gets the reader's error: `unrecognised_layout`
 *   with the gate's reason when it couldn't be asked, `unverified_statement` when it was.
 * - A CSV, or a PDF with AI off, that a parser claims: the parser reads the rows, as built. With AI
 *   on, the merchants neither the merchant rule nor the user's history know go to the model in one
 *   small call (mode "categorise") for a category each.
 * - A CSV no parser claims and AI is on: the model reads it (mode "read").
 * - No parser claims it and AI is off: `unrecognised_layout`, as before.
 * - A parser claims a CSV and then can't read its rows (`PARSER_ERRORS_READ_BY_MODEL`) and AI is
 *   on: the model reads it as if no parser had claimed it. If the AI gate then refuses to make the
 *   call the parser's own error is what the user gets, exactly as with AI off.
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

export type BuildDraftOptions = {
  /** Present when the user has turned AI reading on. Without it nothing here calls a model or reads their history. */
  ai?: StatementAi | null;
  /** One line per model-assisted step: modes, counts and outcomes, never a prompt, an answer or a row. Defaults to `console.info`. */
  log?: (line: Record<string, unknown>) => void;
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

/** The parser id of a batch the model read (mode "read"). */
export const READER_PARSER_ID = `ai:${STATEMENT_READER_PROMPT_ID}`;

/**
 * The errors of a claiming parser that mean "I recognised the layout but couldn't read its rows",
 * which the model may still be able to read: `unreadable_statement` (a row that isn't a date, a
 * description and an amount, no currency on the rows, a quote that is never closed). Everything
 * else stays the parser's refusal, with no call: `ambiguous_amounts` (a parser's own refusal to
 * guess the decimal mark of its column) and the limits, which are not parser errors at all: the
 * size and signature checks come before any parsing, and `no_debits` and `too_many_rows` are
 * decided after a successful read, whoever read it.
 */
const PARSER_ERRORS_READ_BY_MODEL: ReadonlySet<ImportErrorCode> = new Set(["unreadable_statement"]);

/** The gate or the configuration refused the call, so no model was asked. Kept apart so a parser's own error can stand in for it. */
class ReaderUnavailableError extends ImportError {}

const AI_UNREACHABLE = "The AI reader couldn't be reached. Try again in a few minutes.";
const AI_BUSY = "The AI reader is busy. Try again in a minute.";
const NO_CURRENCY = "This statement doesn't say which currency its amounts are in.";

async function readSource(kind: ImportSourceKind, bytes: Uint8Array): Promise<StatementSource> {
  if (kind === "pdf") {
    const pages = await extractPdfText(bytes);
    return { kind: "pdf", text: pages.flat().join("\n"), pages };
  }
  return { kind: "csv", text: decodeStatementText(bytes) };
}

/** A row the pipeline works on: what the parser or the reader gave, and the model's category when it read the row. */
type Candidate = ParsedRow & { suggestion?: Classification | null };
type ParsedCandidates = Omit<ParsedStatement, "rows"> & { rows: Candidate[] };

/** What mode "read" produced: the statement as verified rows, in the shape a parser returns, and the text that was read. */
type Reading = { parsed: Omit<ParsedStatement, "rows"> & { rows: VerifiedRow[] }; numbered: NumberedStatement };

/**
 * Mode "read": numbers the masked lines, asks the model for the rows and checks every one against
 * the text; a row that doesn't hold up is left out with a warning. Refuses, with a message that
 * never quotes the statement, when the model can't be asked (`unrecognised_layout`, with the
 * gate's reason), when its answer is unusable or most of it doesn't hold up against the text
 * (`unverified_statement`) or when no currency is stated.
 */
async function readWithModel(
  ai: StatementAi,
  source: StatementSource,
  log: NonNullable<BuildDraftOptions["log"]>,
): Promise<Reading> {
  const numbered = numberStatement(source);
  if (numbered.lines.length === 0) throw new ImportError("unreadable_statement");

  let result: Awaited<ReturnType<typeof readStatement>>;
  try {
    result = await readStatement(ai, numbered);
  } catch {
    // Nothing here is worth quoting: the call itself failed in our own code.
    log({ mode: "read", outcome: "error" });
    throw new ImportError("unverified_statement", AI_UNREACHABLE);
  }

  if (result.status === "refused") {
    log({ mode: "read", outcome: "refused", reason: result.reason });
    throw new ReaderUnavailableError(
      "unrecognised_layout",
      `This statement's layout isn't supported yet, and the AI reader can't be used right now. ${result.message}`,
    );
  }
  if (result.status === "failed") {
    log({ mode: "read", outcome: result.reason });
    if (result.reason === "rate_limited") throw new ImportError("rate_limited", AI_BUSY);
    if (result.reason === "timeout" || result.reason === "provider_error") {
      throw new ImportError("unverified_statement", AI_UNREACHABLE);
    }
    // Cut off at the output cap, declined, or not the shape asked for.
    throw new ImportError("unverified_statement");
  }

  const verified = verifyReading(result.answer, numbered);
  if (!verified.ok) {
    // The reason and the row's position only; the text stays out of the log.
    log({ mode: "read", outcome: "unverified", reason: verified.reason, row: verified.row });
    if (verified.reason === "no_currency") throw new ImportError("unreadable_statement", NO_CURRENCY);
    throw new ImportError("unverified_statement");
  }
  // The rows left out are named by reason and position only; the text stays out of the log.
  log({
    mode: "read",
    outcome: "ok",
    rows: verified.rows.length,
    warnings: verified.warnings.length,
    ...(verified.dropped.length > 0 ? { dropped: verified.dropped } : {}),
  });

  const dates = verified.rows.map((row) => row.expenseDate).sort();
  return {
    numbered,
    parsed: {
      parserId: READER_PARSER_ID,
      rows: verified.rows,
      ...(verified.currency ? { currency: verified.currency } : {}),
      ...(dates.length > 0 ? { periodStart: dates[0], periodEnd: dates[dates.length - 1] } : {}),
      ...(verified.warnings.length > 0 ? { warnings: verified.warnings } : {}),
    },
  };
}

type CategoryOutcome = {
  /** Per row, in order: the history's or the model's category; null for a row the merchant rule knows or nobody does. */
  assignments: (Assignment | null)[];
  /** Mode "categorise" was called and answered: the batch's `parser_id` says so. */
  categorised: boolean;
  warnings: string[];
};

/**
 * The category order of the plan: merchant rule, then the user's history, then the model. The rule
 * and the history are applied first, so the merchants they know are never sent. With `suggestions`
 * (mode "read") the model has answered already, in the same call that read the rows; without them,
 * the merchants still unknown go to the model in mode "categorise". A model that can't be asked, or
 * gives nothing usable, leaves those rows as Other with a warning.
 */
async function chooseCategories(
  ai: StatementAi,
  descriptions: readonly string[],
  suggestions: readonly (Classification | null)[] | null,
  log: NonNullable<BuildDraftOptions["log"]>,
): Promise<CategoryOutcome> {
  let history: MerchantHistory;
  try {
    history = await ai.loadHistory();
  } catch {
    // The history is a convenience: without it the model's categories still apply.
    log({ mode: "history", outcome: "error" });
    history = new Map();
  }

  const plan = planCategories(descriptions, history);
  const warnings: string[] = [];
  let answers: (Classification | null)[] = plan.unknown.map(() => null);
  let categorised = false;

  if (suggestions) {
    plan.rows.forEach((row, index) => {
      if (row.kind === "unknown" && answers[row.group] === null) answers[row.group] = suggestions[index];
    });
    const missing = answers.filter((answer) => answer === null).length;
    if (missing > 0) {
      warnings.push(
        `${missing} ${missing === 1 ? "merchant wasn't" : "merchants weren't"} categorised and ${missing === 1 ? "is" : "are"} left as Other.`,
      );
    }
  } else if (plan.unknown.length > 0) {
    log({ mode: "categorise", merchants: plan.unknown.length, known: descriptions.length - plan.rows.filter((row) => row.kind === "unknown").length });
    try {
      const result = await categoriseMerchants(ai, plan.unknown);
      if (result.status === "ok") {
        answers = result.classifications;
        categorised = true;
      } else {
        warnings.push(result.message);
      }
      log({ mode: "categorise", outcome: result.status, ...(result.status === "unavailable" ? { reason: result.reason } : {}) });
    } catch {
      log({ mode: "categorise", outcome: "error" });
      warnings.push("Categories couldn't be suggested this time, so the payments are left as Other.");
    }
  }

  return { assignments: assignCategories(plan, (group) => answers[group] ?? null), categorised, warnings };
}

/**
 * Parses an upload into a draft: decodes the text (a PDF's text is read by `extractPdfText`, which
 * refuses a protected, scanned or over-long PDF), then has the file read as the module comment
 * says: a PDF by the model when AI is on, a parser's file by the parser, a CSV no parser claims or
 * claims and can't read (see `PARSER_ERRORS_READ_BY_MODEL`) by the model when AI is on, and
 * `unrecognised_layout` when nobody can. The model's rows are verified against the text first.
 * Then it keeps the debits and counts the credits, masks IBAN- and card-number-shaped text in each
 * description and moves anything past 120 characters to the row's notes, then refuses a statement
 * with no debits (`no_debits`) or more than 500 of them (`too_many_rows`) and hashes it. With AI on,
 * each row also gets a first category, from the merchant rule, the user's history or the model.
 *
 * The hash covers the masked descriptions, so an account number never reaches it. For a statement
 * the model read it is the hash of the masked, numbered text instead: two readings of one file can
 * differ, and the text doesn't.
 */
export async function buildDraft(
  { kind, bytes }: { kind: ImportSourceKind; bytes: Uint8Array },
  options: BuildDraftOptions = {},
): Promise<StatementDraft> {
  const ai = options.ai ?? null;
  const log = options.log ?? ((line: Record<string, unknown>) => console.info("Statement import", line));

  let source: StatementSource;
  try {
    source = await readSource(kind, bytes);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    // Whatever went wrong may mention the file; say only that it couldn't be read.
    throw new ImportError("unreadable_statement");
  }

  let parsed: ParsedCandidates;
  let numbered: NumberedStatement | null = null;
  const readByModel = async (model: StatementAi) => {
    try {
      return await readWithModel(model, source, log);
    } catch (error) {
      if (error instanceof ImportError) throw error;
      throw new ImportError("unreadable_statement");
    }
  };
  /** The claiming parser's rows; its refusal is an `ImportError` with nothing from the file in it. */
  const readByParser = (): ParsedCandidates => {
    try {
      return parseStatement(source);
    } catch (error) {
      throw error instanceof ImportError ? error : new ImportError("unreadable_statement");
    }
  };

  const claimed = findParser(source) !== null;

  if (kind === "pdf" && ai) {
    // The model reads a PDF whenever it can be asked; a parser is the way out when it can't or when
    // its answer doesn't hold up.
    try {
      ({ parsed, numbered } = await readByModel(ai));
    } catch (readError) {
      if (!claimed) throw readError;
      log({ mode: "read", fallbackTo: "parser", ...(readError instanceof ImportError ? { reason: readError.code } : {}) });
      try {
        parsed = readByParser();
      } catch (parseError) {
        // Not asked: the parser's own error, as with AI off. Asked and failed: the reader's, which says more.
        throw readError instanceof ReaderUnavailableError ? parseError : readError;
      }
    }
  } else if (claimed) {
    try {
      parsed = readByParser();
    } catch (error) {
      const refusal = error as ImportError;
      if (!ai || !PARSER_ERRORS_READ_BY_MODEL.has(refusal.code)) throw refusal;

      // A parser claimed the layout and couldn't read its rows: the model reads the text instead.
      log({ mode: "read", fallbackFrom: refusal.code });
      try {
        ({ parsed, numbered } = await readByModel(ai));
      } catch (readError) {
        // The model was never asked: the parser's own error, as with AI off.
        throw readError instanceof ReaderUnavailableError ? refusal : readError;
      }
    }
  } else if (ai) {
    ({ parsed, numbered } = await readByModel(ai));
  } else {
    throw new UnrecognisedLayoutError();
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

  let parserId = parsed.parserId;
  if (ai) {
    const chosen = await chooseCategories(
      ai,
      rows.map((row) => row.description),
      numbered ? debits.map((row) => row.suggestion ?? null) : null,
      log,
    );
    chosen.assignments.forEach((assignment, index) => {
      if (!assignment) return;
      rows[index].category = assignment.category;
      rows[index].subtype = assignment.subtype;
      rows[index].category_source = assignment.source;
    });
    warnings.push(...chosen.warnings);
    if (chosen.categorised) parserId = `${parserId}+ai:${STATEMENT_CATEGORISE_PROMPT_ID}`;
  }

  return {
    batch: {
      source_kind: kind,
      parser_id: parserId,
      content_hash: numbered ? numbered.hash : statementHash(debits),
      currency: statementCurrency(parsed, debits),
      period_start: parsed.periodStart ?? null,
      period_end: parsed.periodEnd ?? null,
      skipped_credits: credits,
    },
    rows,
    warnings,
  };
}
