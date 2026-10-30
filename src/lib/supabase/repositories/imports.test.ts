import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import {
  IMPORT_ALREADY_EXISTS_MESSAGE,
  IMPORT_NOT_A_DRAFT_MESSAGE,
  IMPORT_NOT_CONFIRMED_MESSAGE,
  IMPORT_NOT_FOUND_MESSAGE,
  IMPORT_ROWS_REFUSED_MESSAGE,
} from "@/lib/imports/repository";
import type { ConfirmImportRowPayload, CreateImportBatchPayload, CreateImportRowPayload } from "@/lib/imports/types";
import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { supabaseImportRepository as imports, translateImportError } from "@/lib/supabase/repositories/imports";

const hash = "a".repeat(64);
let nextId = 1;
const uuid = () => `60000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;

function aBatchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    user_id: "owner",
    status: "draft",
    source_kind: "csv",
    parser_id: "generic-csv",
    content_hash: hash,
    currency: "EUR",
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    row_count: 2,
    skipped_credits: 1,
    created_at: "2026-10-29T09:00:00+00:00",
    expires_at: "2026-10-30T09:00:00+00:00",
    confirmed_at: null,
    confirmed_count: null,
    undone_at: null,
    ...overrides,
  };
}

const confirmedRow = (overrides: Record<string, unknown> = {}) =>
  aBatchRow({ status: "confirmed", expires_at: null, confirmed_at: "2026-10-29T09:30:00+00:00", confirmed_count: 2, ...overrides });

function aRowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    batch_id: "batch",
    position: 1,
    expense_date: "2026-10-12",
    description: "Lidl",
    amount: "45.20",
    currency: "EUR",
    category: "other",
    subtype: null,
    rule_matched: false,
    category_source: null,
    notes: null,
    ...overrides,
  };
}

function useDatabase(
  tables: { import_batches?: Record<string, unknown>[]; import_rows?: Record<string, unknown>[]; import_expenses?: Record<string, unknown>[] },
  options: FakeSupabaseOptions = {},
) {
  const database = fakeSupabase({ import_batches: [], import_rows: [], import_expenses: [], ...tables }, options);
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

const batchPayload: CreateImportBatchPayload = {
  source_kind: "csv",
  parser_id: "generic-csv",
  content_hash: hash,
  currency: "EUR",
  period_start: "2026-10-01",
  period_end: "2026-10-31",
  skipped_credits: 1,
};
const rowPayloads: CreateImportRowPayload[] = [
  { expense_date: "2026-10-12", description: "Lidl", amount: 45.2, currency: "EUR", notes: null },
  { expense_date: "2026-10-13", description: "OMV", amount: 300, currency: "EUR", notes: null },
];
const confirmPayloads: ConfirmImportRowPayload[] = [
  { id: "row-1", description: "Lidl", amount: 45.2, expense_date: "2026-10-12", category: "groceries", subtype: null, notes: null },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T10:00:00.000Z"));
});

afterEach(() => vi.useRealTimers());

describe("translateImportError", () => {
  const translate = (code: string | undefined) =>
    translateImportError({ code, message: "private text: value (12.5)" }, "Fallback.", "Wrong status.");

  it.each([
    ["P0002", 404, IMPORT_NOT_FOUND_MESSAGE],
    ["55000", 409, "Wrong status."],
    ["23505", 409, IMPORT_ALREADY_EXISTS_MESSAGE],
    ["22023", 422, IMPORT_ROWS_REFUSED_MESSAGE],
    ["23514", 422, IMPORT_ROWS_REFUSED_MESSAGE],
  ])("maps %s to a %i with a fixed message", (code, status, message) => {
    const error = translate(code);

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ status, message });
  });

  it("maps 42501 to a 403 with the database's message, and anything else to the fallback", () => {
    expect(translate("42501")).toMatchObject({ status: 403, message: "private text: value (12.5)" });
    for (const code of ["23502", "22P02", undefined]) {
      const error = translate(code);
      expect(error).not.toBeInstanceOf(DomainError);
      expect(error.message).toBe("Fallback.");
    }
  });
});

describe("createBatch", () => {
  it("calls create_import_batch with the batch and rows, then returns the stored batch", async () => {
    const stored = aBatchRow();
    const { rpcs, queries } = useDatabase({ import_batches: [stored] }, { rpc: () => ({ data: stored.id, error: null }) });

    const batch = await imports.createBatch(batchPayload, rowPayloads);

    expect(rpcs).toEqual([{ fn: "create_import_batch", args: { p_batch: batchPayload, p_rows: rowPayloads } }]);
    expect(queries[0].filters).toEqual([["eq", "id", stored.id]]);
    expect(batch).toEqual({
      id: stored.id,
      status: "draft",
      sourceKind: "csv",
      parserId: "generic-csv",
      currency: "EUR",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      rowCount: 2,
      skippedCredits: 1,
      createdAt: "2026-10-29T09:00:00.000Z",
      expiresAt: "2026-10-30T09:00:00.000Z",
      confirmedAt: null,
      confirmedCount: null,
      undoneAt: null,
    });
    expect(batch).not.toHaveProperty("contentHash");
    expect(batch).not.toHaveProperty("userId");
  });

  it("answers a repeated live hash with a 409 and a row the database refuses with a 422", async () => {
    useDatabase({}, { rpc: () => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }) });
    await expect(imports.createBatch(batchPayload, rowPayloads)).rejects.toMatchObject({ status: 409, message: IMPORT_ALREADY_EXISTS_MESSAGE });

    useDatabase({}, { rpc: () => ({ data: null, error: { code: "23514", message: "new row violates check constraint" } }) });
    await expect(imports.createBatch(batchPayload, rowPayloads)).rejects.toMatchObject({ status: 422, message: IMPORT_ROWS_REFUSED_MESSAGE });
  });

  it("keeps other failures private", async () => {
    useDatabase({}, { rpc: () => ({ data: null, error: { code: "XX000", message: "private database failure" } }) });

    await expect(imports.createBatch(batchPayload, rowPayloads)).rejects.toThrow(new Error("Unable to save the import."));
  });

  it("fails when the batch can't be read back", async () => {
    useDatabase({}, { rpc: () => ({ data: "missing", error: null }) });

    await expect(imports.createBatch(batchPayload, rowPayloads)).rejects.toThrow(new Error("Unable to save the import."));
  });
});

describe("findLiveByHash", () => {
  it("returns the draft or confirmed batch with the hash", async () => {
    const draft = aBatchRow();
    const { queries } = useDatabase({ import_batches: [draft, aBatchRow({ content_hash: "b".repeat(64) })] });

    expect((await imports.findLiveByHash(hash))?.id).toBe(draft.id);
    expect(queries[0].filters).toEqual([["eq", "content_hash", hash], ["in", "status", ["draft", "confirmed"]]]);
  });

  it("returns a confirmed import, whose expires_at is null", async () => {
    const confirmed = confirmedRow();
    useDatabase({ import_batches: [confirmed] });

    expect(await imports.findLiveByHash(hash)).toMatchObject({ id: confirmed.id, status: "confirmed", confirmedAt: "2026-10-29T09:30:00.000Z" });
  });

  it("returns null for an expired draft and for no batch", async () => {
    useDatabase({ import_batches: [aBatchRow({ expires_at: "2026-10-29T09:59:59+00:00" })] });
    expect(await imports.findLiveByHash(hash)).toBeNull();

    useDatabase({});
    expect(await imports.findLiveByHash(hash)).toBeNull();
  });

  it("fails with the load message", async () => {
    useDatabase({}, { fail: () => true });

    await expect(imports.findLiveByHash(hash)).rejects.toThrow(new Error("Unable to load your imports."));
  });
});

describe("getDraft", () => {
  it("returns the batch with its rows in statement order, amounts as numbers", async () => {
    const batch = aBatchRow();
    const second = aRowRow({ batch_id: batch.id, position: 2, description: "OMV", amount: "300.00", category: "car", subtype: "car_fuel", rule_matched: true, category_source: "rule", notes: "tail" });
    const first = aRowRow({ batch_id: batch.id, position: 1 });
    const { queries } = useDatabase({ import_batches: [batch], import_rows: [second, first, aRowRow({ batch_id: "other" })] });

    const draft = await imports.getDraft(batch.id);

    expect(draft?.batch.id).toBe(batch.id);
    expect(draft?.rows).toEqual([
      {
        id: first.id, position: 1, expenseDate: "2026-10-12", description: "Lidl", amount: 45.2, currency: "EUR",
        category: "other", subtype: null, ruleMatched: false, categorySource: null, notes: null,
      },
      {
        id: second.id, position: 2, expenseDate: "2026-10-12", description: "OMV", amount: 300, currency: "EUR",
        category: "car", subtype: "car_fuel", ruleMatched: true, categorySource: "rule", notes: "tail",
      },
    ]);
    expect(queries.map((query) => [query.table, query.filters])).toEqual([
      ["import_batches", [["eq", "id", batch.id]]],
      ["import_rows", [["eq", "batch_id", batch.id]]],
    ]);
    expect(queries[1].orders).toEqual(["position"]);
  });

  it("carries where each category came from, and refuses a source it doesn't know", async () => {
    const batch = aBatchRow();
    const history = aRowRow({ batch_id: batch.id, position: 1, category: "groceries", category_source: "history" });
    const ai = aRowRow({ batch_id: batch.id, position: 2, category: "health", category_source: "ai" });
    useDatabase({ import_batches: [batch], import_rows: [history, ai] });

    const draft = await imports.getDraft(batch.id);

    expect(draft?.rows.map((row) => [row.category, row.categorySource])).toEqual([["groceries", "history"], ["health", "ai"]]);

    useDatabase({ import_batches: [batch], import_rows: [aRowRow({ batch_id: batch.id, category_source: "guess" })] });
    await expect(imports.getDraft(batch.id)).rejects.toThrow(new Error("Unable to load your imports."));
  });

  it("returns null for a missing batch, a confirmed or undone one and an expired draft", async () => {
    const expired = aBatchRow({ expires_at: "2026-10-29T10:00:00+00:00" });
    const confirmed = confirmedRow();
    const undone = aBatchRow({ status: "undone", expires_at: null, confirmed_at: "2026-10-28T09:00:00+00:00", undone_at: "2026-10-29T08:00:00+00:00" });
    useDatabase({ import_batches: [expired, confirmed, undone] });

    for (const id of [expired.id, confirmed.id, undone.id, "missing"]) expect(await imports.getDraft(id)).toBeNull();
  });

  it("fails when a read fails", async () => {
    useDatabase({}, { fail: () => true });

    await expect(imports.getDraft("x")).rejects.toThrow(new Error("Unable to load your imports."));
  });
});

describe("getBatch", () => {
  it("returns a batch in any status, but not an expired draft or a missing one", async () => {
    const draft = aBatchRow();
    const confirmed = confirmedRow();
    const expired = aBatchRow({ expires_at: "2026-10-29T09:00:00+00:00" });
    useDatabase({ import_batches: [draft, confirmed, expired] });

    expect((await imports.getBatch(draft.id))?.status).toBe("draft");
    expect((await imports.getBatch(confirmed.id))?.status).toBe("confirmed");
    expect(await imports.getBatch(expired.id)).toBeNull();
    expect(await imports.getBatch("missing")).toBeNull();
  });

  it("fails on a status or source it doesn't know, and when the read fails", async () => {
    const odd = aBatchRow({ status: "archived" });
    const oddSource = aBatchRow({ source_kind: "xlsx" });
    useDatabase({ import_batches: [odd, oddSource] });
    await expect(imports.getBatch(odd.id)).rejects.toThrow(new Error("Unable to load your imports."));
    await expect(imports.getBatch(oddSource.id)).rejects.toThrow(new Error("Unable to load your imports."));

    useDatabase({}, { fail: () => true });
    await expect(imports.getBatch("x")).rejects.toThrow(new Error("Unable to load your imports."));
  });
});

describe("listRecent", () => {
  const link = (batchId: string, created: string, updated: string) => ({
    batch_id: batchId, expense_id: uuid(), expenses: { created_at: created, updated_at: updated },
  });

  it("lists live drafts and confirmed and undone imports newest first, with counts", async () => {
    const draft = aBatchRow({ created_at: "2026-10-29T09:00:00+00:00" });
    const confirmed = confirmedRow({ created_at: "2026-10-20T09:00:00+00:00" });
    const undone = aBatchRow({ status: "undone", expires_at: null, confirmed_at: "2026-10-10T09:30:00+00:00", undone_at: "2026-10-11T09:00:00+00:00", created_at: "2026-10-10T09:00:00+00:00" });
    const { queries } = useDatabase({
      import_batches: [undone, draft, confirmed],
      import_expenses: [
        link(confirmed.id, "2026-10-20T09:30:00+00:00", "2026-10-20T09:30:00+00:00"),
        link(confirmed.id, "2026-10-20T09:30:00+00:00", "2026-10-25T12:00:00+00:00"),
        link(confirmed.id, "2026-10-20T09:30:00+00:00", "2026-10-20T09:30:00+00:00"),
        link("another-batch", "2026-10-20T09:30:00+00:00", "2026-10-25T12:00:00+00:00"),
      ],
    });

    const recent = await imports.listRecent(20);

    expect(recent.map((item) => [item.batch.id, item.batch.status, item.expenseCount, item.changedCount])).toEqual([
      [draft.id, "draft", 0, 0],
      [confirmed.id, "confirmed", 3, 1],
      [undone.id, "undone", 0, 0],
    ]);
    // Two reads of the batches, then one of the links of the confirmed one, never of the draft or the undone import.
    expect(queries.map((query) => query.table)).toEqual(["import_batches", "import_batches", "import_expenses"]);
    expect(queries[2].filters).toEqual([["in", "batch_id", [confirmed.id]]]);
  });

  it("leaves out an expired draft and keeps to the limit", async () => {
    const newest = confirmedRow({ created_at: "2026-10-28T09:00:00+00:00" });
    const middle = confirmedRow({ created_at: "2026-10-27T09:00:00+00:00" });
    const oldest = confirmedRow({ created_at: "2026-10-26T09:00:00+00:00" });
    const expired = aBatchRow({ created_at: "2026-10-28T10:00:00+00:00", expires_at: "2026-10-29T09:00:00+00:00" });
    useDatabase({ import_batches: [oldest, expired, newest, middle] });

    const recent = await imports.listRecent(2);

    expect(recent.map((item) => item.batch.id)).toEqual([newest.id, middle.id]);
  });

  it("reads the links page by page and advances by the rows actually returned", async () => {
    const confirmed = confirmedRow();
    const links = Array.from({ length: 5 }, () => link(confirmed.id, "2026-10-20T09:30:00+00:00", "2026-10-20T09:30:00+00:00"));
    const { queries } = useDatabase({ import_batches: [confirmed], import_expenses: links }, { pageCap: 2 });

    const [item] = await imports.listRecent(20);

    expect(item.expenseCount).toBe(5);
    expect(queries.filter((query) => query.table === "import_expenses").map((query) => query.range)).toEqual([[0, 999], [2, 1001], [4, 1003]]);
  });

  it("fails with the load message when a read fails", async () => {
    useDatabase({}, { fail: () => true });
    await expect(imports.listRecent(20)).rejects.toThrow(new Error("Unable to load your imports."));

    useDatabase({ import_batches: [confirmedRow()] }, { fail: (query) => query.table === "import_expenses" });
    await expect(imports.listRecent(20)).rejects.toThrow(new Error("Unable to load your imports."));
  });
});

describe("confirm", () => {
  const stored = [
    { id: "expense-1", description: "Lidl", amount: "45.20", category: "groceries", subtype: null, expense_date: "2026-10-12", notes: null },
    { id: "expense-2", description: "OMV", amount: 300, category: "car", subtype: "car_fuel", expense_date: "2026-10-13", notes: "tail" },
  ];

  it("calls confirm_import_batch and returns the batch with the expenses as stored", async () => {
    const batch = confirmedRow();
    const { rpcs } = useDatabase({ import_batches: [batch] }, { rpc: () => ({ data: stored, error: null }) });

    const result = await imports.confirm(batch.id, confirmPayloads);

    expect(rpcs).toEqual([{ fn: "confirm_import_batch", args: { p_batch_id: batch.id, p_rows: confirmPayloads } }]);
    expect(result.batch).toMatchObject({ id: batch.id, status: "confirmed", confirmedCount: 2 });
    expect(result.created).toEqual([
      { id: "expense-1", description: "Lidl", amount: 45.2, category: "groceries", subtype: null, expenseDate: "2026-10-12", notes: null },
      { id: "expense-2", description: "OMV", amount: 300, category: "car", subtype: "car_fuel", expenseDate: "2026-10-13", notes: "tail" },
    ]);
  });

  it.each([
    ["P0002", 404, IMPORT_NOT_FOUND_MESSAGE],
    ["55000", 409, IMPORT_NOT_A_DRAFT_MESSAGE],
    ["22023", 422, IMPORT_ROWS_REFUSED_MESSAGE],
    ["23514", 422, IMPORT_ROWS_REFUSED_MESSAGE],
  ])("maps %s to a %i", async (code, status, message) => {
    useDatabase({}, { rpc: () => ({ data: null, error: { code, message: "private" } }) });

    await expect(imports.confirm("batch", confirmPayloads)).rejects.toMatchObject({ status, message });
  });

  it("keeps other failures private", async () => {
    useDatabase({}, { rpc: () => ({ data: null, error: { code: "XX000", message: "private database failure" } }) });

    await expect(imports.confirm("batch", confirmPayloads)).rejects.toThrow(new Error("Unable to add the expenses."));
  });
});

describe("undo", () => {
  it("calls undo_import_batch and returns the batch and how many expenses it deleted", async () => {
    const batch = aBatchRow({ status: "undone", expires_at: null, confirmed_at: "2026-10-28T09:00:00+00:00", undone_at: "2026-10-29T09:55:00+00:00" });
    const { rpcs } = useDatabase({ import_batches: [batch] }, { rpc: () => ({ data: 37, error: null }) });

    const result = await imports.undo(batch.id);

    expect(rpcs).toEqual([{ fn: "undo_import_batch", args: { p_batch_id: batch.id } }]);
    expect(result).toMatchObject({ removed: 37, batch: { id: batch.id, status: "undone", undoneAt: "2026-10-29T09:55:00.000Z" } });
  });

  it.each([
    ["P0002", 404, IMPORT_NOT_FOUND_MESSAGE],
    ["55000", 409, IMPORT_NOT_CONFIRMED_MESSAGE],
  ])("maps %s to a %i", async (code, status, message) => {
    useDatabase({}, { rpc: () => ({ data: null, error: { code, message: "private" } }) });

    await expect(imports.undo("batch")).rejects.toMatchObject({ status, message });
  });

  it("keeps other failures private", async () => {
    useDatabase({}, { rpc: () => ({ data: null, error: { message: "private database failure" } }) });

    await expect(imports.undo("batch")).rejects.toThrow(new Error("Unable to undo the import."));
  });
});

describe("discard", () => {
  it("deletes the draft with its id and returns true", async () => {
    const draft = aBatchRow();
    const confirmed = confirmedRow();
    const { queries, tables } = useDatabase({ import_batches: [draft, confirmed] });

    expect(await imports.discard(draft.id)).toBe(true);

    expect(queries[0]).toMatchObject({ operation: "delete", filters: [["eq", "id", draft.id], ["eq", "status", "draft"]] });
    expect(tables.import_batches).toEqual([confirmed]);
  });

  it("returns false for a confirmed batch or a missing one, deleting nothing", async () => {
    const confirmed = confirmedRow();
    const { tables } = useDatabase({ import_batches: [confirmed] });

    expect(await imports.discard(confirmed.id)).toBe(false);
    expect(await imports.discard("missing")).toBe(false);
    expect(tables.import_batches).toEqual([confirmed]);
  });

  it("fails with the discard message", async () => {
    useDatabase({}, { fail: () => true });

    await expect(imports.discard("x")).rejects.toThrow(new Error("Unable to discard the import."));
  });
});
