import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EXPENSE_TAB_FILTERS, type ExpenseTabFilters } from "@/lib/expenses/filters";
import type { Expense } from "@/lib/expenses/types";
import { fieldErrorsOf } from "@/lib/validation/field-errors";
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
  const storedFuel = { id: "fuel", description: "Fuel", amount: "12.00", category: "car", subtype: "car_fuel", expense_date: "2026-09-01", notes: null };
  const answer = (data: unknown[]) => ({ rpc: () => ({ data, error: null }) });

  it("sends only the changed fields to update_expense and returns the stored expense", async () => {
    const { rpcs, queries } = useDatabase([], answer([storedFuel]));

    const expense = await repository.update("owner", "fuel", { amount: "12", notes: null });

    expect(rpcs).toEqual([{ fn: "update_expense", args: { p_id: "fuel", p_patch: { amount: 12, notes: null } } }]);
    expect(queries).toEqual([]);
    expect(expense).toEqual({ id: "fuel", description: "Fuel", amount: 12, category: "car", subtype: "car_fuel", expenseDate: "2026-09-01", notes: null });
  });

  it("names each changed field by its column, trimmed and with cleared notes as null", async () => {
    const { rpcs } = useDatabase([], answer([storedFuel]));

    await repository.update("owner", "fuel", { description: " Fuel ", category: "car", subtype: "car_fuel", expenseDate: "2026-09-02", notes: "  " });

    expect(rpcs[0].args.p_patch).toEqual({ description: "Fuel", category: "car", subtype: "car_fuel", expense_date: "2026-09-02", notes: null });
  });

  it("leaves a subtype the patch doesn't name to the database", async () => {
    const { rpcs } = useDatabase([], answer([{ ...storedFuel, category: "groceries", subtype: null }]));

    const expense = await repository.update("owner", "fuel", { category: "groceries" });

    expect(rpcs[0].args.p_patch).toEqual({ category: "groceries" });
    expect(expense).toMatchObject({ category: "groceries", subtype: null });
  });

  it.each([
    [{ category: "groceries", subtype: "car_fuel" }, "subtype"],
    [{ amount: "1.005" }, "amount"],
    [{ description: "  " }, "description"],
  ] as const)("rejects an invalid patch %j without calling the database", async (patch, field) => {
    const { rpcs } = useDatabase([]);

    const error = await repository.update("owner", "fuel", patch).catch((caught) => caught);

    expect(error).toBeInstanceOf(ZodError);
    expect(fieldErrorsOf(error as ZodError)).toHaveProperty(field);
    expect(rpcs).toEqual([]);
  });

  it("turns the database's refusal of a subtype outside the stored category into a subtype error", async () => {
    const message = "Choose a subtype belonging to the selected category.";
    useDatabase([], { rpc: () => ({ data: null, error: { code: "23514", message, hint: "user" } }) });

    await expect(repository.update("owner", "rent", { subtype: "car_fuel" })).rejects.toMatchObject({
      name: "DomainError", message, status: 422, fieldErrors: { subtype: [message] },
    });
  });

  it("returns null when the user has no such expense", async () => {
    useDatabase([], answer([]));

    expect(await repository.update("owner", "missing", { amount: 1 })).toBeNull();
  });

  it("hides a database error behind a generic message", async () => {
    useDatabase([], { rpc: () => ({ data: null, error: { code: "23514", message: "violates check constraint \"expenses_amount_valid\"" } }) });

    await expect(repository.update("owner", "fuel", { amount: 1 })).rejects.toMatchObject({
      message: "The expense could not be saved.", status: 422, fieldErrors: undefined,
    });
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

  it.each([
    ["a comma", "car,user_id.neq.owner"],
    ["a closing parenthesis", "car)"],
    ["a dot", "car.id"],
    ["an operator clause", "car),id.not.is.null,category.in.(car"],
    ["an unknown but well-formed key", "pets"],
    ["an empty key", ""],
  ])("refuses a tab category key with %s before any query runs", async (_label, key) => {
    const { queries } = useDatabase(fixtures());
    const bad = aTab({ categoryKeys: [key as never], subtypeKeys: [] });

    await expect(repository.listForTab("owner", bad, DEFAULT_EXPENSE_TAB_FILTERS)).rejects.toThrow("Unknown expense category key");

    expect(queries).toEqual([]);
  });

  it.each(["car_fuel,id.not.is.null", "car_fuel)", "car.fuel", "car"])("refuses a tab subtype key %j before any query runs", async (key) => {
    const { queries } = useDatabase(fixtures());
    const bad = aTab({ categoryKeys: [], subtypeKeys: [key as never] });

    await expect(repository.listForTab("owner", bad, DEFAULT_EXPENSE_TAB_FILTERS)).rejects.toThrow("Unknown expense subtype key");

    expect(queries).toEqual([]);
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
      expect(queries[1].range).toEqual([113, 1112]);
    });

    it("searches after retrieving every page", async () => {
      const rows = history();
      rows[0].description = "Rare last-page match";
      useDatabase(rows, { pageCap: 113 });

      const expenses = await repository.listForTab("owner", tab, filters({ search: "rare" }));

      expect(ids(expenses)).toEqual(["0000"]);
    });

    it("searches in the database, so only the matches are read (P9)", async () => {
      const rows = history();
      rows[0].description = "Rare last-page match";
      const { queries } = useDatabase(rows, { pageCap: 113 });

      await repository.listForTab("owner", tab, filters({ search: "RARE" }));

      expect(queries).toHaveLength(1);
      expect(queries[0].filters).toContainEqual(["or", "", 'description.ilike."%rare%",notes.ilike."%rare%"']);
    });
  });

  describe("the search, on the server (P9)", () => {
    const awkward = ["100% cotton", "100 percent", "a_b", "axb", "back\\slash", "star*shop", "starXshop", "comma, (x)", 'quote "q"', "Ștefan"];
    const rows = () => awkward.map((description, index) => car(`r${index}`, null, "2026-01-01", { description }));

    it.each([
      ["%", ["100% cotton"]],
      ["_", ["a_b"]],
      ["\\", ["back\\slash"]],
      ["*", ["star*shop"]],
      ["r*s", ["star*shop"]],
      [", (x)", ["comma, (x)"]],
      ['"q"', ['quote "q"']],
      ["ștefan", ["Ștefan"]],
      ["100", ["100% cotton", "100 percent"]],
    ])("matches %j literally", async (search, expected) => {
      useDatabase(rows());

      const expenses = await repository.listForTab("owner", tab, filters({ search }));

      expect(expenses.map((expense) => expense.description).sort()).toEqual([...expected].sort());
    });

    it("finds expenses by their category or subtype label, as before", async () => {
      useDatabase(fixtures());

      expect(ids(await repository.listForTab("owner", tab, filters({ search: "car repairs" })))).toEqual(["d"]);
      expect(ids(await repository.listForTab("owner", tab, filters({ search: "no sub" })))).toEqual(["e", "a"]);
      expect(ids(await repository.listForTab("owner", tab, filters({ search: "Car" })))).toEqual(["e", "d", "c", "b", "a"]);
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

describe("recentDescriptions", () => {
  it("returns the owner's newest descriptions with their classification, up to the limit", async () => {
    const { queries } = useDatabase([
      anExpenseRow({ id: "old", description: "Lidl", category: "groceries", expenseDate: "2026-08-01" }),
      anExpenseRow({ id: "fuel", description: "Station", category: "car", subtype: "car_fuel", expenseDate: "2026-09-02" }),
      anExpenseRow({ id: "cafe", description: "Cafe", category: "other", expenseDate: "2026-09-05" }),
      anExpenseRow({ id: "foreign", description: "Zara", category: "shopping", expenseDate: "2026-09-06" }, "other"),
    ]);

    const rows = await repository.recentDescriptions("owner", 2);

    expect(rows).toEqual([
      { description: "Cafe", category: "other", subtype: null },
      { description: "Station", category: "car", subtype: "car_fuel" },
    ]);
    expect(queries[0]).toMatchObject({ filters: [["eq", "user_id", "owner"]], orders: ["expense_date", "created_at", "id"], limits: ["2"] });
  });

  it("fails with the load message", async () => {
    useDatabase([], { fail: () => true });

    await expect(repository.recentDescriptions("owner", 10)).rejects.toThrow(new Error("Unable to load expenses."));
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

describe("owner filters", () => {
  it.each([
    ["listMonth", () => repository.listMonth("owner", "2026-09")],
    ["listRange", () => repository.listRange("owner", { start: "2026-09-01", endExclusive: "2026-10-01" })],
    ["recentCategoriesByMerchant", () => repository.recentCategoriesByMerchant("owner", "2025-09-01")],
    ["listForTab", () => repository.listForTab("owner", aTab(), DEFAULT_EXPENSE_TAB_FILTERS)],
    ["getDashboard", () => repository.getDashboard("owner", dashboardRanges)],
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
