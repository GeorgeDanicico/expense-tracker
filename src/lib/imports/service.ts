import "server-only";

import { structured, type StructuredDependencies } from "@/lib/ai";
import { addDays, APPLICATION_TIMEZONE, getBucharestToday } from "@/lib/calendar";
import { DomainError } from "@/lib/errors";
import type { Expense } from "@/lib/expenses/types";
import { buildHistory, historySince } from "@/lib/imports/ai/categories";
import type { StatementAi } from "@/lib/imports/ai/reader";
import { flagDuplicates } from "@/lib/imports/duplicates";
import { buildDraft } from "@/lib/imports/pipeline";
import {
  IMPORT_NOT_A_DRAFT_MESSAGE,
  importNotFoundError,
  type RecentImport,
} from "@/lib/imports/repository";
import {
  ImportError,
  type ConfirmImportRowPayload,
  type DraftRow,
  type ImportBatch,
  type ImportDraft,
} from "@/lib/imports/types";
import type { StatementUpload } from "@/lib/imports/upload";
import { getRepositories } from "@/lib/repositories";
import { confirmImportSchema } from "@/lib/validation/import";

// Use cases shared by the import routes; each transport only reshapes the result
// (docs/statement-import-plan.md, task I5). Everything acts as the signed-in caller: the repository
// takes no user id and another user's import is missing.
//
// Errors: a refusal of the file itself (`already_imported`, and everything `buildDraft` throws) is
// an `ImportError`, whose `code` the screen needs and whose `status` is its HTTP status. A missing,
// expired or wrong-status import, and rows that can't be confirmed, are `DomainError`s (404, 409,
// 422), which `withUser` already maps. Nothing here maps an `ImportError` to a response: the route
// layer (I6) does that, since `withUser` only knows `HttpError` and `DomainError`.

/** Undo is offered while the import is among the caller's newest imports. */
export const UNDO_WINDOW = 20;

export const IMPORT_TOO_OLD_TO_UNDO_MESSAGE = "That import is too old to undo.";

/** What `createDraft` returns: the draft's batch, whether it was already there, and the pipeline's warnings. */
export type CreatedDraft = {
  batch: ImportBatch;
  /** The same statement was already a draft: it is returned as it was, and its 24 hours are unchanged. */
  reopened: boolean;
  /** Notes for the review screen (a description cut short, say). Not stored: a reopened draft has none. */
  warnings: string[];
};

/** "3 October", with the year when it isn't `now`'s: the day the confirmed import happened, in the app's time zone. */
function importDay(iso: string, now: Date): string {
  const parts = (instant: Date) =>
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: APPLICATION_TIMEZONE })
      .formatToParts(instant);
  const value = (list: Intl.DateTimeFormatPart[], type: string) => list.find((part) => part.type === type)?.value ?? "";
  const then = parts(new Date(iso));
  const day = `${value(then, "day")} ${value(then, "month")}`;
  return value(then, "year") === value(parts(now), "year") ? day : `${day} ${value(then, "year")}`;
}

/** What `createDraft` can be given in place of the real model: tests pass a fake provider and a price list. */
export type CreateDraftDependencies = {
  /** Passed to `structured` (`@/lib/ai`) for every model call of this upload. */
  ai?: StructuredDependencies;
  /** Where the pipeline's one-line notes about model steps go. */
  log?: (line: Record<string, unknown>) => void;
};

/**
 * The statement reader's side of the AI for this user: present only when they have turned AI on
 * (and, for a kid, have the permission), so everything else about an upload is as it was without
 * AI. The kill switch and the budgets are the gate's, checked by `structured` before each call.
 */
async function statementAi(userId: string, dependencies: StructuredDependencies | undefined): Promise<StatementAi | null> {
  const { aiGate, expenses } = getRepositories();
  let access: Awaited<ReturnType<typeof aiGate.access>>;
  try {
    access = await aiGate.access(userId);
  } catch {
    // Without knowing, the safe answer is the one without a model.
    return null;
  }
  if (access !== "ok") return null;

  return {
    call: (request) => structured({ ...request, feature: "statements", userId }, dependencies),
    // The history is the caller's own expenses, from the repository's explicit owner filter, and stays on the server.
    loadHistory: async () => buildHistory(await expenses.recentCategoriesByMerchant(userId, historySince(getBucharestToday()))),
  };
}

/**
 * Parses an upload into a draft and saves it. The same statement (by the hash of its rows) that is
 * still a draft is returned as it is (`reopened`); one that was confirmed is an `ImportError`
 * (`already_imported`, 409) naming the day, until that import is undone. `buildDraft`'s errors
 * (`unrecognised_layout`, `no_debits`, `too_many_rows`, ...) pass through.
 *
 * `userId` is the caller: it decides whether the model may read or categorise the statement (see
 * `statementAi`) and whose history is used. The import repository acts as the signed-in caller, so
 * it isn't needed to save.
 */
export async function createDraft(
  userId: string,
  upload: StatementUpload,
  now: Date = new Date(),
  dependencies: CreateDraftDependencies = {},
): Promise<CreatedDraft> {
  const draft = await buildDraft(upload, { ai: await statementAi(userId, dependencies.ai), log: dependencies.log });
  const { imports } = getRepositories();

  const existing = await imports.findLiveByHash(draft.batch.content_hash);
  if (existing?.status === "draft") return { batch: existing, reopened: true, warnings: [] };
  if (existing?.status === "confirmed") {
    const when = existing.confirmedAt ? ` on ${importDay(existing.confirmedAt, now)}` : "";
    throw new ImportError(
      "already_imported",
      `You imported this statement${when}. Undo that import to import it again.`,
    );
  }

  const batch = await imports.createBatch(draft.batch, draft.rows);
  return { batch, reopened: false, warnings: draft.warnings };
}

/**
 * The first and last dates of `rows` as a range for `listRange`: `endExclusive` is the day after the last.
 */
function dateRange(rows: readonly { expenseDate: string }[]) {
  const dates = rows.map((row) => row.expenseDate).toSorted();
  return { start: dates[0], endExclusive: addDays(dates[dates.length - 1], 1) };
}

/**
 * The draft with each row's `duplicateOf` (the caller's own expenses over the rows' dates, matched
 * one-to-one by `flagDuplicates`) and `importable` (the row is in the caller's currency). A row that
 * isn't importable is never flagged: it can't be added, so a look-alike expense says nothing. Flags
 * are worked out on every read, never stored. A 404 `DomainError` when the draft is missing, someone
 * else's or expired.
 */
export async function getDraft(userId: string, id: string): Promise<ImportDraft> {
  const { account, expenses, imports } = getRepositories();
  const [stored, currency] = await Promise.all([imports.getDraft(id), account.getCurrency(userId)]);
  if (!stored) throw importNotFoundError();

  const importable = stored.rows.filter((row) => row.currency === currency);
  // The explicit owner filter is the repository's: it reads only `userId`'s expenses.
  const existing: Expense[] = importable.length > 0 ? await expenses.listRange(userId, dateRange(importable)) : [];
  const duplicates = new Map(
    flagDuplicates(importable, existing).map((duplicate, index) => [importable[index].id, duplicate] as const),
  );

  const rows = stored.rows.map((row): DraftRow => ({
    ...row,
    duplicateOf: duplicates.get(row.id) ?? null,
    importable: row.currency === currency,
  }));
  return { batch: stored.batch, rows };
}

/**
 * The caller's import in any status (its summary), or a 404 `DomainError` when it is missing,
 * someone else's or an expired draft.
 */
export async function getImport(id: string): Promise<ImportBatch> {
  const batch = await getRepositories().imports.getBatch(id);
  if (!batch) throw importNotFoundError();
  return batch;
}

/** Why a draft can't be used: confirmed or undone is a 409, anything else (missing, expired) a 404. */
async function draftUnavailable(id: string): Promise<DomainError> {
  const batch = await getRepositories().imports.getBatch(id);
  return batch && batch.status !== "draft" ? new DomainError(IMPORT_NOT_A_DRAFT_MESSAGE, 409) : importNotFoundError();
}

/**
 * Confirms the ticked rows with their final values (`edits` is the request body, checked with
 * `confirmImportSchema`: the rules of a hand-typed expense). Every id must be a row of this draft
 * and every row must be in the caller's currency, or it is a 422 `DomainError` whose field errors
 * are keyed by path (`rows.0.description`) and nothing is saved. A possible duplicate doesn't
 * block: ticking it is the caller's call. Returns the batch and the expenses as stored, so a
 * category the merchant classification changed shows correctly. A 404 `DomainError` for a missing
 * or expired draft, a 409 one when it was confirmed or undone already.
 */
export async function confirmDraft(
  userId: string,
  id: string,
  edits: unknown,
): Promise<{ batch: ImportBatch; created: Expense[] }> {
  const parsed = confirmImportSchema.safeParse(edits);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (fieldErrors[issue.path.join(".") || "rows"] ??= []).push(issue.message);
    }
    throw new DomainError("Check the rows and try again.", 422, fieldErrors);
  }

  const { account, imports } = getRepositories();
  const [stored, currency] = await Promise.all([imports.getDraft(id), account.getCurrency(userId)]);
  if (!stored) throw await draftUnavailable(id);

  const draftRows = new Map(stored.rows.map((row) => [row.id, row] as const));
  const fieldErrors: Record<string, string[]> = {};
  parsed.data.rows.forEach((row, index) => {
    const draftRow = draftRows.get(row.id);
    if (!draftRow) fieldErrors[`rows.${index}.id`] = ["That row isn't part of this import."];
    else if (draftRow.currency !== currency) {
      fieldErrors[`rows.${index}.id`] = [`That row is in ${draftRow.currency}, not ${currency}, and can't be imported.`];
    }
  });
  if (Object.keys(fieldErrors).length > 0) {
    throw new DomainError("Some of those rows can't be imported.", 422, fieldErrors);
  }

  const rows = parsed.data.rows.map((row): ConfirmImportRowPayload => ({
    id: row.id,
    description: row.description,
    amount: row.amount,
    expense_date: row.expenseDate,
    category: row.category,
    subtype: row.subtype,
    notes: row.notes ?? null,
  }));
  return imports.confirm(id, rows);
}

/**
 * The caller's recent imports, newest first: live drafts and the last confirmed or undone imports
 * (`UNDO_WINDOW` in all), each with how many of its expenses still exist and how many of those
 * were edited since.
 */
export async function listImports(): Promise<RecentImport[]> {
  return getRepositories().imports.listRecent(UNDO_WINDOW);
}

/**
 * Undoes a confirmed import: deletes the expenses it created, including any edited since, and
 * returns the batch and how many were deleted. Only an import among the caller's newest
 * `UNDO_WINDOW` can be undone (a 409 `DomainError` otherwise); a 404 one when it is missing, and a
 * 409 one when it isn't confirmed.
 */
export async function undoImport(id: string): Promise<{ batch: ImportBatch; removed: number }> {
  const { imports } = getRepositories();
  const recent = await imports.listRecent(UNDO_WINDOW);
  if (!recent.some((item) => item.batch.id === id)) {
    if (!(await imports.getBatch(id))) throw importNotFoundError();
    throw new DomainError(IMPORT_TOO_OLD_TO_UNDO_MESSAGE, 409);
  }
  return imports.undo(id);
}

/** Discards a draft and its rows. A 404 `DomainError` when there is no such draft, a 409 one when it was confirmed or undone. */
export async function discardDraft(id: string): Promise<void> {
  if (!(await getRepositories().imports.discard(id))) throw await draftUnavailable(id);
}
