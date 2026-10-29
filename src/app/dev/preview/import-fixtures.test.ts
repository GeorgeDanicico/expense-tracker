import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiError } from "@/lib/api/client";
import { confirmRows, initialReview, reviewReducer } from "@/lib/imports/review";

import { previewImportApi, previewSampleStatement } from "./import-fixtures";

// The preview API runs the real generic CSV parser, duplicate matcher and confirm schema, so this is
// the plan's end-to-end check at the API level: upload a CSV, untick a row, change a category,
// confirm, and the right expenses come back (and go again on undo).

const sample = () => new File([previewSampleStatement()], "statement.csv", { type: "text/csv" });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-29T10:00:00Z"));
  // The preview keeps its drafts in module state; a fresh module per test starts clean.
  vi.resetModules();
});

async function freshApi() {
  return (await import("./import-fixtures")).previewImportApi;
}

describe("the import preview API", () => {
  it("reads the sample statement into a draft with its duplicates, foreign row, rule row and skipped credits", async () => {
    const api = await freshApi();
    const { batch, reopened } = await api.upload(sample(), "text/csv");
    expect(reopened).toBe(false);
    expect(batch).toMatchObject({ status: "draft", parserId: "generic-csv", skippedCredits: 5, rowCount: 12 });

    const draft = await api.getDraft(batch.id);
    const by = Object.fromEntries(draft.rows.map((row) => [row.description, row]));
    expect(draft.rows.filter((row) => row.duplicateOf).map((row) => row.description))
      .toEqual(["Lidl Cluj Napoca 1234", "Kaufland Marasti", "Farmacia Dona"]);
    expect(by["Zara Store Bucuresti"]).toMatchObject({ currency: "RON", importable: false });
    expect(by["OMV 1642 Satu Mare"]).toMatchObject({ category: "car", subtype: "car_fuel", ruleMatched: true });
  });

  it("creates exactly the ticked rows, with the edits, and undo removes them", async () => {
    const api = await freshApi();
    const { batch } = await api.upload(sample(), "text/csv");
    const draft = await api.getDraft(batch.id);

    let state = initialReview(draft.rows);
    const netflix = draft.rows.find((row) => row.description === "Netflix.com")!;
    const bolt = draft.rows.find((row) => row.description === "Bolt ride")!;
    state = reviewReducer(state, { type: "toggle", id: netflix.id });
    state = reviewReducer(state, { type: "categorise", id: bolt.id, category: "transport" });

    const { created, batch: confirmed } = await api.confirm(batch.id, confirmRows(state));
    expect(confirmed).toMatchObject({ status: "confirmed", confirmedCount: 7 });
    expect(created.map((expense) => expense.description).toSorted()).toEqual([
      "Bolt ride", "Booking.com hotel two nights", "Cinema City Polus", "Digi internet",
      "OMV 1642 Satu Mare", "Online course Udemy", "Starbucks Unirii",
    ]);
    expect(created.find((expense) => expense.description === "Bolt ride")).toMatchObject({ category: "transport", amount: 7.8 });
    expect(created.find((expense) => expense.description === "OMV 1642 Satu Mare")).toMatchObject({ category: "car", subtype: "car_fuel" });

    // The same statement is refused while it is confirmed, and accepted again after an undo.
    await expect(api.upload(sample(), "text/csv")).rejects.toMatchObject({ status: 409 });
    await expect(api.undo(batch.id)).resolves.toMatchObject({ removed: 7 });
    await expect(api.upload(sample(), "text/csv")).resolves.toMatchObject({ reopened: false });
  });

  it("reopens a draft for the same statement", async () => {
    const api = await freshApi();
    const first = await api.upload(sample(), "text/csv");
    await expect(api.upload(sample(), "text/csv")).resolves.toMatchObject({ reopened: true, batch: { id: first.batch.id } });
  });

  it("refuses a bad row with field errors keyed by row and saves nothing", async () => {
    const api = await freshApi();
    const { batch } = await api.upload(sample(), "text/csv");
    const draft = await api.getDraft(batch.id);
    const rows = confirmRows(initialReview(draft.rows));
    rows[1] = { ...rows[1], amount: 0 };

    const caught = await api.confirm(batch.id, rows).catch((error: unknown) => error);
    expect(caught).toMatchObject({ name: "ApiError", status: 422 });
    expect(Object.keys((caught as ApiError).fieldErrors ?? {})).toEqual(["rows.1.amount"]);
    // Still a draft: it can be confirmed once fixed.
    await expect(api.getDraft(batch.id)).resolves.toMatchObject({ batch: { status: "draft" } });
  });

  it("refuses a row in another currency and a file that isn't a statement", async () => {
    const api = await freshApi();
    const { batch } = await api.upload(sample(), "text/csv");
    const draft = await api.getDraft(batch.id);
    const foreign = draft.rows.find((row) => !row.importable)!;
    const caught = await api.confirm(batch.id, [
      { id: foreign.id, description: foreign.description, amount: foreign.amount, expenseDate: foreign.expenseDate, category: "other", subtype: null, notes: null },
    ]).catch((error: unknown) => error);
    expect((caught as ApiError).fieldErrors).toEqual({ "rows.0.id": ["That row is in RON, not EUR, and can't be imported."] });

    await expect(api.upload(new File(["hello,world\n1,2\n"], "x.csv"), "text/csv"))
      .rejects.toMatchObject({ status: 422, message: "This statement's layout isn't supported yet." });
  });

  it("discards a draft", async () => {
    const api = await freshApi();
    const { batch } = await api.upload(sample(), "text/csv");
    await api.discard(batch.id);
    await expect(api.getDraft(batch.id)).rejects.toMatchObject({ status: 404 });
  });

  it("exports an API for the page", () => {
    expect(Object.keys(previewImportApi).toSorted()).toEqual(["confirm", "discard", "getDraft", "undo", "upload"]);
  });
});
