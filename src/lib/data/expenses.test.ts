import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);
import { summarizeExpenses, updateExpenseForUser } from "./expenses";

type Row = { id: string; user_id: string; description: string; amount: string; category: ExpenseCategory; subtype: ExpenseSubtype | null; expense_date: string; notes: string | null };
const fuel: Row = { id: "fuel", user_id: "owner", description: "Fuel", amount: "10.50", category: "car", subtype: "car_fuel", expense_date: "2026-09-01", notes: "Full tank" };

let rows: Row[];
let updates: Record<string, unknown>[];
let filters: Record<string, string>[];
let classifier: (row: Row) => Row;

// Applies eq filters, then either reads or patches the matching rows like the Data API.
function client() {
  return { from: vi.fn(() => {
    let patch: Record<string, unknown> | null = null;
    const eqs: Record<string, string> = {};
    const matching = () => rows.filter((row) => Object.entries(eqs).every(([key, value]) => row[key as keyof Row] === value));
    const query = {
      select: vi.fn(() => query),
      update: vi.fn((values: Record<string, unknown>) => { patch = values; updates.push(values); return query; }),
      eq: vi.fn((key: string, value: string) => { eqs[key] = value; return query; }),
      maybeSingle: vi.fn(async () => {
        filters.push({ ...eqs });
        const [found] = matching();
        if (!found) return { data: null, error: null };
        if (!patch) return { data: found, error: null };
        const stored = classifier({ ...found, ...patch } as Row);
        rows = rows.map((row) => (row.id === stored.id ? stored : row));
        return { data: stored, error: null };
      }),
    };
    return query;
  }) };
}

describe("updateExpenseForUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rows = [fuel, { ...fuel, id: "foreign", user_id: "other" }];
    updates = [];
    filters = [];
    classifier = (row) => row;
    mocks.createClient.mockResolvedValue(client());
  });

  it("merges the patch and scopes both load and write to the owner", async () => {
    const expense = await updateExpenseForUser("owner", "fuel", { amount: "12", notes: null });
    expect(expense).toEqual({ id: "fuel", description: "Fuel", amount: 12, category: "car", subtype: "car_fuel", expenseDate: "2026-09-01", notes: null });
    expect(updates).toEqual([{ description: "Fuel", amount: 12, category: "car", subtype: "car_fuel", expense_date: "2026-09-01", notes: null }]);
    expect(filters).toEqual([{ id: "fuel", user_id: "owner" }, { id: "fuel", user_id: "owner" }]);
  });

  it("rejects an explicit subtype that does not belong to the category", async () => {
    const error = await updateExpenseForUser("owner", "fuel", { category: "groceries", subtype: "car_fuel" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).flatten().fieldErrors).toHaveProperty("subtype");
    expect(updates).toEqual([]);
  });

  it("resets a stored subtype that no longer fits a changed category", async () => {
    const expense = await updateExpenseForUser("owner", "fuel", { category: "groceries" });
    expect(updates[0]).toMatchObject({ category: "groceries", subtype: null });
    expect(expense).toMatchObject({ category: "groceries", subtype: null });
  });

  it("keeps a stored subtype that still fits the patched category", async () => {
    await updateExpenseForUser("owner", "fuel", { category: "car" });
    expect(updates[0]).toMatchObject({ category: "car", subtype: "car_fuel" });
  });

  it("returns null for foreign or missing expenses without writing", async () => {
    expect(await updateExpenseForUser("owner", "foreign", { amount: 1 })).toBeNull();
    expect(await updateExpenseForUser("owner", "missing", { amount: 1 })).toBeNull();
    expect(updates).toEqual([]);
    expect(rows.find((row) => row.id === "foreign")?.amount).toBe("10.50");
  });

  it("returns the stored classification after a database classifier", async () => {
    classifier = (row) => ({ ...row, category: "car", subtype: "car_fuel" });
    const expense = await updateExpenseForUser("owner", "fuel", { category: "transport", subtype: null });
    expect(updates[0]).toMatchObject({ category: "transport", subtype: null });
    expect(expense).toMatchObject({ category: "car", subtype: "car_fuel" });
  });
});

describe("summarizeExpenses", () => {
  it("totals, counts and averages without dividing by zero", () => {
    expect(summarizeExpenses([])).toEqual({ total: 0, count: 0, average: 0 });
    expect(summarizeExpenses([{ amount: 10 }, { amount: 5 }])).toEqual({ total: 15, count: 2, average: 7.5 });
  });
});
