import { DomainError } from "@/lib/errors";
import type { Expense } from "@/lib/expenses/types";
import type {
  ConfirmImportRowPayload,
  CreateImportBatchPayload,
  CreateImportRowPayload,
  DraftRow,
  ImportBatch,
} from "@/lib/imports/types";

/**
 * Statement import storage (docs/statement-import-plan.md, task I5). The SQL error codes it maps are
 * the contract at the top of `20261029000100_create_statement_imports.sql`.
 */

/** A 404 for an import that is missing, someone else's, or an expired draft. */
export const IMPORT_NOT_FOUND_MESSAGE = "That import wasn't found or has expired.";

/** A 409 for confirming a batch that is no longer a draft. */
export const IMPORT_NOT_A_DRAFT_MESSAGE = "That import was already confirmed or undone.";

/** A 409 for undoing a batch that isn't confirmed. */
export const IMPORT_NOT_CONFIRMED_MESSAGE = "Only a confirmed import can be undone.";

/** A 409 for a statement the caller already has as a draft or a confirmed import. */
export const IMPORT_ALREADY_EXISTS_MESSAGE = "You already imported this statement.";

/** A 422 for rows the database refused (a failed check, a bad shape or a row that isn't in the import). */
export const IMPORT_ROWS_REFUSED_MESSAGE = "Some of those rows can't be imported.";

/** A 404 for an import that is missing or expired. */
export function importNotFoundError(): DomainError {
  return new DomainError(IMPORT_NOT_FOUND_MESSAGE, 404);
}

/** A draft row as stored: a `DraftRow` before the service works out `duplicateOf` and `importable`. */
export type StoredImportRow = Omit<DraftRow, "duplicateOf" | "importable">;

/** A live draft with its rows, in statement order. */
export type StoredImportDraft = { batch: ImportBatch; rows: StoredImportRow[] };

/**
 * An import in the list of recent imports. `expenseCount` is how many of the expenses it created
 * still exist (0 for a draft or an undone import) and `changedCount` how many of those were edited
 * since (`updated_at > created_at`), so undo can say "This removes 37 expenses, 2 of them changed
 * since you imported them".
 */
export type RecentImport = {
  batch: ImportBatch;
  expenseCount: number;
  changedCount: number;
};

/**
 * Statement imports. Get it from `getRepositories()`; never import an implementation. Methods take
 * no user id: they act as the signed-in caller (RLS), and another user's import counts as missing.
 * An expired draft (past `expiresAt`) counts as missing too, even while it is still stored, in every
 * method but `discard`, which may delete it.
 *
 * Failures are `DomainError`s: 404 for a missing import (`IMPORT_NOT_FOUND_MESSAGE`), 409 for a
 * batch in the wrong status or a statement already imported, 422 for rows the database refuses.
 */
export interface ImportRepository {
  /**
   * Saves a draft and its rows in one transaction (`create_import_batch`): the caller's expired
   * drafts are deleted first, rows the merchant classification recognises come back as car, and the
   * draft expires 24 hours later. Returns the batch. A 409 `DomainError` when the caller already
   * has a draft or confirmed import with this hash; a 422 one for a row the database refuses.
   */
  createBatch(batch: CreateImportBatchPayload, rows: readonly CreateImportRowPayload[]): Promise<ImportBatch>;
  /** The caller's draft (not expired) or confirmed import with this content hash, or null. */
  findLiveByHash(hash: string): Promise<ImportBatch | null>;
  /** The caller's draft with its rows, or null when there is none, or it was confirmed, undone or has expired. */
  getDraft(id: string): Promise<StoredImportDraft | null>;
  /** The caller's import in any status, or null when it is missing or an expired draft. */
  getBatch(id: string): Promise<ImportBatch | null>;
  /**
   * The caller's `limit` newest imports, newest first: live drafts, then confirmed and undone
   * imports, each with its counts. Expired drafts are left out.
   */
  listRecent(limit: number): Promise<RecentImport[]>;
  /**
   * Creates an expense for each row (`confirm_import_batch`), linked to the batch, and marks the batch
   * confirmed, all in one transaction. Returns the batch and the expenses as stored, in the order of
   * `rows`: the merchant classification may have changed a category. A 404 `DomainError` for a
   * missing, someone else's or expired draft, a 409 one when it isn't a draft any more, a 422 one for
   * a bad row; then nothing is saved.
   */
  confirm(id: string, rows: readonly ConfirmImportRowPayload[]): Promise<{ batch: ImportBatch; created: Expense[] }>;
  /**
   * Deletes the caller's expenses this confirmed import created, edited since or not, and marks it
   * undone (`undo_import_batch`). Returns the batch and how many expenses were deleted. A 404
   * `DomainError` when the import is missing, a 409 one when it isn't confirmed.
   */
  undo(id: string): Promise<{ batch: ImportBatch; removed: number }>;
  /** Deletes the caller's draft and its rows, returning false when there is no such draft. */
  discard(id: string): Promise<boolean>;
}
