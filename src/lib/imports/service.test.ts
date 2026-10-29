import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { IMPORT_NOT_A_DRAFT_MESSAGE, IMPORT_NOT_FOUND_MESSAGE } from "@/lib/imports/repository";
import { ImportError } from "@/lib/imports/types";
import { anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import {
  IMPORT_TOO_OLD_TO_UNDO_MESSAGE,
  UNDO_WINDOW,
  confirmDraft,
  createDraft,
  discardDraft,
  getDraft,
  getImport,
  listImports,
  undoImport,
} from "@/lib/imports/service";

const userId = "10000000-0000-4000-8000-000000000001";
const otherUserId = "10000000-0000-4000-8000-000000000002";
const now = new Date("2026-10-29T10:00:00.000Z");

const upload = (...lines: string[]) => ({
  kind: "csv" as const,
  bytes: new TextEncoder().encode(`Date,Description,Amount,Currency\n${lines.join("\n")}\n`),
});

/** Three payments in euros, one in lei, and a salary that is skipped. */
const statement = () =>
  upload(
    "2026-10-12,Lidl,-45.20,EUR",
    "2026-10-13,OMV 1642 Satu Mare,-300.00,EUR",
    "2026-10-14,Foreign shop,-15.00,RON",
    "2026-10-15,Salary,2500.00,EUR",
  );

let repositories: FakeRepositories;

/** The draft's rows by description, as the review screen would receive them. */
async function draftRows(batchId: string) {
  const draft = await getDraft(userId, batchId);
  return Object.fromEntries(draft.rows.map((row) => [row.description, row]));
}

/** The body the confirm route receives for these rows, each as the draft suggests unless overridden. */
function ticked(rows: { id: string; description: string; amount: number; expenseDate: string; category?: string; notes?: string | null }[]) {
  return { rows: rows.map((row) => ({ category: "other", subtype: null, notes: null, ...row })) };
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  repositories = resetFakeRepositories();
  repositories.imports.now = () => now;
});

describe("createDraft", () => {
  it("saves a new draft with the statement's debits and counts what it skipped", async () => {
    const { batch, reopened, warnings } = await createDraft(userId, statement(), now);

    expect(reopened).toBe(false);
    expect(warnings).toEqual([]);
    expect(batch).toMatchObject({
      status: "draft",
      sourceKind: "csv",
      parserId: "generic-csv",
      rowCount: 3,
      skippedCredits: 1,
      expiresAt: "2026-10-30T10:00:00.000Z",
    });
    expect(repositories.imports.rows.map((row) => [row.position, row.description])).toEqual([
      [1, "Lidl"], [2, "OMV 1642 Satu Mare"], [3, "Foreign shop"],
    ]);
  });

  it("passes the pipeline's warnings on", async () => {
    const { warnings } = await createDraft(userId, upload(`2026-10-13,${"y".repeat(700)},-45.20,EUR`), now);

    expect(warnings).toEqual(["1 description was too long to keep whole; the end was cut."]);
  });

  it("returns the same draft when the same statement is uploaded again, with its expiry unchanged", async () => {
    const first = await createDraft(userId, statement(), now);

    const later = new Date("2026-10-29T18:00:00.000Z");
    repositories.imports.now = () => later;
    const second = await createDraft(userId, statement(), later);

    expect(second).toEqual({ batch: first.batch, reopened: true, warnings: [] });
    expect(repositories.imports.batches).toHaveLength(1);
  });

  it("recognises a re-download of the same statement: other order, other spacing", async () => {
    const first = await createDraft(userId, upload("2026-10-12,Lidl,-45.20,EUR", "2026-10-13,Kaufland,-10.00,EUR"), now);

    const second = await createDraft(userId, upload("2026-10-13,KAUFLAND,-10.00,EUR", "2026-10-12,Lidl ,-45.20,EUR"), now);

    expect(second.reopened).toBe(true);
    expect(second.batch.id).toBe(first.batch.id);
  });

  it("refuses a statement that was confirmed, naming the day, until the import is undone", async () => {
    const { batch } = await createDraft(userId, statement(), now);
    const rows = await draftRows(batch.id);
    await confirmDraft(userId, batch.id, ticked([{ id: rows.Lidl.id, description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" }]));

    const error = await refusal(createDraft(userId, statement(), now));

    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({
      code: "already_imported",
      status: 409,
      message: "You imported this statement on 29 October. Undo that import to import it again.",
    });

    await undoImport(batch.id);
    const again = await createDraft(userId, statement(), now);
    expect(again.reopened).toBe(false);
    expect(again.batch.id).not.toBe(batch.id);
  });

  it("names the year when the import was in another one", async () => {
    const { batch } = await createDraft(userId, statement(), now);
    const rows = await draftRows(batch.id);
    await confirmDraft(userId, batch.id, ticked([{ id: rows.Lidl.id, description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" }]));

    const error = await refusal(createDraft(userId, statement(), new Date("2027-01-05T10:00:00.000Z")));

    expect((error as ImportError).message).toBe("You imported this statement on 29 October 2026. Undo that import to import it again.");
  });

  it("reads a late evening import on its Bucharest day", async () => {
    repositories.imports.now = () => new Date("2026-10-29T22:30:00.000Z");
    const { batch } = await createDraft(userId, statement(), now);
    const rows = await draftRows(batch.id);
    await confirmDraft(userId, batch.id, ticked([{ id: rows.Lidl.id, description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" }]));

    const error = await refusal(createDraft(userId, statement(), now));

    expect((error as ImportError).message).toContain("on 30 October.");
  });

  it("starts a new draft when the earlier one expired", async () => {
    const first = await createDraft(userId, statement(), now);
    repositories.imports.now = () => new Date("2026-10-31T10:00:00.000Z");

    const second = await createDraft(userId, statement(), now);

    expect(second.reopened).toBe(false);
    expect(second.batch.id).not.toBe(first.batch.id);
    expect(repositories.imports.batches.map((batch) => batch.id)).toEqual([second.batch.id]);
  });

  it("lets two users import the same statement", async () => {
    await createDraft(userId, statement(), now);
    repositories.imports.callerId = otherUserId;

    const theirs = await createDraft(otherUserId, statement(), now);

    expect(theirs.reopened).toBe(false);
  });

  it.each([
    ["a statement no parser reads", new TextEncoder().encode("Name,Colour\nRex,brown\n"), "unrecognised_layout"],
    ["a statement with no payments", upload("2026-10-15,Salary,2500.00,EUR").bytes, "no_debits"],
  ])("passes through the pipeline's refusal for %s, saving nothing", async (_name, bytes, code) => {
    const error = await refusal(createDraft(userId, { kind: "csv", bytes }, now));

    expect(error).toMatchObject({ code });
    expect(repositories.imports.batches).toEqual([]);
  });
});

describe("getDraft", () => {
  it("returns the rows with their suggestions and whether each can be imported", async () => {
    const { batch } = await createDraft(userId, statement(), now);

    const draft = await getDraft(userId, batch.id);

    expect(draft.batch).toEqual(batch);
    expect(draft.rows.map((row) => [row.description, row.category, row.subtype, row.ruleMatched, row.importable, row.duplicateOf])).toEqual([
      ["Lidl", "other", null, false, true, null],
      ["OMV 1642 Satu Mare", "car", "car_fuel", true, true, null],
      ["Foreign shop", "other", null, false, false, null],
    ]);
  });

  it("compares each row's currency with the user's", async () => {
    repositories.account.currencies.set(userId, "RON");
    const { batch } = await createDraft(userId, statement(), now);

    const draft = await getDraft(userId, batch.id);

    expect(draft.rows.map((row) => [row.description, row.importable])).toEqual([
      ["Lidl", false], ["OMV 1642 Satu Mare", false], ["Foreign shop", true],
    ]);
  });

  it("flags a row that looks like one of the user's own expenses, quoting it", async () => {
    repositories.expenses.expenses.set(userId, [
      anExpense({ id: "saved-lidl", description: "LIDL Satu Mare", amount: 45.2, expenseDate: "2026-10-12" }),
      anExpense({ id: "other-day", description: "OMV", amount: 300, expenseDate: "2026-10-14" }),
    ]);
    const { batch } = await createDraft(userId, statement(), now);

    const rows = await draftRows(batch.id);

    expect(rows.Lidl.duplicateOf).toEqual({ id: "saved-lidl", description: "LIDL Satu Mare", expenseDate: "2026-10-12", amount: 45.2 });
    expect(rows["OMV 1642 Satu Mare"].duplicateOf).toBeNull();
  });

  it("matches the merchant the notes envelope names when the description is neutral", async () => {
    repositories.expenses.expenses.set(userId, [
      anExpense({
        id: "fuel", description: "Card payment", amount: 300, expenseDate: "2026-10-13",
        notes: "BT Star Forte statement 2026-10; processed: 2026-10-14; transaction: 2026-10-13 18:02; source: OMV 1642 Satu Mare",
      }),
    ]);
    const { batch } = await createDraft(userId, statement(), now);

    const rows = await draftRows(batch.id);

    expect(rows["OMV 1642 Satu Mare"].duplicateOf?.id).toBe("fuel");
  });

  it("doesn't flag against another user's expenses", async () => {
    repositories.expenses.expenses.set(otherUserId, [anExpense({ description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" })]);
    const { batch } = await createDraft(userId, statement(), now);

    const rows = await draftRows(batch.id);

    expect(rows.Lidl.duplicateOf).toBeNull();
  });

  it("doesn't flag a row that can't be imported", async () => {
    repositories.expenses.expenses.set(userId, [anExpense({ description: "Foreign shop", amount: 15, expenseDate: "2026-10-14" })]);
    const { batch } = await createDraft(userId, statement(), now);

    const rows = await draftRows(batch.id);

    expect(rows["Foreign shop"]).toMatchObject({ importable: false, duplicateOf: null });
  });

  it("reads the user's expenses only over the rows' dates, to the end of the last day", async () => {
    const listRange = vi.spyOn(repositories.expenses, "listRange");
    const { batch } = await createDraft(userId, statement(), now);

    await getDraft(userId, batch.id);

    // The rows in the user's currency run from 12 to 13 October.
    expect(listRange).toHaveBeenCalledExactlyOnceWith(userId, { start: "2026-10-12", endExclusive: "2026-10-14" });
  });

  it("reads no expenses when no row can be imported", async () => {
    repositories.account.currencies.set(userId, "GBP");
    const listRange = vi.spyOn(repositories.expenses, "listRange");
    const { batch } = await createDraft(userId, statement(), now);

    const draft = await getDraft(userId, batch.id);

    expect(listRange).not.toHaveBeenCalled();
    expect(draft.rows.every((row) => !row.importable && row.duplicateOf === null)).toBe(true);
  });

  it("flags one of two identical rows against one saved expense", async () => {
    repositories.expenses.expenses.set(userId, [anExpense({ id: "saved", description: "Coffee", amount: 4.5, expenseDate: "2026-10-12" })]);
    const { batch } = await createDraft(userId, upload("2026-10-12,Coffee,-4.50,EUR", "2026-10-12,Coffee,-4.50,EUR"), now);

    const draft = await getDraft(userId, batch.id);

    expect(draft.rows.map((row) => row.duplicateOf?.id ?? null)).toEqual(["saved", null]);
  });

  it("is a 404 for an expired draft, another user's draft and an unknown id", async () => {
    const { batch } = await createDraft(userId, statement(), now);

    repositories.imports.now = () => new Date("2026-10-30T10:00:00.000Z");
    await expect(getDraft(userId, batch.id)).rejects.toMatchObject({ status: 404, message: IMPORT_NOT_FOUND_MESSAGE });

    repositories.imports.now = () => now;
    repositories.imports.callerId = otherUserId;
    await expect(getDraft(otherUserId, batch.id)).rejects.toMatchObject({ status: 404 });
    await expect(getDraft(otherUserId, "missing")).rejects.toMatchObject({ status: 404 });
  });
});

describe("confirmDraft", () => {
  it("creates the ticked rows as the user's expenses, linked to the import, and returns them as stored", async () => {
    const { batch } = await createDraft(userId, statement(), now);
    const rows = await draftRows(batch.id);

    const result = await confirmDraft(userId, batch.id, ticked([
      { id: rows.Lidl.id, description: "Lidl", amount: 45.2, expenseDate: "2026-10-12", category: "groceries" },
    ]));

    expect(result.batch).toMatchObject({ id: batch.id, status: "confirmed", confirmedCount: 1, expiresAt: null });
    expect(result.created).toEqual([
      { id: expect.any(String), description: "Lidl", amount: 45.2, category: "groceries", subtype: null, expenseDate: "2026-10-12", notes: null },
    ]);
    expect(repositories.expenses.expenses.get(userId)).toEqual(result.created);
    expect(repositories.imports.links.map((link) => [link.expenseId, link.batchId])).toEqual([[result.created[0].id, batch.id]]);
    expect(repositories.expenses.expenses.get(otherUserId)).toBeUndefined();
  });

  it("saves the edited values, not the drafted ones", async () => {
    const { batch } = await createDraft(userId, statement(), now);
    const rows = await draftRows(batch.id);

    const { created } = await confirmDraft(userId, batch.id, ticked([
      { id: rows.Lidl.id, description: "Weekly shop", amount: 50, expenseDate: "2026-10-11", category: "groceries", notes: "with Ana" },
    ]));

    expect(created[0]).toMatchObject({ description: "Weekly shop", amount: 50, expenseDate: "2026-10-11", notes: "with Ana" });
  });

  it("returns a car merchant sent as Other as car, as the merchant trigger makes it", async () => {
    const { batch } = await createDraft(userId, statement(), now);
    const rows = await draftRows(batch.id);

    const { created } = await confirmDraft(userId, batch.id, ticked([
      { id: rows["OMV 1642 Satu Mare"].id, description: "OMV 1642 Satu Mare", amount: 300, expenseDate: "2026-10-13", category: "other" },
    ]));

    expect(created[0]).toMatchObject({ category: "car", subtype: "car_fuel" });
  });

  it("doesn't block a possible duplicate: ticking it is the user's call", async () => {
    repositories.expenses.expenses.set(userId, [anExpense({ id: "saved", description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" })]);
    const { batch } = await createDraft(userId, statement(), now);
    const rows = await draftRows(batch.id);
    expect(rows.Lidl.duplicateOf).not.toBeNull();

    const { created } = await confirmDraft(userId, batch.id, ticked([
      { id: rows.Lidl.id, description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" },
    ]));

    expect(created).toHaveLength(1);
    expect(repositories.expenses.expenses.get(userId)).toHaveLength(2);
  });

  it("refuses a row in another currency, saving nothing", async () => {
    const { batch } = await createDraft(userId, statement(), now);
    const rows = await draftRows(batch.id);

    const error = await refusal(confirmDraft(userId, batch.id, ticked([
      { id: rows.Lidl.id, description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" },
      { id: rows["Foreign shop"].id, description: "Foreign shop", amount: 15, expenseDate: "2026-10-14" },
    ])));

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      status: 422,
      fieldErrors: { "rows.1.id": ["That row is in RON, not EUR, and can't be imported."] },
    });
    expect(repositories.expenses.expenses.get(userId) ?? []).toEqual([]);
    expect((await getDraft(userId, batch.id)).batch.status).toBe("draft");
  });

  it("refuses a row id that isn't part of this import", async () => {
    const { batch } = await createDraft(userId, statement(), now);

    const error = await refusal(confirmDraft(userId, batch.id, ticked([
      { id: "70000000-0000-4000-8000-000000000001", description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" },
    ])));

    expect(error).toMatchObject({ status: 422, fieldErrors: { "rows.0.id": ["That row isn't part of this import."] } });
  });

  it("refuses a row of another import of the same user", async () => {
    const first = await createDraft(userId, statement(), now);
    const second = await createDraft(userId, upload("2026-10-20,Kaufland,-10.00,EUR"), now);
    const [kaufland] = (await getDraft(userId, second.batch.id)).rows;

    await expect(confirmDraft(userId, first.batch.id, ticked([
      { id: kaufland.id, description: "Kaufland", amount: 10, expenseDate: "2026-10-20" },
    ]))).rejects.toMatchObject({ status: 422 });
  });

  it("validates every row like a hand-typed expense, with field errors by row and field", async () => {
    const { batch } = await createDraft(userId, statement(), now);
    const rows = await draftRows(batch.id);

    const error = await refusal(confirmDraft(userId, batch.id, ticked([
      { id: rows.Lidl.id, description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" },
      { id: rows["OMV 1642 Satu Mare"].id, description: "   ", amount: 0, expenseDate: "2026-10-13" },
    ]))) as DomainError;

    expect(error).toBeInstanceOf(DomainError);
    expect(error.status).toBe(422);
    expect(Object.keys(error.fieldErrors ?? {}).toSorted()).toEqual(["rows.1.amount", "rows.1.description"]);
    expect(repositories.expenses.expenses.get(userId) ?? []).toEqual([]);
  });

  it.each([
    ["no rows", { rows: [] }, "rows"],
    ["a body that isn't an object", "nope", "rows"],
    ["a repeated row", null, "rows.1.id"],
  ])("refuses %s", async (_name, body, field) => {
    const { batch } = await createDraft(userId, statement(), now);
    const rows = await draftRows(batch.id);
    const row = { id: rows.Lidl.id, description: "Lidl", amount: 45.2, expenseDate: "2026-10-12", category: "other" };
    const edits = body ?? { rows: [row, row] };

    const error = await refusal(confirmDraft(userId, batch.id, edits)) as DomainError;

    expect(error.status).toBe(422);
    expect(Object.keys(error.fieldErrors ?? {})).toContain(field);
  });

  it("is a 404 for an expired draft and another user's draft, and a 409 once confirmed or undone", async () => {
    const { batch } = await createDraft(userId, statement(), now);
    const rows = await draftRows(batch.id);
    const body = ticked([{ id: rows.Lidl.id, description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" }]);

    repositories.imports.callerId = otherUserId;
    await expect(confirmDraft(otherUserId, batch.id, body)).rejects.toMatchObject({ status: 404 });
    repositories.imports.callerId = userId;

    await confirmDraft(userId, batch.id, body);
    await expect(confirmDraft(userId, batch.id, body)).rejects.toMatchObject({ status: 409, message: IMPORT_NOT_A_DRAFT_MESSAGE });
    await undoImport(batch.id);
    await expect(confirmDraft(userId, batch.id, body)).rejects.toMatchObject({ status: 409 });

    const second = await createDraft(userId, upload("2026-10-20,Kaufland,-10.00,EUR"), now);
    const [kaufland] = (await getDraft(userId, second.batch.id)).rows;
    repositories.imports.now = () => new Date("2026-10-31T10:00:00.000Z");
    await expect(confirmDraft(userId, second.batch.id, ticked([
      { id: kaufland.id, description: "Kaufland", amount: 10, expenseDate: "2026-10-20" },
    ]))).rejects.toMatchObject({ status: 404, message: IMPORT_NOT_FOUND_MESSAGE });
  });
});

describe("undoImport", () => {
  async function confirmedImport(lines: string[] = ["2026-10-12,Lidl,-45.20,EUR", "2026-10-13,Kaufland,-10.00,EUR"]) {
    const { batch } = await createDraft(userId, upload(...lines), now);
    const { rows } = await getDraft(userId, batch.id);
    const { created } = await confirmDraft(userId, batch.id, {
      rows: rows.map((row) => ({ id: row.id, description: row.description, amount: row.amount, expenseDate: row.expenseDate, category: "other" })),
    });
    return { batch, created };
  }

  it("removes the expenses the import created, including ones edited since, and nothing else", async () => {
    const byHand = anExpense({ id: "by-hand", description: "Coffee" });
    repositories.expenses.expenses.set(userId, [byHand]);
    const { batch, created } = await confirmedImport();
    await repositories.expenses.update(userId, created[0].id, { amount: 99 });

    const result = await undoImport(batch.id);

    expect(result).toMatchObject({ removed: 2, batch: { id: batch.id, status: "undone" } });
    expect(repositories.expenses.expenses.get(userId)).toEqual([byHand]);
  });

  it("is a 409 for a draft and for an import that was already undone", async () => {
    const draft = await createDraft(userId, statement(), now);
    const { batch } = await confirmedImport(["2026-10-20,Kaufland,-10.00,EUR"]);
    await undoImport(batch.id);

    await expect(undoImport(draft.batch.id)).rejects.toMatchObject({ status: 409 });
    await expect(undoImport(batch.id)).rejects.toMatchObject({ status: 409 });
  });

  it("is a 404 for an unknown import and another user's", async () => {
    const { batch } = await confirmedImport();
    repositories.imports.callerId = otherUserId;

    await expect(undoImport(batch.id)).rejects.toMatchObject({ status: 404 });
    await expect(undoImport("missing")).rejects.toMatchObject({ status: 404 });
  });

  it(`is available while the import is among the last ${UNDO_WINDOW}, and a 409 once it isn't`, async () => {
    const { batch } = await confirmedImport();
    // The oldest import of the user and `UNDO_WINDOW - 1` newer ones: still the 20th.
    for (let index = 0; index < UNDO_WINDOW - 1; index += 1) {
      repositories.imports.seed({ status: "undone", createdAt: `2026-10-${String(10 + (index % 18)).padStart(2, "0")}T12:00:00.000Z` });
    }
    repositories.imports.batches.find((other) => other.id === batch.id)!.createdAt = "2026-09-01T09:00:00.000Z";
    expect((await listImports()).map((item) => item.batch.id)).toContain(batch.id);

    // One more import, newer, pushes it out of the list.
    repositories.imports.seed({ status: "undone", createdAt: "2026-10-28T12:00:00.000Z" });

    await expect(undoImport(batch.id)).rejects.toMatchObject({ status: 409, message: IMPORT_TOO_OLD_TO_UNDO_MESSAGE });
    expect(repositories.expenses.expenses.get(userId)).toHaveLength(2);
  });
});

describe("discardDraft", () => {
  it("deletes the draft and its rows", async () => {
    const { batch } = await createDraft(userId, statement(), now);

    await discardDraft(batch.id);

    expect(repositories.imports.batches).toEqual([]);
    expect(repositories.imports.rows).toEqual([]);
    await expect(getDraft(userId, batch.id)).rejects.toMatchObject({ status: 404 });
  });

  it("is a 409 for a confirmed import, which stays, and a 404 for a missing or someone else's draft", async () => {
    const { batch } = await createDraft(userId, statement(), now);
    const rows = await draftRows(batch.id);
    await confirmDraft(userId, batch.id, ticked([{ id: rows.Lidl.id, description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" }]));
    repositories.imports.callerId = otherUserId;
    const theirs = await createDraft(otherUserId, upload("2026-10-20,Kaufland,-10.00,EUR"), now);
    repositories.imports.callerId = userId;

    await expect(discardDraft(batch.id)).rejects.toMatchObject({ status: 409 });
    await expect(discardDraft(theirs.batch.id)).rejects.toMatchObject({ status: 404 });
    await expect(discardDraft("missing")).rejects.toMatchObject({ status: 404 });
    expect(repositories.imports.batches).toHaveLength(2);
  });
});

describe("listImports and getImport", () => {
  it("lists the user's recent imports with their counts, newest first", async () => {
    const first = await createDraft(userId, upload("2026-10-12,Lidl,-45.20,EUR"), now);
    const [row] = (await getDraft(userId, first.batch.id)).rows;
    await confirmDraft(userId, first.batch.id, ticked([{ id: row.id, description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" }]));
    repositories.imports.now = () => new Date("2026-10-29T12:00:00.000Z");
    const draft = await createDraft(userId, upload("2026-10-20,Kaufland,-10.00,EUR"), now);
    repositories.imports.callerId = otherUserId;
    await createDraft(otherUserId, upload("2026-10-21,Shop,-1.00,EUR"), now);
    repositories.imports.callerId = userId;

    const recent = await listImports();

    expect(recent.map((item) => [item.batch.id, item.batch.status, item.expenseCount, item.changedCount])).toEqual([
      [draft.batch.id, "draft", 0, 0],
      [first.batch.id, "confirmed", 1, 0],
    ]);
  });

  it("returns an import's summary in any status, and a 404 for a missing, someone else's or expired one", async () => {
    const { batch } = await createDraft(userId, statement(), now);
    const rows = await draftRows(batch.id);
    await confirmDraft(userId, batch.id, ticked([{ id: rows.Lidl.id, description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" }]));
    const expiring = await createDraft(userId, upload("2026-10-20,Kaufland,-10.00,EUR"), now);

    expect((await getImport(batch.id)).status).toBe("confirmed");
    await expect(getImport("missing")).rejects.toMatchObject({ status: 404 });

    repositories.imports.now = () => new Date("2026-10-31T10:00:00.000Z");
    await expect(getImport(expiring.batch.id)).rejects.toMatchObject({ status: 404 });
    repositories.imports.callerId = otherUserId;
    await expect(getImport(batch.id)).rejects.toMatchObject({ status: 404 });
  });
});
