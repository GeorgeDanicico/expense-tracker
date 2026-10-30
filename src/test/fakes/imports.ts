import { randomUUID } from "node:crypto";

import { DomainError } from "@/lib/errors";
import type { ExpenseSubtype } from "@/lib/expenses/categories";
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
  IMPORT_DRAFT_HOURS,
  IMPORT_MAX_ROWS,
  type ConfirmImportRowPayload,
  type CreateImportBatchPayload,
  type CreateImportRowPayload,
  type ImportBatch,
} from "@/lib/imports/types";

import type { FakeExpenseRepository } from "./expenses";

/** A batch as the fake stores it: an `ImportBatch` with its owner and the hash the unique index covers. */
export type FakeImportBatch = ImportBatch & { userId: string; contentHash: string };

/** A draft row as the fake stores it. */
export type FakeImportRow = StoredImportRow & { batchId: string };

/** Which expense an import created, with the expense as it was stored, to tell later edits. */
export type FakeImportLink = { expenseId: string; batchId: string; stored: Expense };

/** The test user of `@/test/route`, whom the fake acts as unless `callerId` changes. */
const TEST_USER_ID = "10000000-0000-4000-8000-000000000001";

/**
 * The few merchants the fake's stand-in for the database's merchant classification knows
 * (`expense_classification_private.classify_expense_merchant`): the bare brand, or the brand and a
 * number. It sets the subtype of a draft row on creation and of an expense on insert, as the SQL does.
 */
const MERCHANT_SUBTYPES: Record<string, ExpenseSubtype> = {
  omv: "car_fuel",
  petrom: "car_fuel",
  autonet: "car_maintenance",
};

/** The subtype the fake's merchant rules give a description, or null. */
export function fakeMerchantSubtype(description: string): ExpenseSubtype | null {
  const words = description.trim().toLowerCase().split(/\s+/);
  const rest = words.slice(1).join(" ");
  return rest === "" || /^\d+( satu mare)?$/.test(rest) ? (MERCHANT_SUBTYPES[words[0]] ?? null) : null;
}

const HOUR = 60 * 60_000;

/**
 * In-memory `ImportRepository` acting as `callerId`. Like RLS, every method sees only the caller's
 * batches (another user's counts as missing), and like the functions an expired draft counts as
 * missing. It works on the `FakeExpenseRepository` it is given: `confirm` adds the expenses there
 * (the merchant classification applies, as the trigger does) and `undo` removes them, so a test sees
 * the effect in `expenses.expenses`. An expense edited through the fake expenses counts as changed.
 *
 * Seed with `seed({ ... }, [rowOverrides])` (a draft expiring in 24 hours, owned by the caller, by
 * default) or push onto `batches`, `rows` and `links`. `now` is the clock; move it to expire drafts.
 */
export class FakeImportRepository implements ImportRepository {
  callerId = TEST_USER_ID;
  batches: FakeImportBatch[] = [];
  rows: FakeImportRow[] = [];
  links: FakeImportLink[] = [];
  now: () => Date = () => new Date();

  constructor(private readonly expenses: FakeExpenseRepository) {}

  /** Adds a batch (a draft of the caller's) with the given rows, and returns it as stored. */
  seed(overrides: Partial<FakeImportBatch> = {}, rows: Partial<FakeImportRow>[] = []): FakeImportBatch {
    const createdAt = overrides.createdAt ?? this.now().toISOString();
    const status = overrides.status ?? "draft";
    const batch: FakeImportBatch = {
      id: randomUUID(),
      userId: this.callerId,
      contentHash: randomUUID().replaceAll("-", "").repeat(2),
      status,
      sourceKind: "csv",
      parserId: "generic-csv",
      currency: "EUR",
      periodStart: null,
      periodEnd: null,
      rowCount: rows.length || 1,
      skippedCredits: 0,
      createdAt,
      expiresAt: status === "draft" ? new Date(new Date(createdAt).getTime() + IMPORT_DRAFT_HOURS * HOUR).toISOString() : null,
      confirmedAt: status === "draft" ? null : createdAt,
      confirmedCount: status === "draft" ? null : 0,
      undoneAt: status === "undone" ? createdAt : null,
      ...overrides,
    };
    this.batches.push(batch);
    rows.forEach((row, index) => {
      this.rows.push({
        id: randomUUID(),
        batchId: batch.id,
        position: index + 1,
        expenseDate: "2026-10-01",
        description: "Lidl",
        amount: 10,
        currency: "EUR",
        category: "other",
        subtype: null,
        ruleMatched: false,
        categorySource: null,
        notes: null,
        ...row,
      });
    });
    return batch;
  }

  /** The batch's draft rows, in statement order. */
  rowsOf(batchId: string): FakeImportRow[] {
    return this.rows.filter((row) => row.batchId === batchId).toSorted((a, b) => a.position - b.position);
  }

  async createBatch(batch: CreateImportBatchPayload, rows: readonly CreateImportRowPayload[]) {
    if (rows.length < 1 || rows.length > IMPORT_MAX_ROWS) throw refused();
    if (rows.some((row) => !(row.amount > 0) || row.description.trim() === "")) throw refused();

    // Like the function, the caller's expired drafts go first, in the same transaction.
    const expired = this.batches.filter((other) => other.userId === this.callerId && this.isExpiredDraft(other));
    const live = this.batches.find((other) =>
      other.userId === this.callerId
      && other.contentHash === batch.content_hash
      && (other.status === "confirmed" || (other.status === "draft" && !expired.includes(other))));
    if (live) throw new DomainError(IMPORT_ALREADY_EXISTS_MESSAGE, 409);
    for (const gone of expired) this.removeBatch(gone.id);

    const createdAt = this.now();
    const stored: FakeImportBatch = {
      id: randomUUID(),
      userId: this.callerId,
      contentHash: batch.content_hash,
      status: "draft",
      sourceKind: batch.source_kind,
      parserId: batch.parser_id,
      currency: batch.currency ?? null,
      periodStart: batch.period_start ?? null,
      periodEnd: batch.period_end ?? null,
      rowCount: rows.length,
      skippedCredits: batch.skipped_credits ?? 0,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + IMPORT_DRAFT_HOURS * HOUR).toISOString(),
      confirmedAt: null,
      confirmedCount: null,
      undoneAt: null,
    };
    this.batches.push(stored);
    rows.forEach((row, index) => {
      // Like the function: the merchant rule wins; otherwise the row keeps the category it was given.
      const ruleSubtype = fakeMerchantSubtype(row.description);
      const given = row.category !== undefined;
      this.rows.push({
        id: randomUUID(),
        batchId: stored.id,
        position: index + 1,
        expenseDate: row.expense_date,
        description: row.description,
        amount: row.amount,
        currency: row.currency,
        category: ruleSubtype ? "car" : (row.category ?? "other"),
        subtype: ruleSubtype ?? row.subtype ?? null,
        ruleMatched: ruleSubtype !== null,
        categorySource: ruleSubtype ? "rule" : given ? (row.category_source ?? null) : null,
        notes: row.notes ?? null,
      });
    });
    return publicBatch(stored);
  }

  async findLiveByHash(hash: string) {
    const found = this.own().find((batch) => batch.contentHash === hash && (batch.status === "confirmed" || batch.status === "draft"));
    return found && !this.isExpiredDraft(found) ? publicBatch(found) : null;
  }

  async getDraft(id: string) {
    const batch = this.own().find((other) => other.id === id);
    if (!batch || batch.status !== "draft" || this.isExpiredDraft(batch)) return null;
    return { batch: publicBatch(batch), rows: this.rowsOf(id).map(publicRow) };
  }

  async getBatch(id: string) {
    const batch = this.own().find((other) => other.id === id);
    return batch && !this.isExpiredDraft(batch) ? publicBatch(batch) : null;
  }

  async listRecent(limit: number) {
    return this.own()
      .filter((batch) => !this.isExpiredDraft(batch))
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((batch): RecentImport => {
        const live = this.links.filter((link) => link.batchId === batch.id && this.current(link) !== undefined);
        return {
          batch: publicBatch(batch),
          expenseCount: live.length,
          changedCount: live.filter((link) => JSON.stringify(this.current(link)) !== JSON.stringify(link.stored)).length,
        };
      });
  }

  async confirm(id: string, rows: readonly ConfirmImportRowPayload[]) {
    const batch = this.own().find((other) => other.id === id);
    if (!batch) throw importNotFoundError();
    if (batch.status !== "draft") throw new DomainError(IMPORT_NOT_A_DRAFT_MESSAGE, 409);
    if (this.isExpiredDraft(batch)) throw importNotFoundError();

    const draftIds = new Set(this.rowsOf(id).map((row) => row.id));
    const picked = new Set(rows.map((row) => row.id));
    if (rows.length < 1 || rows.length > IMPORT_MAX_ROWS || picked.size !== rows.length || rows.some((row) => !draftIds.has(row.id))) {
      throw refused();
    }

    // The insert applies the merchant classification, as the `expenses_classify_merchant` trigger does.
    const created: Expense[] = [];
    for (const row of rows) {
      const subtype = fakeMerchantSubtype(row.description);
      const expense = await this.expenses.create(this.callerId, {
        description: row.description,
        amount: row.amount,
        category: subtype ? "car" : row.category,
        subtype: subtype ?? row.subtype ?? null,
        expenseDate: row.expense_date,
        notes: row.notes ?? undefined,
      });
      this.links.push({ expenseId: expense.id, batchId: id, stored: expense });
      created.push(expense);
    }

    batch.status = "confirmed";
    batch.confirmedAt = this.now().toISOString();
    batch.confirmedCount = created.length;
    batch.expiresAt = null;
    this.rows = this.rows.filter((row) => row.batchId !== id);
    return { batch: publicBatch(batch), created };
  }

  async undo(id: string) {
    const batch = this.own().find((other) => other.id === id);
    if (!batch) throw importNotFoundError();
    if (batch.status !== "confirmed") throw new DomainError(IMPORT_NOT_CONFIRMED_MESSAGE, 409);

    let removed = 0;
    for (const link of this.links.filter((other) => other.batchId === id)) {
      if (await this.expenses.delete(this.callerId, link.expenseId)) removed += 1;
    }
    this.links = this.links.filter((link) => link.batchId !== id);
    batch.status = "undone";
    batch.undoneAt = this.now().toISOString();
    return { batch: publicBatch(batch), removed };
  }

  async discard(id: string) {
    // Like the delete policy, an expired draft can still be deleted by its owner.
    const batch = this.own().find((other) => other.id === id);
    if (!batch || batch.status !== "draft") return false;
    this.removeBatch(id);
    return true;
  }

  private own() {
    return this.batches.filter((batch) => batch.userId === this.callerId);
  }

  private isExpiredDraft(batch: FakeImportBatch) {
    return batch.status === "draft" && batch.expiresAt !== null && new Date(batch.expiresAt).getTime() <= this.now().getTime();
  }

  private removeBatch(id: string) {
    this.batches = this.batches.filter((batch) => batch.id !== id);
    this.rows = this.rows.filter((row) => row.batchId !== id);
    this.links = this.links.filter((link) => link.batchId !== id);
  }

  /** The linked expense as it is now, or undefined once it was deleted (the foreign key removes the link with it). */
  private current(link: FakeImportLink) {
    return this.expenses.expenses.get(this.callerId)?.find((expense) => expense.id === link.expenseId);
  }
}

function refused() {
  return new DomainError(IMPORT_ROWS_REFUSED_MESSAGE, 422);
}

/** The batch the API shows: without the owner and the hash. */
function publicBatch({ userId, contentHash, ...batch }: FakeImportBatch): ImportBatch {
  void userId;
  void contentHash;
  return { ...batch };
}

/** The row the repository returns: without the batch it belongs to. */
function publicRow({ batchId, ...row }: FakeImportRow): StoredImportRow {
  void batchId;
  return row;
}
