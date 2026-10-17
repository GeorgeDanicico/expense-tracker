import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EXPENSE_TAB_FILTERS } from "@/lib/expenses/filters";
import { aTab, anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { getDashboardData, getExpenseTabLedger, getFamilyDashboardData, getFamilyMonthlyLedger, getMonthlyLedger } from "./service";

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

describe("the family view", () => {
  const viewers = [
    { userId: "mara", memberId: "m1", name: "Mara", currency: "RON" },
    { userId: "dan", memberId: "m2", name: "Dan", currency: "RON" },
    { userId: "ana", memberId: "m3", name: "Ana", currency: "EUR" },
  ];

  beforeEach(() => {
    repositories.expenses.expenses.set("mara", [expense("a", 100, { expenseDate: "2026-09-02" }), expense("b", 40)]);
    repositories.expenses.expenses.set("dan", [expense("c", 60, { expenseDate: "2026-09-20" })]);
    repositories.expenses.expenses.set("ana", [expense("d", 85)]);
    repositories.expenses.expenses.set("outsider", [expense("e", 999)]);
  });

  describe("getFamilyMonthlyLedger", () => {
    it("reads each member on their own, never anyone else", async () => {
      const listMonth = vi.spyOn(repositories.expenses, "listMonth");

      await getFamilyMonthlyLedger(viewers, "2026-09");

      expect(listMonth.mock.calls).toEqual([["mara", "2026-09"], ["dan", "2026-09"], ["ana", "2026-09"]]);
    });

    it("combines every member's rows newest first, each labelled with the member and their currency", async () => {
      const { expenses } = await getFamilyMonthlyLedger(viewers, "2026-09");

      expect(expenses.map(({ id, memberName, currency }) => [id, memberName, currency])).toEqual([
        ["c", "Dan", "RON"],
        ["d", "Ana", "EUR"],
        ["b", "Mara", "RON"],
        ["a", "Mara", "RON"],
      ]);
    });

    it("groups the totals by currency without converting", async () => {
      const { totals } = await getFamilyMonthlyLedger(viewers, "2026-09");

      expect(totals).toEqual([
        { currency: "RON", total: 200, count: 3, average: 200 / 3, largest: 100 },
        { currency: "EUR", total: 85, count: 1, average: 85, largest: 85 },
      ]);
    });

    it("has no totals for a month nobody spent in", async () => {
      expect(await getFamilyMonthlyLedger(viewers, "2026-01")).toEqual({ month: "2026-01", expenses: [], totals: [] });
    });
  });

  describe("getFamilyDashboardData", () => {
    const filters = { period: "3m", granularity: "month", customDate: "2026-09" } as const;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-25T10:00:00Z") });
    });

    it("combines the current month per currency and keeps each member's own share", async () => {
      const data = await getFamilyDashboardData(viewers, filters);

      expect(data.currentMonth).toBe("2026-09");
      expect(data.totals).toEqual([
        { currency: "RON", total: 200, count: 3, average: 200 / 3, largest: 100 },
        { currency: "EUR", total: 85, count: 1, average: 85, largest: 85 },
      ]);
      expect(data.members.map(({ memberId, name, currency, total, count }) => ({ memberId, name, currency, total, count }))).toEqual([
        { memberId: "m1", name: "Mara", currency: "RON", total: 140, count: 2 },
        { memberId: "m2", name: "Dan", currency: "RON", total: 60, count: 1 },
        { memberId: "m3", name: "Ana", currency: "EUR", total: 85, count: 1 },
      ]);
    });

    it("gives each member a monthly series ending with this month, and their own category totals", async () => {
      repositories.expenses.expenses.set("mara", [
        expense("a", 100, { expenseDate: "2026-09-02" }),
        expense("m", 30, { expenseDate: "2026-08-03", category: "groceries" }),
        expense("k", 12, { expenseDate: "2026-07-03", category: "health" }),
      ]);

      const [mara, dan] = (await getFamilyDashboardData(viewers, filters)).members;

      expect(mara.series.map((point) => [point.key, point.total])).toEqual([
        ["2026-06", 0],
        ["2026-07", 12],
        ["2026-08", 30],
        ["2026-09", 100],
      ]);
      expect(mara.series.at(-1)?.label).toBe("September 2026");
      expect(mara.categoryTotals.map((item) => [item.category, item.total])).toEqual([
        ["groceries", 30],
        ["health", 12],
      ]);
      expect(dan.series.map((point) => point.total)).toEqual([0, 0, 0, 60]);
      expect(dan.categoryTotals).toEqual([]);
    });

    it("lists the family's newest expenses with their owners", async () => {
      const data = await getFamilyDashboardData(viewers, filters);

      expect(data.currentExpenses.map(({ id, memberName }) => [id, memberName])).toEqual([
        ["c", "Dan"],
        ["d", "Ana"],
        ["b", "Mara"],
        ["a", "Mara"],
      ]);
    });

    it("keeps each member's own newest five, not the family's newest five", async () => {
      repositories.expenses.expenses.set("dan", ["1", "2", "3", "4", "5", "6"].map((id) => expense(id, 1, { expenseDate: "2026-09-24" })));

      const data = await getFamilyDashboardData(viewers, filters);

      const byMember = Object.groupBy(data.currentExpenses, (entry) => entry.memberName);
      expect(byMember.Dan).toHaveLength(5);
      expect(byMember.Mara).toHaveLength(2);
      expect(byMember.Ana).toHaveLength(1);
    });

    it("groups the analytics range per currency too", async () => {
      repositories.expenses.expenses.set("mara", [expense("m", 30, { expenseDate: "2026-08-03" })]);
      repositories.expenses.expenses.set("dan", [expense("n", 20, { expenseDate: "2026-06-03" })]);
      repositories.expenses.expenses.set("ana", [expense("old", 15, { expenseDate: "2026-07-10" })]);

      const data = await getFamilyDashboardData(viewers, filters);

      expect(data.analyticsTotals).toEqual([
        { currency: "RON", total: 50, count: 2 },
        { currency: "EUR", total: 15, count: 1 },
      ]);
    });
  });
});
