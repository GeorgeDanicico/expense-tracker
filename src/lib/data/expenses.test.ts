import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EXPENSE_TAB_FILTERS, type ExpenseTabFilters } from "@/lib/expenses/filters";
import { summarizeExpenses } from "@/lib/expenses/summary";
import type { Expense } from "@/lib/expenses/types";
import { aTab, anExpense } from "@/test/builders";
import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { getExpenseTabExpensesForUser, updateExpenseForUser } from "./expenses";

/** The stored `expenses` row for an expense, owned by `owner`. */
function anExpenseRow(overrides: Partial<Expense> = {}, owner = "owner") {
  const expense = anExpense(overrides);
  return {
    id: expense.id,
    user_id: owner,
    description: expense.description,
    amount: expense.amount.toFixed(2),
    category: expense.category,
    subtype: expense.subtype,
    expense_date: expense.expenseDate,
    notes: expense.notes,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function useDatabase(rows: ReturnType<typeof anExpenseRow>[], options?: FakeSupabaseOptions) {
  const database = fakeSupabase({ expenses: rows }, options);
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

beforeEach(() => vi.resetAllMocks());

describe("updateExpenseForUser", () => {
  const fuel = () => anExpenseRow({ id: "fuel", description: "Fuel", amount: 10.5, category: "car", subtype: "car_fuel", expenseDate: "2026-09-01", notes: "Full tank" });
  const foreign = () => ({ ...fuel(), id: "foreign", user_id: "other" });

  it("merges the patch into the stored expense and returns the result", async () => {
    const { tables } = useDatabase([fuel()]);

    const expense = await updateExpenseForUser("owner", "fuel", { amount: "12", notes: null });

    expect(expense).toEqual({ id: "fuel", description: "Fuel", amount: 12, category: "car", subtype: "car_fuel", expenseDate: "2026-09-01", notes: null });
    expect(tables.expenses[0]).toMatchObject({ amount: 12, notes: null, description: "Fuel" });
  });

  it("scopes both the load and the write to the owner", async () => {
    const { queries } = useDatabase([fuel()]);

    await updateExpenseForUser("owner", "fuel", { amount: "12" });

    expect(queries.map((query) => [query.operation, query.filters])).toEqual([
      ["select", [["eq", "id", "fuel"], ["eq", "user_id", "owner"]]],
      ["update", [["eq", "id", "fuel"], ["eq", "user_id", "owner"]]],
    ]);
  });

  it("rejects an explicit subtype that does not belong to the category without writing", async () => {
    const { queries } = useDatabase([fuel()]);

    const error = await updateExpenseForUser("owner", "fuel", { category: "groceries", subtype: "car_fuel" }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).flatten().fieldErrors).toHaveProperty("subtype");
    expect(queries.map((query) => query.operation)).toEqual(["select"]);
  });

  it("resets a stored subtype that no longer fits a changed category", async () => {
    useDatabase([fuel()]);

    const expense = await updateExpenseForUser("owner", "fuel", { category: "groceries" });

    expect(expense).toMatchObject({ category: "groceries", subtype: null });
  });

  it("keeps a stored subtype that still fits the patched category", async () => {
    useDatabase([fuel()]);

    const expense = await updateExpenseForUser("owner", "fuel", { category: "car" });

    expect(expense).toMatchObject({ category: "car", subtype: "car_fuel" });
  });

  it.each(["foreign", "missing"])("returns null for a %s expense without writing", async (id) => {
    const { queries, tables } = useDatabase([fuel(), foreign()]);

    const expense = await updateExpenseForUser("owner", id, { amount: 1 });

    expect(expense).toBeNull();
    expect(queries.map((query) => query.operation)).toEqual(["select"]);
    expect(tables.expenses).toEqual([fuel(), foreign()]);
  });

  it("returns the classification the database stored, not the one requested", async () => {
    useDatabase([fuel()], { trigger: (row) => ({ ...row, category: "car", subtype: "car_fuel" }) });

    const expense = await updateExpenseForUser("owner", "fuel", { category: "transport", subtype: null });

    expect(expense).toMatchObject({ category: "car", subtype: "car_fuel" });
  });
});

describe("getExpenseTabExpensesForUser", () => {
  const car = (id: string, subtype: Expense["subtype"], expenseDate: string, extra: Partial<Expense> = {}) =>
    anExpenseRow({ id, description: `Expense ${id}`, category: "car", subtype, expenseDate, ...extra });
  const fixtures = () => [
    car("a", null, "2024-12-31"),
    car("b", "car_fuel", "2025-01-01"),
    car("c", "car_maintenance", "2025-12-31", { notes: "Garage service" }),
    car("d", "car_repairs", "2026-01-01"),
    car("e", null, "2026-01-01"),
    car("outside", null, "2025-01-01", { category: "transport" }),
    anExpenseRow({ id: "other-owner", category: "car", subtype: "car_fuel", expenseDate: "2025-01-01" }, "other"),
  ];
  const tab = aTab({ categoryKeys: ["car"], subtypeKeys: [] });
  const fuelOnly = aTab({ categoryKeys: [], subtypeKeys: ["car_fuel"] });
  const ids = (expenses: Expense[]) => expenses.map((expense) => expense.id);
  const filters = (overrides: Partial<ExpenseTabFilters>) => ({ ...DEFAULT_EXPENSE_TAB_FILTERS, ...overrides }) as ExpenseTabFilters;

  it("returns a category's expenses with and without a subtype, newest first", async () => {
    useDatabase(fixtures());

    const expenses = await getExpenseTabExpensesForUser("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);

    expect(ids(expenses)).toEqual(["e", "d", "c", "b", "a"]);
  });

  it("converts stored amount strings to numbers", async () => {
    useDatabase([car("a", null, "2026-01-01", { amount: 1.1 }), car("b", null, "2026-01-01", { amount: 12.07 })]);

    const expenses = await getExpenseTabExpensesForUser("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);

    expect(expenses.map((expense) => expense.amount)).toEqual([12.07, 1.1]);
  });

  it("reads only the caller's expenses, ordered by date, creation time and id", async () => {
    const { queries } = useDatabase(fixtures());

    await getExpenseTabExpensesForUser("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);

    expect(queries[0].filters).toContainEqual(["eq", "user_id", "owner"]);
    expect(queries[0].orders).toEqual(["expense_date", "created_at", "id"]);
  });

  it("excludes sibling subtypes and subtype-free expenses from a subtype-only tab", async () => {
    useDatabase(fixtures());

    const expenses = await getExpenseTabExpensesForUser("owner", fuelOnly, DEFAULT_EXPENSE_TAB_FILTERS);

    expect(ids(expenses)).toEqual(["b"]);
  });

  it("returns an expense matching both a category and a subtype of the tab once", async () => {
    const { queries } = useDatabase(fixtures());

    const expenses = await getExpenseTabExpensesForUser("owner", aTab({ categoryKeys: ["car"], subtypeKeys: ["car_fuel"] }), DEFAULT_EXPENSE_TAB_FILTERS);

    expect(ids(expenses)).toEqual(["e", "d", "c", "b", "a"]);
    expect(queries[0].filters).toContainEqual(["or", "", "category.in.(car),subtype.in.(car_fuel)"]);
  });

  it("includes the first and last day of a year and excludes adjacent years", async () => {
    useDatabase(fixtures());

    const expenses = await getExpenseTabExpensesForUser("owner", tab, filters({ scope: "year", year: 2025 }));

    expect(ids(expenses)).toEqual(["c", "b"]);
  });

  it("includes both ends of a date range", async () => {
    useDatabase(fixtures());

    const expenses = await getExpenseTabExpensesForUser("owner", tab, filters({ scope: "range", startDate: "2024-12-31", endDate: "2025-01-01" }));

    expect(ids(expenses)).toEqual(["b", "a"]);
  });

  it.each([
    { narrowing: "no subtype", selection: tab, applied: { subtype: "none" }, expected: ["e", "a"] },
    { narrowing: "a subtype and a case-insensitive search", selection: tab, applied: { subtype: "car_fuel", search: "FUEL" }, expected: ["b"] },
    { narrowing: "a search matching notes", selection: tab, applied: { search: "garage" }, expected: ["c"] },
    { narrowing: "a category outside the tab", selection: tab, applied: { category: "transport" }, expected: [] },
    { narrowing: "no subtype on a subtype-only tab", selection: fuelOnly, applied: { subtype: "none" }, expected: [] },
  ] as const)("narrows the tab's expenses by $narrowing", async ({ selection, applied, expected }) => {
    useDatabase(fixtures());

    const expenses = await getExpenseTabExpensesForUser("owner", selection, filters(applied));

    expect(ids(expenses)).toEqual(expected);
  });

  describe("with more history than one page", () => {
    const history = () => Array.from({ length: 1207 }, (_, index) =>
      car(String(index).padStart(4, "0"), "car_fuel", "2025-01-01", { amount: 0.01 }));

    it("reads every page even when the server caps pages below the page size", async () => {
      const { queries } = useDatabase(history(), { pageCap: 113 });

      const expenses = await getExpenseTabExpensesForUser("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);

      expect(new Set(ids(expenses)).size).toBe(1207);
      expect(queries).toHaveLength(11);
      expect(queries[1].range).toEqual([113, 612]);
    });

    it("searches after retrieving every page", async () => {
      const rows = history();
      rows[0].description = "Rare last-page match";
      useDatabase(rows, { pageCap: 113 });

      const expenses = await getExpenseTabExpensesForUser("owner", tab, filters({ search: "rare" }));

      expect(ids(expenses)).toEqual(["0000"]);
    });
  });

  it("fails the whole read when a later page errors", async () => {
    useDatabase(fixtures(), { pageCap: 2, fail: (_query, index) => index === 1 });

    const read = getExpenseTabExpensesForUser("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);

    await expect(read).rejects.toThrow("Unable to load expenses.");
  });

  it("returns nothing, without querying, for a tab with no categories or subtypes", async () => {
    const { queries } = useDatabase(fixtures());

    const expenses = await getExpenseTabExpensesForUser("owner", aTab({ categoryKeys: [], subtypeKeys: [] }), DEFAULT_EXPENSE_TAB_FILTERS);

    expect(expenses).toEqual([]);
    expect(queries).toEqual([]);
  });
});

describe("summarizeExpenses", () => {
  it.each([
    { expenses: [], summary: { total: 0, count: 0, average: 0 } },
    { expenses: [{ amount: 10 }, { amount: 5 }], summary: { total: 15, count: 2, average: 7.5 } },
  ])("summarizes $expenses.length expenses without dividing by zero", ({ expenses, summary }) => {
    expect(summarizeExpenses(expenses)).toEqual(summary);
  });
});
