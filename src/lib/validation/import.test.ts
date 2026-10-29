import { describe, expect, it } from "vitest";

import { confirmImportSchema } from "@/lib/validation/import";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  description: "Lidl",
  amount: 45.2,
  category: "groceries",
  expenseDate: "2026-10-12",
  ...overrides,
});

const errors = (rows: unknown) => {
  const result = confirmImportSchema.safeParse({ rows });
  return result.success ? null : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("confirmImportSchema", () => {
  it("parses a row like a hand-typed expense, with the row id", () => {
    expect(confirmImportSchema.parse({ rows: [row({ description: "  Lidl  ", amount: "45.20", notes: "  extra " })] })).toEqual({
      rows: [{ id: ID, description: "Lidl", amount: 45.2, category: "groceries", subtype: null, expenseDate: "2026-10-12", notes: "extra" }],
    });
  });

  it("accepts a car subtype and a null subtype", () => {
    const parsed = confirmImportSchema.parse({
      rows: [row({ category: "car", subtype: "car_fuel" }), row({ id: OTHER, subtype: null })],
    });
    expect(parsed.rows.map((r) => r.subtype)).toEqual(["car_fuel", null]);
  });

  it("treats null notes as no notes", () => {
    const parsed = confirmImportSchema.parse({ rows: [row({ notes: null })] });
    expect(parsed.rows[0].notes).toBeUndefined();
  });

  it("accepts 1 and 500 rows", () => {
    expect(errors([row()])).toBeNull();
    const many = Array.from({ length: 500 }, (_, index) => row({ id: crypto.randomUUID(), description: `Row ${index}` }));
    expect(errors(many)).toBeNull();
  });

  it("rejects no rows, 501 rows and a missing list", () => {
    expect(errors([])).toEqual(["rows: Choose at least one row to import."]);
    const many = Array.from({ length: 501 }, () => row({ id: crypto.randomUUID() }));
    expect(errors(many)).toEqual(["rows: Import at most 500 rows at a time."]);
    expect(confirmImportSchema.safeParse({}).success).toBe(false);
    expect(confirmImportSchema.safeParse({ rows: "x" }).success).toBe(false);
    expect(confirmImportSchema.safeParse(null).success).toBe(false);
  });

  it("applies the expense rules to each row, naming the row", () => {
    expect(errors([row(), row({ id: OTHER, description: "   " })])).toEqual(["rows.1.description: Enter a description."]);
    expect(errors([row({ description: "x".repeat(121) })])).toEqual([expect.stringMatching(/^rows\.0\.description:/)]);
    expect(errors([row({ description: "x".repeat(120) })])).toBeNull();
    expect(errors([row({ amount: 0 })])).toEqual(["rows.0.amount: Amount must be greater than zero."]);
    expect(errors([row({ amount: -5 })])).toEqual(["rows.0.amount: Amount must be greater than zero."]);
    expect(errors([row({ amount: 9_999_999_999.99 })])).toBeNull();
    expect(errors([row({ amount: 10_000_000_000 })])).toEqual([expect.stringMatching(/^rows\.0\.amount:/)]);
    expect(errors([row({ category: "groceries2" })])).toEqual([expect.stringMatching(/^rows\.0\.category:/)]);
    expect(errors([row({ expenseDate: "2026-02-30" })])).toEqual(["rows.0.expenseDate: Choose a valid date."]);
    expect(errors([row({ notes: "n".repeat(501) })])).toEqual([expect.stringMatching(/^rows\.0\.notes:/)]);
    expect(errors([row({ notes: "n".repeat(500) })])).toBeNull();
  });

  it("requires a subtype to belong to the category", () => {
    expect(errors([row({ category: "groceries", subtype: "car_fuel" })]))
      .toEqual(["rows.0.subtype: Choose a subtype belonging to the selected category."]);
    expect(errors([row({ category: "car", subtype: "fuel" })])).toEqual([expect.stringMatching(/^rows\.0\.subtype:/)]);
  });

  it("requires a row id that is a UUID", () => {
    expect(errors([row({ id: "not-an-id" })])).toEqual(["rows.0.id: Choose rows of this import."]);
    expect(errors([{ ...row(), id: undefined }])).toEqual([expect.stringMatching(/^rows\.0\.id:/)]);
  });

  it("refuses a repeated row id, as the database does", () => {
    expect(errors([row(), row({ description: "Again" })])).toEqual(["rows.1.id: Each row can be imported only once."]);
  });

  it("refuses a row that isn't an object", () => {
    expect(errors(["x"])).not.toBeNull();
    expect(errors([null])).not.toBeNull();
    expect(errors([[]])).not.toBeNull();
  });
});
