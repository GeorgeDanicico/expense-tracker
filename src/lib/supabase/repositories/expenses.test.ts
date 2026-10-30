import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EXPENSE_TAB_FILTERS, type ExpenseTabFilters } from "@/lib/expenses/filters";
import type { Expense } from "@/lib/expenses/types";
import { aTab, anExpense } from "@/test/builders";
import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { supabaseExpenseRepository as repository } from "@/lib/supabase/repositories/expenses";

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

const dashboardRanges = {
  current: { start: "2026-10-01", endExclusive: "2026-11-01" },
  analytics: { start: "2026-07-01", endExclusive: "2026-10-01" },
};

beforeEach(() => vi.resetAllMocks());

describe("update", () => {
  const fuel = () => anExpenseRow({ id: "fuel", description: "Fuel", amount: 10.5, category: "car", subtype: "car_fuel", expenseDate: "2026-09-01", notes: "Full tank" });
  const foreign = () => ({ ...fuel(), id: "foreign", user_id: "other" });

  it("merges the patch into the stored expense and returns the result", async () => {
    const { tables } = useDatabase([fuel()]);

    const expense = await repository.update("owner", "fuel", { amount: "12", notes: null });

    expect(expense).toEqual({ id: "fuel", description: "Fuel", amount: 12, category: "car", subtype: "car_fuel", expenseDate: "2026-09-01", notes: null });
    expect(tables.expenses[0]).toMatchObject({ amount: 12, notes: null, description: "Fuel" });
  });

  it("scopes both the load and the write to the owner", async () => {
    const { queries } = useDatabase([fuel()]);

    await repository.update("owner", "fuel", { amount: "12" });

    expect(queries.map((query) => [query.operation, query.filters])).toEqual([
      ["select", [["eq", "id", "fuel"], ["eq", "user_id", "owner"]]],
      ["update", [["eq", "id", "fuel"], ["eq", "user_id", "owner"]]],
    ]);
  });

  it("rejects an explicit subtype that does not belong to the category without writing", async () => {
    const { queries } = useDatabase([fuel()]);

    const error = await repository.update("owner", "fuel", { category: "groceries", subtype: "car_fuel" }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).flatten().fieldErrors).toHaveProperty("subtype");
    expect(queries.map((query) => query.operation)).toEqual(["select"]);
  });

  it("resets a stored subtype that no longer fits a changed category", async () => {
    useDatabase([fuel()]);

    const expense = await repository.update("owner", "fuel", { category: "groceries" });

    expect(expense).toMatchObject({ category: "groceries", subtype: null });
  });

  it("keeps a stored subtype that still fits the patched category", async () => {
    useDatabase([fuel()]);

    const expense = await repository.update("owner", "fuel", { category: "car" });

    expect(expense).toMatchObject({ category: "car", subtype: "car_fuel" });
  });

  it.each(["foreign", "missing"])("returns null for a %s expense without writing", async (id) => {
    const { queries, tables } = useDatabase([fuel(), foreign()]);

    const expense = await repository.update("owner", id, { amount: 1 });

    expect(expense).toBeNull();
    expect(queries.map((query) => query.operation)).toEqual(["select"]);
    expect(tables.expenses).toEqual([fuel(), foreign()]);
  });

  it("returns the classification the database stored, not the one requested", async () => {
    useDatabase([fuel()], { trigger: (row) => ({ ...row, category: "car", subtype: "car_fuel" }) });

    const expense = await repository.update("owner", "fuel", { category: "transport", subtype: null });

    expect(expense).toMatchObject({ category: "car", subtype: "car_fuel" });
  });
});

describe("listForTab", () => {
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

    const expenses = await repository.listForTab("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);

    expect(ids(expenses)).toEqual(["e", "d", "c", "b", "a"]);
  });

  it("converts stored amount strings to numbers", async () => {
    useDatabase([car("a", null, "2026-01-01", { amount: 1.1 }), car("b", null, "2026-01-01", { amount: 12.07 })]);

    const expenses = await repository.listForTab("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);

    expect(expenses.map((expense) => expense.amount)).toEqual([12.07, 1.1]);
  });

  it("reads only the caller's expenses, ordered by date, creation time and id", async () => {
    const { queries } = useDatabase(fixtures());

    await repository.listForTab("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);

    expect(queries[0].filters).toContainEqual(["eq", "user_id", "owner"]);
    expect(queries[0].orders).toEqual(["expense_date", "created_at", "id"]);
  });

  it("excludes sibling subtypes and subtype-free expenses from a subtype-only tab", async () => {
    useDatabase(fixtures());

    const expenses = await repository.listForTab("owner", fuelOnly, DEFAULT_EXPENSE_TAB_FILTERS);

    expect(ids(expenses)).toEqual(["b"]);
  });

  it("returns an expense matching both a category and a subtype of the tab once", async () => {
    const { queries } = useDatabase(fixtures());

    const expenses = await repository.listForTab("owner", aTab({ categoryKeys: ["car"], subtypeKeys: ["car_fuel"] }), DEFAULT_EXPENSE_TAB_FILTERS);

    expect(ids(expenses)).toEqual(["e", "d", "c", "b", "a"]);
    expect(queries[0].filters).toContainEqual(["or", "", "category.in.(car),subtype.in.(car_fuel)"]);
  });

  it("includes the first and last day of a year and excludes adjacent years", async () => {
    useDatabase(fixtures());

    const expenses = await repository.listForTab("owner", tab, filters({ scope: "year", year: 2025 }));

    expect(ids(expenses)).toEqual(["c", "b"]);
  });

  it("includes both ends of a date range", async () => {
    useDatabase(fixtures());

    const expenses = await repository.listForTab("owner", tab, filters({ scope: "range", startDate: "2024-12-31", endDate: "2025-01-01" }));

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

    const expenses = await repository.listForTab("owner", selection, filters(applied));

    expect(ids(expenses)).toEqual(expected);
  });

  describe("with more history than one page", () => {
    const history = () => Array.from({ length: 1207 }, (_, index) =>
      car(String(index).padStart(4, "0"), "car_fuel", "2025-01-01", { amount: 0.01 }));

    it("reads every page even when the server caps pages below the page size", async () => {
      const { queries } = useDatabase(history(), { pageCap: 113 });

      const expenses = await repository.listForTab("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);

      expect(new Set(ids(expenses)).size).toBe(1207);
      expect(queries).toHaveLength(11);
      expect(queries[1].range).toEqual([113, 612]);
    });

    it("searches after retrieving every page", async () => {
      const rows = history();
      rows[0].description = "Rare last-page match";
      useDatabase(rows, { pageCap: 113 });

      const expenses = await repository.listForTab("owner", tab, filters({ search: "rare" }));

      expect(ids(expenses)).toEqual(["0000"]);
    });
  });

  it("fails the whole read when a later page errors", async () => {
    useDatabase(fixtures(), { pageCap: 2, fail: (_query, index) => index === 1 });

    const read = repository.listForTab("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);

    await expect(read).rejects.toThrow("Unable to load expenses.");
  });

  it("returns nothing, without querying, for a tab with no categories or subtypes", async () => {
    const { queries } = useDatabase(fixtures());

    const expenses = await repository.listForTab("owner", aTab({ categoryKeys: [], subtypeKeys: [] }), DEFAULT_EXPENSE_TAB_FILTERS);

    expect(expenses).toEqual([]);
    expect(queries).toEqual([]);
  });
});

describe("listMonth", () => {
  it("returns the owner's expenses dated in the month, newest first", async () => {
    const { queries } = useDatabase([
      anExpenseRow({ id: "august", expenseDate: "2026-08-31" }),
      anExpenseRow({ id: "first", expenseDate: "2026-09-01" }),
      anExpenseRow({ id: "last", expenseDate: "2026-09-30" }),
      anExpenseRow({ id: "october", expenseDate: "2026-10-01" }),
      anExpenseRow({ id: "foreign", expenseDate: "2026-09-15" }, "other"),
    ]);

    const expenses = await repository.listMonth("owner", "2026-09");

    expect(expenses.map((expense) => expense.id)).toEqual(["last", "first"]);
    expect(queries[0].filters).toEqual([
      ["eq", "user_id", "owner"], ["gte", "expense_date", "2026-09-01"], ["lt", "expense_date", "2026-10-01"],
    ]);
    expect(queries[0].orders).toEqual(["expense_date", "created_at", "id"]);
  });

  it("fails with the load message", async () => {
    useDatabase([], { fail: () => true });

    await expect(repository.listMonth("owner", "2026-09")).rejects.toThrow(new Error("Unable to load expenses."));
  });
});

describe("listRange", () => {
  it("returns the owner's expenses from the start date up to, not including, the end, newest first", async () => {
    const { queries } = useDatabase([
      anExpenseRow({ id: "before", expenseDate: "2026-09-30" }),
      anExpenseRow({ id: "first", expenseDate: "2026-10-01" }),
      anExpenseRow({ id: "last", expenseDate: "2026-10-15" }),
      anExpenseRow({ id: "end", expenseDate: "2026-10-16" }),
      anExpenseRow({ id: "foreign", expenseDate: "2026-10-10" }, "other"),
    ]);

    const expenses = await repository.listRange("owner", { start: "2026-10-01", endExclusive: "2026-10-16" });

    expect(expenses.map((expense) => expense.id)).toEqual(["last", "first"]);
    expect(queries[0].filters).toEqual([
      ["eq", "user_id", "owner"], ["gte", "expense_date", "2026-10-01"], ["lt", "expense_date", "2026-10-16"],
    ]);
  });

  it("fails with the load message", async () => {
    useDatabase([], { fail: () => true });

    await expect(repository.listRange("owner", { start: "2026-10-01", endExclusive: "2026-10-16" }))
      .rejects.toThrow(new Error("Unable to load expenses."));
  });
});

describe("recentCategoriesByMerchant", () => {
  it("returns the owner's categorised expenses since the date, newest first, without those left in Other", async () => {
    const { queries } = useDatabase([
      anExpenseRow({ id: "old", description: "Lidl", category: "groceries", expenseDate: "2025-10-29" }),
      anExpenseRow({ id: "first", description: "Lidl", category: "groceries", expenseDate: "2025-10-30" }),
      anExpenseRow({ id: "fuel", description: "Station", category: "car", subtype: "car_fuel", expenseDate: "2026-09-02" }),
      anExpenseRow({ id: "uncategorised", description: "Cafe", category: "other", expenseDate: "2026-09-05" }),
      anExpenseRow({ id: "foreign", description: "Zara", category: "shopping", expenseDate: "2026-09-05" }, "other"),
    ]);

    const history = await repository.recentCategoriesByMerchant("owner", "2025-10-30");

    expect(history).toEqual([
      { description: "Station", category: "car", subtype: "car_fuel", expenseDate: "2026-09-02" },
      { description: "Lidl", category: "groceries", subtype: null, expenseDate: "2025-10-30" },
    ]);
    expect(queries[0].filters).toEqual([
      ["eq", "user_id", "owner"], ["gte", "expense_date", "2025-10-30"], ["neq", "category", "other"],
    ]);
  });

  it("fails with the load message", async () => {
    useDatabase([], { fail: () => true });

    await expect(repository.recentCategoriesByMerchant("owner", "2025-10-30")).rejects.toThrow(new Error("Unable to load expenses."));
  });
});

describe("getDashboard", () => {
  const summary = {
    currentTotal: "12.50", currentCount: 1, currentLargest: "12.50", analyticsTotal: "40.00", analyticsCount: 2,
    categoryTotals: [{ category: "car", total: "40.00" }], monthlyTotals: [{ key: "2026-09", total: "40.00" }],
  };

  it("reads the owner's five newest current expenses and the dashboard summary", async () => {
    const { queries, rpcs } = useDatabase(
      [anExpenseRow({ id: "october", amount: 12.5, expenseDate: "2026-10-04" }), anExpenseRow({ id: "foreign", expenseDate: "2026-10-04" }, "other")],
      { rpc: () => ({ data: summary, error: null }) },
    );

    const dashboard = await repository.getDashboard("owner", dashboardRanges);

    expect(dashboard).toEqual({ currentExpenses: [expect.objectContaining({ id: "october", amount: 12.5 })], summary });
    expect(queries[0]).toMatchObject({
      filters: [["eq", "user_id", "owner"], ["gte", "expense_date", "2026-10-01"], ["lt", "expense_date", "2026-11-01"]],
      orders: ["expense_date", "created_at"],
      limits: ["5"],
    });
    expect(rpcs).toEqual([{ fn: "get_expense_dashboard", args: {
      p_current_start: "2026-10-01", p_current_end_exclusive: "2026-11-01",
      p_analytics_start: "2026-07-01", p_analytics_end_exclusive: "2026-10-01",
      p_user_id: "owner",
    } }]);
  });

  it.each([
    ["the recent expenses", { fail: () => true, rpc: () => ({ data: summary, error: null }) }],
    ["the summary", { rpc: () => ({ data: null, error: { message: "private" } }) }],
  ] as const)("fails with the dashboard message when %s cannot load", async (_part, options) => {
    useDatabase([], options);

    await expect(repository.getDashboard("owner", dashboardRanges)).rejects.toThrow(new Error("Unable to load dashboard data."));
  });
});

describe("create", () => {
  const input = { description: "Fuel", amount: 10.5, category: "car", subtype: "car_fuel", expenseDate: "2026-09-01", notes: "" } as const;

  it("takes the owner from the caller and stores empty notes as null", async () => {
    const { queries, tables } = useDatabase([]);

    const created = await repository.create("owner", input);

    expect(created).toMatchObject({ description: "Fuel", amount: 10.5, category: "car", subtype: "car_fuel", expenseDate: "2026-09-01", notes: null });
    expect(queries[0]).toMatchObject({ operation: "insert", values: { user_id: "owner" } });
    expect(tables.expenses).toEqual([expect.objectContaining({ user_id: "owner", expense_date: "2026-09-01", notes: null })]);
  });

  it("fails with the save message", async () => {
    useDatabase([], { fail: () => true });

    await expect(repository.create("owner", input)).rejects.toThrow(new Error("The expense could not be saved."));
  });
});

describe("delete", () => {
  it("deletes only the owner's addressed expense", async () => {
    const owned = anExpenseRow({ id: "owned" });
    const foreign = anExpenseRow({ id: "foreign" }, "other");
    const { queries, tables } = useDatabase([owned, foreign]);

    expect(await repository.delete("owner", "owned")).toBe(true);
    expect(queries[0].filters).toEqual([["eq", "id", "owned"], ["eq", "user_id", "owner"]]);
    expect(tables.expenses).toEqual([foreign]);
  });

  it("reports another user's expense as missing", async () => {
    useDatabase([anExpenseRow({ id: "foreign" }, "other")]);

    expect(await repository.delete("owner", "foreign")).toBe(false);
  });

  it("fails with the delete message", async () => {
    useDatabase([], { fail: () => true });

    await expect(repository.delete("owner", "owned")).rejects.toThrow(new Error("Unable to delete expense."));
  });
});

describe("update errors", () => {
  it("fails a failed load with the load message", async () => {
    useDatabase([], { fail: () => true });

    await expect(repository.update("owner", "owned", { amount: 2 })).rejects.toThrow(new Error("Unable to load expense."));
  });

  it("fails a failed write with the save message", async () => {
    useDatabase([anExpenseRow({ id: "owned" })], { fail: (_query, index) => index === 1 });

    await expect(repository.update("owner", "owned", { amount: 2 })).rejects.toThrow(new Error("The expense could not be saved."));
  });
});

describe("owner filters", () => {
  it.each([
    ["listMonth", () => repository.listMonth("owner", "2026-09")],
    ["listRange", () => repository.listRange("owner", { start: "2026-09-01", endExclusive: "2026-10-01" })],
    ["recentCategoriesByMerchant", () => repository.recentCategoriesByMerchant("owner", "2025-09-01")],
    ["listForTab", () => repository.listForTab("owner", aTab(), DEFAULT_EXPENSE_TAB_FILTERS)],
    ["getDashboard", () => repository.getDashboard("owner", dashboardRanges)],
    ["update", () => repository.update("owner", "owned", { amount: 2 })],
    ["delete", () => repository.delete("owner", "owned")],
  ] as const)("%s filters every table query by owner explicitly", async (_name, call) => {
    const { queries } = useDatabase([anExpenseRow({ id: "owned", category: "car", expenseDate: "2026-09-01" })], { rpc: () => ({ data: {}, error: null }) });

    await call();

    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) expect(query.filters).toContainEqual(["eq", "user_id", "owner"]);
  });

  it("create writes the caller as the owner", async () => {
    const { queries } = useDatabase([]);

    await repository.create("owner", { description: "Fuel", amount: 1, category: "car", subtype: null, expenseDate: "2026-09-01" });

    expect(queries[0].values).toMatchObject({ user_id: "owner" });
  });
});
