import "server-only";

import type { Database, Json } from "@/lib/database.types";
import { DomainError } from "@/lib/errors";
import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";
import type { Expense } from "@/lib/expenses/types";
import {
  IMPORT_ALREADY_EXISTS_MESSAGE,
  IMPORT_NOT_A_DRAFT_MESSAGE,
  IMPORT_NOT_CONFIRMED_MESSAGE,
  IMPORT_ROWS_REFUSED_MESSAGE,
  importNotFoundError,
  type ImportRepository,
  type RecentImport,
  type StoredImportRow,
} from "@/lib/imports/repository";
import {
  IMPORT_SOURCE_KINDS,
  IMPORT_STATUSES,
  type ImportBatch,
  type ImportSourceKind,
  type ImportStatus,
} from "@/lib/imports/types";
import { translateDatabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const LOAD_ERROR = "Unable to load your imports.";
const SAVE_ERROR = "Unable to save the import.";
const CONFIRM_ERROR = "Unable to add the expenses.";
const UNDO_ERROR = "Unable to undo the import.";
const DISCARD_ERROR = "Unable to discard the import.";

// Never `user_id` or `content_hash`: the screen needs neither.
const BATCH_COLUMNS =
  "id, status, source_kind, parser_id, currency, period_start, period_end, row_count, skipped_credits, created_at, expires_at, confirmed_at, confirmed_count, undone_at";
const ROW_COLUMNS = "id, position, expense_date, description, amount, currency, category, subtype, rule_matched, notes";

/** How many link rows one request reads, under PostgREST's usual `max-rows` of 1,000. */
const LINK_PAGE_SIZE = 1000;

type BatchRow = Omit<Database["public"]["Tables"]["import_batches"]["Row"], "user_id" | "content_hash">;
type RowRow = Omit<Database["public"]["Tables"]["import_rows"]["Row"], "batch_id">;
type DatabaseError = { code?: string; message: string };

/** PostgREST answers instants as `+00:00` strings; the API speaks `Z` ISO strings. */
function toIso(value: string): string;
function toIso(value: string | null): string | null;
function toIso(value: string | null) {
  return value === null ? null : new Date(value).toISOString();
}

function toStatus(value: string): ImportStatus {
  if ((IMPORT_STATUSES as readonly string[]).includes(value)) return value as ImportStatus;
  throw new Error(LOAD_ERROR);
}

function toSourceKind(value: string): ImportSourceKind {
  if ((IMPORT_SOURCE_KINDS as readonly string[]).includes(value)) return value as ImportSourceKind;
  throw new Error(LOAD_ERROR);
}

function toBatch(row: BatchRow): ImportBatch {
  return {
    id: row.id,
    status: toStatus(row.status),
    sourceKind: toSourceKind(row.source_kind),
    parserId: row.parser_id,
    currency: row.currency,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    rowCount: row.row_count,
    skippedCredits: row.skipped_credits,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    confirmedAt: toIso(row.confirmed_at),
    confirmedCount: row.confirmed_count,
    undoneAt: toIso(row.undone_at),
  };
}

function toStoredRow(row: RowRow): StoredImportRow {
  return {
    id: row.id,
    position: row.position,
    expenseDate: row.expense_date,
    description: row.description,
    amount: Number(row.amount),
    currency: row.currency,
    // The table's check constraints limit both columns to the known keys.
    category: row.category as ExpenseCategory,
    subtype: row.subtype as ExpenseSubtype | null,
    ruleMatched: row.rule_matched,
    notes: row.notes,
  };
}

/** What `confirm_import_batch` returns for each new expense. */
type ConfirmedExpenseRow = Database["public"]["Functions"]["confirm_import_batch"]["Returns"][number];

function toExpense(row: ConfirmedExpenseRow): Expense {
  return {
    id: row.id,
    description: row.description,
    amount: Number(row.amount),
    category: row.category as ExpenseCategory,
    subtype: row.subtype as ExpenseSubtype | null,
    expenseDate: row.expense_date,
    notes: row.notes,
  };
}

/** An expired draft counts as missing everywhere; the select policy deliberately doesn't hide it. */
function isExpiredDraft(row: Pick<BatchRow, "status" | "expires_at">, now: number): boolean {
  return row.status === "draft" && (row.expires_at === null || new Date(row.expires_at).getTime() <= now);
}

/**
 * A failed call of an import function or write, by the SQL codes of the contract at the top of
 * `20261029000100_create_statement_imports.sql`:
 * - P0002 → a 404, the same message whichever of missing, someone else's or expired it was.
 * - 55000 → a 409 with `notAvailable`, which says what the operation needed.
 * - 23505 → a 409: the caller already has this statement as a draft or a confirmed import.
 * - 22023, 23514 → a 422 with a fixed message, because the database's own text may quote a value.
 * - Anything else as `translateDatabaseError` decides (42501 → 403, others → 500 with `fallback`).
 */
export function translateImportError(error: DatabaseError, fallback: string, notAvailable: string): Error {
  switch (error.code) {
    case "P0002":
      return importNotFoundError();
    case "55000":
      return new DomainError(notAvailable, 409);
    case "23505":
      return new DomainError(IMPORT_ALREADY_EXISTS_MESSAGE, 409);
    case "22023":
    case "23514":
      return new DomainError(IMPORT_ROWS_REFUSED_MESSAGE, 422);
    default:
      return translateDatabaseError(error, fallback);
  }
}

/** The batch with this id, as the caller's RLS shows it; null when there is none (an expired draft is still returned). */
async function selectBatch(id: string, fallback: string): Promise<BatchRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("import_batches").select(BATCH_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(fallback);
  return data;
}

/** The batch after a write that just succeeded; it can't be missing, so a miss is an error. */
async function reloadBatch(id: string, fallback: string): Promise<ImportBatch> {
  const row = await selectBatch(id, fallback);
  if (!row) throw new Error(fallback);
  return toBatch(row);
}

type LinkRow = { batch_id: string; expenses: { created_at: string; updated_at: string } };

/**
 * How many expenses each batch still has, and how many of them were edited since (`updated_at >
 * created_at`; the table's trigger only moves `updated_at` on an update). Reads the link rows with
 * their expenses' timestamps, page by page, advancing by the rows actually returned.
 */
async function expenseCounts(batchIds: readonly string[]): Promise<Map<string, { count: number; changed: number }>> {
  const counts = new Map<string, { count: number; changed: number }>();
  if (batchIds.length === 0) return counts;

  const supabase = await createClient();
  let offset = 0;
  while (true) {
    const { data, error, count } = await supabase
      .from("import_expenses")
      .select("batch_id, expenses!inner(created_at, updated_at)", { count: "exact" })
      .in("batch_id", [...batchIds])
      .order("expense_id")
      .range(offset, offset + LINK_PAGE_SIZE - 1);
    if (error) throw new Error(LOAD_ERROR);

    const page = (data ?? []) as unknown as LinkRow[];
    if (!page.length) {
      if (count !== null && offset < count) throw new Error(LOAD_ERROR);
      break;
    }
    for (const link of page) {
      const entry = counts.get(link.batch_id) ?? { count: 0, changed: 0 };
      entry.count += 1;
      if (link.expenses.updated_at > link.expenses.created_at) entry.changed += 1;
      counts.set(link.batch_id, entry);
    }
    offset += page.length;
    if (count !== null && offset >= count) break;
  }
  return counts;
}

/**
 * `ImportRepository` on `import_batches`, `import_rows` and `import_expenses` and their functions,
 * acting as the request's caller. RLS limits every row to the caller's own, with no family widening,
 * so queries don't filter by user themselves. An expired draft is still stored until the next upload
 * or the worker's purge, so every read drops it here.
 */
export const supabaseImportRepository: ImportRepository = {
  async createBatch(batch, rows) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_import_batch", {
      p_batch: batch as unknown as Json,
      p_rows: rows as unknown as Json,
    });
    if (error) throw translateImportError(error, SAVE_ERROR, IMPORT_NOT_A_DRAFT_MESSAGE);
    return reloadBatch(data, SAVE_ERROR);
  },

  async findLiveByHash(hash) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("import_batches")
      .select(BATCH_COLUMNS)
      .eq("content_hash", hash)
      .in("status", ["draft", "confirmed"])
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(LOAD_ERROR);
    return data && !isExpiredDraft(data, Date.now()) ? toBatch(data) : null;
  },

  async getDraft(id) {
    const supabase = await createClient();
    const [batch, rows] = await Promise.all([
      selectBatch(id, LOAD_ERROR),
      supabase.from("import_rows").select(ROW_COLUMNS).eq("batch_id", id).order("position"),
    ]);
    if (rows.error) throw new Error(LOAD_ERROR);
    if (!batch || batch.status !== "draft" || isExpiredDraft(batch, Date.now())) return null;
    return { batch: toBatch(batch), rows: rows.data.map(toStoredRow) };
  },

  async getBatch(id) {
    const batch = await selectBatch(id, LOAD_ERROR);
    return batch && !isExpiredDraft(batch, Date.now()) ? toBatch(batch) : null;
  },

  async listRecent(limit) {
    const supabase = await createClient();
    const now = Date.now();
    // Two queries rather than one `or`: a draft counts only while `expires_at` is ahead, and each
    // query is a plain indexed read of at most `limit` rows.
    const [drafts, settled] = await Promise.all([
      supabase.from("import_batches").select(BATCH_COLUMNS).eq("status", "draft")
        .gt("expires_at", new Date(now).toISOString()).order("created_at", { ascending: false }).limit(limit),
      supabase.from("import_batches").select(BATCH_COLUMNS).in("status", ["confirmed", "undone"])
        .order("created_at", { ascending: false }).limit(limit),
    ]);
    if (drafts.error || settled.error) throw new Error(LOAD_ERROR);

    const batches = [...drafts.data, ...settled.data]
      .filter((row) => !isExpiredDraft(row, now))
      .map(toBatch)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit);

    // An undone import has no expenses left, and a draft has none yet.
    const counts = await expenseCounts(batches.filter((batch) => batch.status === "confirmed").map((batch) => batch.id));
    return batches.map((batch): RecentImport => ({
      batch,
      expenseCount: counts.get(batch.id)?.count ?? 0,
      changedCount: counts.get(batch.id)?.changed ?? 0,
    }));
  },

  async confirm(id, rows) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("confirm_import_batch", {
      p_batch_id: id,
      p_rows: rows as unknown as Json,
    });
    if (error) throw translateImportError(error, CONFIRM_ERROR, IMPORT_NOT_A_DRAFT_MESSAGE);
    return { batch: await reloadBatch(id, CONFIRM_ERROR), created: data.map(toExpense) };
  },

  async undo(id) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("undo_import_batch", { p_batch_id: id });
    if (error) throw translateImportError(error, UNDO_ERROR, IMPORT_NOT_CONFIRMED_MESSAGE);
    return { batch: await reloadBatch(id, UNDO_ERROR), removed: data };
  },

  async discard(id) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("import_batches")
      .delete()
      .eq("id", id)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(DISCARD_ERROR);
    return data !== null;
  },
};
