import { describe, expect, it } from "vitest";

import {
  addLabel,
  CATEGORY_SOURCE_LABELS,
  confirmRows,
  describeDuplicate,
  descriptionProblem,
  foreignCurrencyReason,
  formatDay,
  formatPeriod,
  formatPlainAmount,
  initialReview,
  monthsOf,
  parserLabel,
  pluralize,
  reviewReducer,
  rowErrorsFromFields,
  rowProblems,
  summaryParts,
  tickedRows,
  tickedTotal,
  type ReviewRow,
} from "@/lib/imports/review";
import type { DraftRow, ImportBatch } from "@/lib/imports/types";

function aRow(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    id: "r1",
    position: 1,
    expenseDate: "2026-10-12",
    description: "Lidl",
    amount: 45.2,
    currency: "EUR",
    category: "other",
    subtype: null,
    ruleMatched: false,
    categorySource: null,
    notes: null,
    duplicateOf: null,
    importable: true,
    ...overrides,
  };
}

const batch: ImportBatch = {
  id: "b1",
  status: "draft",
  sourceKind: "csv",
  parserId: "generic-csv",
  currency: "EUR",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  rowCount: 4,
  skippedCredits: 4,
  createdAt: "2026-10-29T10:00:00.000Z",
  expiresAt: "2026-10-30T10:00:00.000Z",
  confirmedAt: null,
  confirmedCount: null,
  undoneAt: null,
};

const duplicate = { id: "e1", description: "Lidl", expenseDate: "2026-10-12", amount: 45.2 };

/** A normal row, a possible duplicate, a row in another currency and a rule-matched car row. */
const rows = [
  aRow({ id: "a", description: "Cafe", amount: 4.5 }),
  aRow({ id: "b", description: "Lidl", duplicateOf: duplicate }),
  aRow({ id: "c", description: "Foreign shop", currency: "RON", importable: false }),
  aRow({ id: "d", description: "OMV", amount: 300, category: "car", subtype: "car_fuel", ruleMatched: true, categorySource: "rule" }),
];

const ids = (state: ReviewRow[]) => tickedRows(state).map((item) => item.row.id);

describe("initialReview", () => {
  it("ticks ordinary rows and leaves duplicates and foreign-currency rows unticked", () => {
    expect(ids(initialReview(rows))).toEqual(["a", "d"]);
  });

  it("starts from the draft's own values", () => {
    const [cafe, , , omv] = initialReview(rows);
    expect(cafe).toMatchObject({ description: "Cafe", category: "other", subtype: null });
    expect(omv).toMatchObject({ category: "car", subtype: "car_fuel" });
  });
});

describe("a row's category source", () => {
  const sourced = [
    aRow({ id: "h", description: "Lidl", category: "groceries", categorySource: "history" }),
    aRow({ id: "m", description: "Netflix", category: "entertainment", categorySource: "ai" }),
    aRow({ id: "n", description: "Cafe" }),
    // A rule row whose source was never stored still says it was the rule.
    aRow({ id: "r", description: "OMV", category: "car", subtype: "car_fuel", ruleMatched: true, categorySource: null }),
  ];
  const sourceOf = (state: ReviewRow[], id: string) => state.find((item) => item.row.id === id)?.categorySource;

  it("starts as the draft's source, and as the rule for a rule-matched row", () => {
    const state = initialReview(sourced);
    expect(["h", "m", "n", "r"].map((id) => sourceOf(state, id))).toEqual(["history", "ai", null, "rule"]);
  });

  it("is dropped when the category or the subtype is changed, so the row stops claiming it", () => {
    const state = initialReview(sourced);
    expect(sourceOf(reviewReducer(state, { type: "categorise", id: "m", category: "shopping" }), "m")).toBeNull();
    expect(sourceOf(reviewReducer(state, { type: "categorise", id: "h", category: "car" }), "h")).toBeNull();
    // Only the row that was changed loses its source.
    expect(sourceOf(reviewReducer(state, { type: "categorise", id: "m", category: "shopping" }), "h")).toBe("history");

    const car = initialReview([aRow({ id: "x", category: "car", categorySource: "ai" })]);
    expect(reviewReducer(car, { type: "subtype", id: "x", subtype: "car_repairs" })[0].categorySource).toBeNull();
  });

  it("is kept by an edit that is not a category, by a rejected subtype and by a row a merchant rule set", () => {
    let state = initialReview(sourced);
    state = reviewReducer(state, { type: "describe", id: "m", description: "Netflix.com" });
    state = reviewReducer(state, { type: "toggle", id: "m" });
    state = reviewReducer(state, { type: "categorise", id: "r", category: "groceries" });
    state = reviewReducer(state, { type: "subtype", id: "r", subtype: "car_repairs" });
    expect(sourceOf(state, "m")).toBe("ai");
    expect(sourceOf(state, "r")).toBe("rule");
  });

  it("has the plan's wording", () => {
    expect(CATEGORY_SOURCE_LABELS).toEqual({ rule: "Merchant rule", history: "Like last time", ai: "AI suggestion" });
  });
});

describe("reviewReducer", () => {
  it("toggles a row, but never one that can't be imported", () => {
    let state = initialReview(rows);
    state = reviewReducer(state, { type: "toggle", id: "a" });
    state = reviewReducer(state, { type: "toggle", id: "b" });
    state = reviewReducer(state, { type: "toggle", id: "c" });
    expect(ids(state)).toEqual(["b", "d"]);
  });

  it("selects all importable rows, none, and all except duplicates", () => {
    const start = initialReview(rows);
    expect(ids(reviewReducer(start, { type: "selectAll" }))).toEqual(["a", "b", "d"]);
    expect(ids(reviewReducer(start, { type: "selectNone" }))).toEqual([]);
    const all = reviewReducer(start, { type: "selectAll" });
    expect(ids(reviewReducer(all, { type: "selectExceptDuplicates" }))).toEqual(["a", "d"]);
  });

  it("changes a description and a category, dropping a subtype the new category doesn't have", () => {
    let state = initialReview([aRow({ id: "x", category: "other" })]);
    state = reviewReducer(state, { type: "describe", id: "x", description: "Lidl Cluj" });
    state = reviewReducer(state, { type: "categorise", id: "x", category: "car" });
    state = reviewReducer(state, { type: "subtype", id: "x", subtype: "car_repairs" });
    expect(state[0]).toMatchObject({ description: "Lidl Cluj", category: "car", subtype: "car_repairs" });
    state = reviewReducer(state, { type: "categorise", id: "x", category: "groceries" });
    expect(state[0]).toMatchObject({ category: "groceries", subtype: null });
  });

  it("ignores a subtype that doesn't belong to the row's category", () => {
    const state = reviewReducer(initialReview([aRow({ id: "x" })]), { type: "subtype", id: "x", subtype: "car_fuel" });
    expect(state[0].subtype).toBeNull();
  });

  it("keeps the category of a row set by a merchant rule", () => {
    let state = initialReview(rows);
    state = reviewReducer(state, { type: "categorise", id: "d", category: "groceries" });
    state = reviewReducer(state, { type: "subtype", id: "d", subtype: "car_repairs" });
    expect(state[3]).toMatchObject({ category: "car", subtype: "car_fuel" });
  });

  it("changes nothing else", () => {
    const start = initialReview(rows);
    const next = reviewReducer(start, { type: "describe", id: "a", description: "Corner cafe" });
    expect(next.slice(1)).toEqual(start.slice(1));
    expect(start[0].description).toBe("Cafe");
  });
});

describe("the ticked rows", () => {
  it("totals in cents without float drift", () => {
    const state = initialReview([
      aRow({ id: "1", amount: 0.1 }),
      aRow({ id: "2", amount: 0.2 }),
      aRow({ id: "3", amount: 1234.56 }),
    ]);
    expect(tickedTotal(state)).toBe(1234.86);
    expect(tickedTotal(reviewReducer(state, { type: "selectNone" }))).toBe(0);
  });

  it("builds the confirm body from the ticked rows only, with the edits", () => {
    let state = initialReview(rows);
    state = reviewReducer(state, { type: "describe", id: "a", description: "  Corner cafe  " });
    state = reviewReducer(state, { type: "categorise", id: "a", category: "groceries" });
    expect(confirmRows(state)).toEqual([
      { id: "a", description: "Corner cafe", amount: 4.5, expenseDate: "2026-10-12", category: "groceries", subtype: null, notes: null },
      { id: "d", description: "OMV", amount: 300, expenseDate: "2026-10-12", category: "car", subtype: "car_fuel", notes: null },
    ]);
  });

  it("carries a row's overflow notes through unchanged", () => {
    const state = initialReview([aRow({ id: "n", notes: "the rest of a long description" })]);
    expect(confirmRows(state)[0].notes).toBe("the rest of a long description");
  });

  it("finds a blank description only on a ticked row", () => {
    let state = initialReview(rows);
    state = reviewReducer(state, { type: "describe", id: "a", description: "   " });
    state = reviewReducer(state, { type: "describe", id: "b", description: "" });
    expect(rowProblems(state)).toEqual({ a: "Enter a description." });
    expect(descriptionProblem("x".repeat(121))).toBe("Use at most 120 characters.");
    expect(descriptionProblem("x".repeat(120))).toBeNull();
  });
});

describe("rowErrorsFromFields", () => {
  const sent = [{ id: "a" }, { id: "d" }];

  it("maps rows.<index>.<field> to the row sent at that index", () => {
    const { byRow, other } = rowErrorsFromFields(
      { "rows.1.amount": ["Amount must be greater than zero."], "rows.1.description": ["Enter a description."], "rows.0.id": ["Not in this import."] },
      sent,
    );
    expect(byRow).toEqual({ d: "Amount must be greater than zero.", a: "Not in this import." });
    expect(other).toEqual([]);
  });

  it("keeps messages that belong to no row", () => {
    const { byRow, other } = rowErrorsFromFields({ rows: ["Choose at least one row."], "rows.5.amount": ["Too big."] }, sent);
    expect(byRow).toEqual({});
    expect(other).toEqual(["Choose at least one row.", "Too big."]);
  });

  it("accepts no field errors", () => {
    expect(rowErrorsFromFields(undefined, sent)).toEqual({ byRow: {}, other: [] });
  });
});

describe("wording", () => {
  it("pluralizes and labels the Add button", () => {
    expect(pluralize(1, "expense")).toBe("1 expense");
    expect(pluralize(34, "expense")).toBe("34 expenses");
    expect(addLabel(34)).toBe("Add 34 expenses");
    expect(addLabel(1)).toBe("Add 1 expense");
    expect(addLabel(0)).toBe("Add expenses");
  });

  it("names the parser, falling back for an unknown id", () => {
    expect(parserLabel("generic-csv")).toBe("Generic CSV");
    expect(parserLabel("nobody")).toBe("Statement");
    // The suffix for the model's categories keeps the parser that read the rows; a read statement has no parser.
    expect(parserLabel("generic-csv+ai:statement-categorise-v1")).toBe("Generic CSV");
    expect(parserLabel("ai:statement-reader-v1")).toBe("AI-read statement");
  });

  it("formats days and periods", () => {
    expect(formatDay("2026-10-05")).toBe("5 Oct");
    expect(formatDay("2026-10-05", true)).toBe("5 Oct 2026");
    expect(formatPeriod("2026-10-01", "2026-10-31")).toBe("1 Oct to 31 Oct 2026");
    expect(formatPeriod("2026-10-01", "2026-10-01")).toBe("1 Oct 2026");
    expect(formatPeriod(null, null)).toBeNull();
  });

  it("quotes the look-alike expense as the plan shows it", () => {
    expect(describeDuplicate(duplicate)).toBe("Lidl, 12 Oct, 45.20");
    expect(formatPlainAmount(1234.5)).toBe("1,234.50");
  });

  it("explains a foreign-currency row", () => {
    expect(foreignCurrencyReason("RON", "EUR")).toBe("In RON. Your account is in EUR, so this can't be imported.");
  });

  it("summarises the rows, leaving out counts of zero", () => {
    expect(summaryParts(batch, rows)).toEqual([
      "4 rows",
      "1 possible duplicate",
      "1 in another currency",
      "4 incoming payments skipped",
    ]);
    expect(summaryParts({ ...batch, skippedCredits: 0 }, [aRow()])).toEqual(["1 row"]);
  });

  it("lists the months of the created expenses, newest first", () => {
    expect(monthsOf([{ expenseDate: "2026-09-30" }, { expenseDate: "2026-10-02" }, { expenseDate: "2026-10-20" }]))
      .toEqual(["2026-10", "2026-09"]);
  });
});
