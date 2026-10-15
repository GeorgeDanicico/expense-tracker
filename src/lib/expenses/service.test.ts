import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EXPENSE_TAB_FILTERS } from "@/lib/expenses/filters";
import { aTab, anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { getDashboardData, getExpenseTabLedger, getMonthlyLedger } from "./service";

const expense = (id: string, amount: number, overrides = {}) =>
  anExpense({ id, amount, expenseDate: "2026-09-10", ...overrides });
const tab = aTab({ id: "tab", categoryKeys: ["groceries"] });

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
});
afterEach(() => vi.useRealTimers());

describe("getMonthlyLedger", () => {
  it("returns the month's expenses with total, count and average in that key order", async () => {
    const expenses = [expense("a", 10), expense("b", 5)];
    repositories.expenses.expenses.set("owner", expenses.toReversed());
    const listMonth = vi.spyOn(repositories.expenses, "listMonth");

    const ledger = await getMonthlyLedger("owner", "2026-09");

    expect(listMonth).toHaveBeenCalledWith("owner", "2026-09");
    expect(Object.keys(ledger)).toEqual(["month", "expenses", "total", "count", "average"]);
    expect(ledger).toEqual({ month: "2026-09", expenses, total: 15, count: 2, average: 7.5 });
  });

  it("reports a zero average for an empty month", async () => {
    repositories.expenses.expenses.set("owner", [expense("august", 3, { expenseDate: "2026-08-31" })]);

    expect(await getMonthlyLedger("owner", "2026-09")).toEqual({ month: "2026-09", expenses: [], total: 0, count: 0, average: 0 });
  });
});

describe("getExpenseTabLedger", () => {
  it("returns the tab's expenses with the applied filters and summary in that key order", async () => {
    const expenses = [expense("a", 3), expense("b", 1)];
    repositories.expenseTabs.tabs.set("owner", [tab]);
    repositories.expenses.expenses.set("owner", [...expenses.toReversed(), expense("car", 9, { category: "car" })]);
    const getTab = vi.spyOn(repositories.expenseTabs, "get");
    const listForTab = vi.spyOn(repositories.expenses, "listForTab");

    const ledger = await getExpenseTabLedger("owner", "tab", DEFAULT_EXPENSE_TAB_FILTERS);

    expect(getTab).toHaveBeenCalledWith("owner", "tab");
    expect(listForTab).toHaveBeenCalledWith("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);
    expect(Object.keys(ledger ?? {})).toEqual(["tab", "filters", "expenses", "total", "count", "average"]);
    expect(ledger).toEqual({ tab, filters: DEFAULT_EXPENSE_TAB_FILTERS, expenses, total: 4, count: 2, average: 2 });
  });

  it("returns null without querying expenses when the user owns no such tab", async () => {
    repositories.expenseTabs.tabs.set("someone-else", [aTab({ id: "missing" })]);
    const listForTab = vi.spyOn(repositories.expenses, "listForTab");

    expect(await getExpenseTabLedger("owner", "missing", DEFAULT_EXPENSE_TAB_FILTERS)).toBeNull();
    expect(listForTab).not.toHaveBeenCalled();
  });
});

describe("getDashboardData", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
  });

  it("reads the current Bucharest month and the analytics range for the filters", async () => {
    const getDashboard = vi.spyOn(repositories.expenses, "getDashboard");

    await getDashboardData("owner", { period: "3m", granularity: "month", customDate: "" });

    expect(getDashboard).toHaveBeenCalledWith("owner", {
      current: expect.objectContaining({ start: "2026-10-01", endExclusive: "2026-11-01" }),
      analytics: expect.objectContaining({ start: "2026-07-01", endExclusive: "2026-10-01" }),
    });
  });

  it("turns the stored summary into the dashboard, accepting numeric strings", async () => {
    const recent = [anExpense({ id: "recent", amount: 12.5, expenseDate: "2026-10-04" })];
    vi.spyOn(repositories.expenses, "getDashboard").mockResolvedValue({
      currentExpenses: recent,
      summary: {
        currentTotal: "30.00", currentCount: 3, currentLargest: "12.50", analyticsTotal: "40", analyticsCount: 2,
        categoryTotals: [{ category: "car", total: "40" }], monthlyTotals: [{ key: "2026-09", total: "40" }],
      },
    });

    const dashboard = await getDashboardData("owner", { period: "3m", granularity: "month", customDate: "" });

    expect(dashboard).toMatchObject({
      currentMonth: "2026-10", currentExpenses: recent, currentTotal: 30, currentCount: 3, currentAverage: 10, currentLargest: 12.5,
      analytics: { label: "Previous 3 months", total: 40, categoryTotals: [{ category: "car", total: 40 }] },
    });
    expect(dashboard.analytics.series.map((point) => [point.key, point.total])).toEqual([["2026-07", 0], ["2026-08", 0], ["2026-09", 40]]);
  });

  it("reports a zero average for a month without expenses", async () => {
    const dashboard = await getDashboardData("owner", { period: "3m", granularity: "month", customDate: "" });

    expect(dashboard).toMatchObject({ currentExpenses: [], currentTotal: 0, currentCount: 0, currentAverage: 0, currentLargest: 0 });
  });
});
