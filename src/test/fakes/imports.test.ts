import { beforeEach, describe, expect, it } from "vitest";

import {
  IMPORT_ALREADY_EXISTS_MESSAGE,
  IMPORT_NOT_A_DRAFT_MESSAGE,
  IMPORT_NOT_CONFIRMED_MESSAGE,
  IMPORT_NOT_FOUND_MESSAGE,
  IMPORT_ROWS_REFUSED_MESSAGE,
} from "@/lib/imports/repository";
import type { ConfirmImportRowPayload, CreateImportBatchPayload, CreateImportRowPayload } from "@/lib/imports/types";

import { FakeExpenseRepository } from "./expenses";
import { FakeImportRepository, fakeMerchantSubtype } from "./imports";

const owner = "10000000-0000-4000-8000-000000000001";
const stranger = "10000000-0000-4000-8000-000000000002";
const hash = "a".repeat(64);

const batchPayload = (overrides: Partial<CreateImportBatchPayload> = {}): CreateImportBatchPayload => ({
  source_kind: "csv",
  parser_id: "generic-csv",
  content_hash: hash,
  currency: "EUR",
  skipped_credits: 2,
  ...overrides,
});

const rowPayload = (overrides: Partial<CreateImportRowPayload> = {}): CreateImportRowPayload => ({
  expense_date: "2026-10-12",
  description: "Lidl",
  amount: 45.2,
  currency: "EUR",
  ...overrides,
});

let expenses: FakeExpenseRepository;
let imports: FakeImportRepository;
let now: Date;

beforeEach(() => {
  expenses = new FakeExpenseRepository();
  imports = new FakeImportRepository(expenses);
  now = new Date("2026-10-29T10:00:00.000Z");
  imports.now = () => now;
});

describe("fakeMerchantSubtype", () => {
  it.each([
    ["OMV", "car_fuel"],
    ["omv 1642 Satu Mare", "car_fuel"],
    ["Autonet", "car_maintenance"],
    ["Petrom", "car_fuel"],
    ["OMVillage", null],
    ["My OMV expense", null],
    ["Lidl", null],
  ])("classifies %j as %j", (description, subtype) => {
    expect(fakeMerchantSubtype(description)).toBe(subtype);
  });
});

describe("FakeImportRepository", () => {
  it("creates a draft that expires in 24 hours, with rows numbered from 1 and merchant suggestions", async () => {
    const batch = await imports.createBatch(batchPayload(), [rowPayload(), rowPayload({ description: "OMV 1642 Satu Mare", amount: 300 })]);

    expect(batch).toMatchObject({
      status: "draft",
      rowCount: 2,
      skippedCredits: 2,
      createdAt: "2026-10-29T10:00:00.000Z",
      expiresAt: "2026-10-30T10:00:00.000Z",
      confirmedAt: null,
    });
    expect(batch).not.toHaveProperty("contentHash");
    expect(batch).not.toHaveProperty("userId");

    const draft = await imports.getDraft(batch.id);
    expect(draft?.rows.map((row) => [row.position, row.category, row.subtype, row.ruleMatched])).toEqual([
      [1, "other", null, false],
      [2, "car", "car_fuel", true],
    ]);
    expect(draft?.rows[0]).not.toHaveProperty("batchId");
  });

  it("refuses a bad row, or none, and saves nothing", async () => {
    const refused = { status: 422, message: IMPORT_ROWS_REFUSED_MESSAGE };

    await expect(imports.createBatch(batchPayload(), [])).rejects.toMatchObject(refused);
    await expect(imports.createBatch(batchPayload(), [rowPayload({ amount: 0 })])).rejects.toMatchObject(refused);
    expect(imports.batches).toEqual([]);
  });

  it("refuses a statement the caller has as a live draft or a confirmed import, but not an undone or expired one", async () => {
    const first = await imports.createBatch(batchPayload(), [rowPayload()]);
    await expect(imports.createBatch(batchPayload(), [rowPayload()])).rejects.toMatchObject({ status: 409, message: IMPORT_ALREADY_EXISTS_MESSAGE });

    const draft = await imports.getDraft(first.id);
    await imports.confirm(first.id, [{ ...confirmRow(draft!.rows[0].id) }]);
    await expect(imports.createBatch(batchPayload(), [rowPayload()])).rejects.toMatchObject({ status: 409 });

    await imports.undo(first.id);
    const again = await imports.createBatch(batchPayload(), [rowPayload()]);
    expect(again.id).not.toBe(first.id);

    now = new Date("2026-10-31T10:00:00.000Z");
    expect((await imports.createBatch(batchPayload(), [rowPayload()])).status).toBe("draft");
  });

  it("deletes the caller's expired drafts, and only theirs, when creating", async () => {
    const mine = imports.seed({ createdAt: "2026-10-27T10:00:00.000Z" }, [{}]);
    imports.callerId = stranger;
    const theirs = imports.seed({ createdAt: "2026-10-27T10:00:00.000Z" }, [{}]);
    imports.callerId = owner;

    await imports.createBatch(batchPayload({ content_hash: "b".repeat(64) }), [rowPayload()]);

    expect(imports.batches.map((batch) => batch.id)).not.toContain(mine.id);
    expect(imports.batches.map((batch) => batch.id)).toContain(theirs.id);
    expect(imports.rows.some((row) => row.batchId === mine.id)).toBe(false);
  });

  it("finds a live batch by hash, but not an expired draft, an undone import or another user's", async () => {
    const draft = imports.seed({ contentHash: "1".repeat(64) }, [{}]);
    imports.seed({ contentHash: "2".repeat(64), createdAt: "2026-10-27T10:00:00.000Z" }, [{}]);
    imports.seed({ contentHash: "3".repeat(64), status: "undone" });
    imports.callerId = stranger;
    imports.seed({ contentHash: "4".repeat(64) }, [{}]);
    imports.callerId = owner;

    expect((await imports.findLiveByHash("1".repeat(64)))?.id).toBe(draft.id);
    expect(await imports.findLiveByHash("2".repeat(64))).toBeNull();
    expect(await imports.findLiveByHash("3".repeat(64))).toBeNull();
    expect(await imports.findLiveByHash("4".repeat(64))).toBeNull();
  });

  it("treats another user's batch, an expired draft and a settled batch as no draft", async () => {
    const expired = imports.seed({ createdAt: "2026-10-27T10:00:00.000Z" }, [{}]);
    const confirmed = imports.seed({ status: "confirmed" });
    imports.callerId = stranger;
    const foreign = imports.seed({}, [{}]);
    imports.callerId = owner;

    for (const batch of [expired, confirmed, foreign]) expect(await imports.getDraft(batch.id)).toBeNull();
    expect(await imports.getBatch(foreign.id)).toBeNull();
    expect(await imports.getBatch(expired.id)).toBeNull();
    expect((await imports.getBatch(confirmed.id))?.status).toBe("confirmed");
  });

  describe("confirm", () => {
    const seedDraft = () =>
      imports.seed({}, [
        { description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" },
        { description: "Fuel", amount: 300, expenseDate: "2026-10-13" },
        { description: "Left out", amount: 5, expenseDate: "2026-10-14" },
      ]);

    it("adds the chosen rows as the caller's expenses, linked to the batch, and drops the draft rows", async () => {
      const batch = seedDraft();
      const [lidl, fuel] = imports.rowsOf(batch.id);

      const result = await imports.confirm(batch.id, [confirmRow(lidl.id), confirmRow(fuel.id, { description: "OMV 1642 Satu Mare", amount: 300, category: "other" })]);

      expect(result.batch).toMatchObject({ status: "confirmed", confirmedCount: 2, expiresAt: null, confirmedAt: "2026-10-29T10:00:00.000Z" });
      // The merchant classification applies, as the trigger does for any insert.
      expect(result.created.map((expense) => [expense.description, expense.category, expense.subtype])).toEqual([
        ["Lidl", "groceries", null],
        ["OMV 1642 Satu Mare", "car", "car_fuel"],
      ]);
      expect(expenses.expenses.get(owner)).toEqual(result.created);
      expect(imports.links.map((link) => link.batchId)).toEqual([batch.id, batch.id]);
      expect(imports.rowsOf(batch.id)).toEqual([]);
    });

    it("refuses a missing, expired, someone else's or settled batch without saving", async () => {
      const expired = imports.seed({ createdAt: "2026-10-27T10:00:00.000Z" }, [{}]);
      const settled = imports.seed({ status: "confirmed" });
      imports.callerId = stranger;
      const foreign = imports.seed({}, [{}]);
      imports.callerId = owner;

      for (const id of [expired.id, foreign.id, "missing"]) {
        await expect(imports.confirm(id, [confirmRow("x")])).rejects.toMatchObject({ status: 404, message: IMPORT_NOT_FOUND_MESSAGE });
      }
      await expect(imports.confirm(settled.id, [confirmRow("x")])).rejects.toMatchObject({ status: 409, message: IMPORT_NOT_A_DRAFT_MESSAGE });
      expect(expenses.expenses.get(owner) ?? []).toEqual([]);
    });

    it("refuses no rows, a repeated row and a row of another batch, and the batch stays a draft", async () => {
      const batch = seedDraft();
      const other = seedDraft();
      const [first] = imports.rowsOf(batch.id);

      await expect(imports.confirm(batch.id, [])).rejects.toMatchObject({ status: 422 });
      await expect(imports.confirm(batch.id, [confirmRow(first.id), confirmRow(first.id)])).rejects.toMatchObject({ status: 422 });
      await expect(imports.confirm(batch.id, [confirmRow(first.id), confirmRow(imports.rowsOf(other.id)[0].id)])).rejects.toMatchObject({ status: 422 });

      expect(expenses.expenses.get(owner) ?? []).toEqual([]);
      expect((await imports.getDraft(batch.id))?.rows).toHaveLength(3);
    });

    it("refuses a second confirmation", async () => {
      const batch = seedDraft();
      const [first] = imports.rowsOf(batch.id);
      await imports.confirm(batch.id, [confirmRow(first.id)]);

      await expect(imports.confirm(batch.id, [confirmRow(first.id)])).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("undo", () => {
    it("deletes the expenses the import created, edited or not, and leaves the others", async () => {
      const mine = await expenses.create(owner, { description: "By hand", amount: 1, category: "other", subtype: null, expenseDate: "2026-10-01" });
      const theirs = await expenses.create(stranger, { description: "Theirs", amount: 1, category: "other", subtype: null, expenseDate: "2026-10-01" });
      const batch = imports.seed({}, [{}, { description: "Fuel" }]);
      const [a, b] = imports.rowsOf(batch.id);
      const { created } = await imports.confirm(batch.id, [confirmRow(a.id), confirmRow(b.id)]);
      await expenses.update(owner, created[0].id, { amount: 99 });

      const result = await imports.undo(batch.id);

      expect(result).toMatchObject({ removed: 2, batch: { status: "undone", undoneAt: "2026-10-29T10:00:00.000Z" } });
      expect(expenses.expenses.get(owner)).toEqual([mine]);
      expect(expenses.expenses.get(stranger)).toEqual([theirs]);
      expect(imports.links).toEqual([]);
    });

    it("doesn't count an expense the caller deleted by hand", async () => {
      const batch = imports.seed({}, [{}, { description: "Fuel" }]);
      const [a, b] = imports.rowsOf(batch.id);
      const { created } = await imports.confirm(batch.id, [confirmRow(a.id), confirmRow(b.id)]);
      await expenses.delete(owner, created[0].id);

      expect((await imports.undo(batch.id)).removed).toBe(1);
    });

    it("refuses a draft, an undone import, a second undo and a missing or someone else's batch", async () => {
      const draft = imports.seed({}, [{}]);
      const confirmed = imports.seed({}, [{}]);
      await imports.confirm(confirmed.id, [confirmRow(imports.rowsOf(confirmed.id)[0].id)]);
      await imports.undo(confirmed.id);
      imports.callerId = stranger;
      const foreign = imports.seed({ status: "confirmed" });
      imports.callerId = owner;

      for (const id of [draft.id, confirmed.id]) {
        await expect(imports.undo(id)).rejects.toMatchObject({ status: 409, message: IMPORT_NOT_CONFIRMED_MESSAGE });
      }
      for (const id of [foreign.id, "missing"]) await expect(imports.undo(id)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("discard", () => {
    it("deletes the caller's draft and its rows, even an expired one", async () => {
      const draft = imports.seed({}, [{}]);
      const expired = imports.seed({ createdAt: "2026-10-27T10:00:00.000Z" }, [{}]);

      expect(await imports.discard(draft.id)).toBe(true);
      expect(await imports.discard(expired.id)).toBe(true);

      expect(imports.batches).toEqual([]);
      expect(imports.rows).toEqual([]);
    });

    it("returns false for a settled batch, someone else's draft or a missing one", async () => {
      const confirmed = imports.seed({ status: "confirmed" });
      imports.callerId = stranger;
      const foreign = imports.seed({}, [{}]);
      imports.callerId = owner;

      for (const id of [confirmed.id, foreign.id, "missing"]) expect(await imports.discard(id)).toBe(false);
      expect(imports.batches).toHaveLength(2);
    });
  });

  describe("listRecent", () => {
    it("lists the caller's newest imports first, without expired drafts or other users' imports, up to the limit", async () => {
      const old = imports.seed({ status: "undone", createdAt: "2026-10-01T10:00:00.000Z" });
      const confirmed = imports.seed({ status: "confirmed", createdAt: "2026-10-10T10:00:00.000Z" });
      const draft = imports.seed({ createdAt: "2026-10-29T09:00:00.000Z" }, [{}]);
      imports.seed({ createdAt: "2026-10-20T10:00:00.000Z" }, [{}]);
      imports.callerId = stranger;
      imports.seed({});
      imports.callerId = owner;

      expect((await imports.listRecent(10)).map((item) => item.batch.id)).toEqual([draft.id, confirmed.id, old.id]);
      expect((await imports.listRecent(2)).map((item) => item.batch.id)).toEqual([draft.id, confirmed.id]);
    });

    it("counts the expenses that still exist and those edited since", async () => {
      const batch = imports.seed({}, [{}, { description: "Fuel" }, { description: "Shop" }]);
      const rows = imports.rowsOf(batch.id);
      const { created } = await imports.confirm(batch.id, rows.map((row) => confirmRow(row.id)));
      await expenses.update(owner, created[0].id, { amount: 99 });
      await expenses.delete(owner, created[1].id);

      expect(await imports.listRecent(5)).toEqual([
        { batch: expect.objectContaining({ id: batch.id }), expenseCount: 2, changedCount: 1 },
      ]);
    });

    it("counts nothing for a draft or an undone import", async () => {
      const draft = imports.seed({ createdAt: "2026-10-29T09:00:00.000Z" }, [{}]);
      const undone = imports.seed({ status: "undone", createdAt: "2026-10-01T10:00:00.000Z" });

      expect(await imports.listRecent(5)).toEqual([
        { batch: expect.objectContaining({ id: draft.id }), expenseCount: 0, changedCount: 0 },
        { batch: expect.objectContaining({ id: undone.id }), expenseCount: 0, changedCount: 0 },
      ]);
    });
  });
});

/** A row's final values as the confirm function takes them: the draft's, unless overridden. */
function confirmRow(id: string, overrides: Partial<ConfirmImportRowPayload> = {}): ConfirmImportRowPayload {
  return {
    id,
    description: "Lidl",
    amount: 45.2,
    expense_date: "2026-10-12",
    category: "groceries",
    subtype: null,
    notes: null,
    ...overrides,
  };
}
