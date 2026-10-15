import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EXPENSE_TAB_FILTERS } from "@/lib/expenses/filters";
import { aTab, anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

const mocks = vi.hoisted(() => ({
  getExpenseTabExpensesForUser: vi.fn(),
  getMonthlyExpensesForUser: vi.fn(),
}));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
vi.mock("@/lib/data/expenses", () => ({
  getExpenseTabExpensesForUser: mocks.getExpenseTabExpensesForUser,
  getMonthlyExpensesForUser: mocks.getMonthlyExpensesForUser,
}));
import { getExpenseTabLedgerForUser, getMonthlyLedgerForUser } from "./ledgers";

const expense = (id: string, amount: number) => anExpense({ id, amount });
const tab = aTab({ id: "tab" });

let repositories: FakeRepositories;

beforeEach(() => {
  vi.resetAllMocks();
  repositories = resetFakeRepositories();
});

describe("getMonthlyLedgerForUser", () => {
  it("returns the month's expenses with total, count and average in that key order", async () => {
    const expenses = [expense("a", 10), expense("b", 5)];
    mocks.getMonthlyExpensesForUser.mockResolvedValue(expenses);

    const ledger = await getMonthlyLedgerForUser("owner", "2026-09");

    expect(mocks.getMonthlyExpensesForUser).toHaveBeenCalledWith("owner", "2026-09");
    expect(Object.keys(ledger)).toEqual(["month", "expenses", "total", "count", "average"]);
    expect(ledger).toEqual({ month: "2026-09", expenses, total: 15, count: 2, average: 7.5 });
  });

  it("reports a zero average for an empty month", async () => {
    mocks.getMonthlyExpensesForUser.mockResolvedValue([]);

    expect(await getMonthlyLedgerForUser("owner", "2026-09")).toEqual({ month: "2026-09", expenses: [], total: 0, count: 0, average: 0 });
  });
});

describe("getExpenseTabLedgerForUser", () => {
  it("returns the tab's expenses with the applied filters and summary in that key order", async () => {
    const expenses = [expense("a", 3), expense("b", 1)];
    repositories.expenseTabs.tabs.set("owner", [tab]);
    const getTab = vi.spyOn(repositories.expenseTabs, "get");
    mocks.getExpenseTabExpensesForUser.mockResolvedValue(expenses);

    const ledger = await getExpenseTabLedgerForUser("owner", "tab", DEFAULT_EXPENSE_TAB_FILTERS);

    expect(getTab).toHaveBeenCalledWith("owner", "tab");
    expect(mocks.getExpenseTabExpensesForUser).toHaveBeenCalledWith("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);
    expect(Object.keys(ledger ?? {})).toEqual(["tab", "filters", "expenses", "total", "count", "average"]);
    expect(ledger).toEqual({ tab, filters: DEFAULT_EXPENSE_TAB_FILTERS, expenses, total: 4, count: 2, average: 2 });
  });

  it("returns null without querying expenses when the user owns no such tab", async () => {
    repositories.expenseTabs.tabs.set("someone-else", [aTab({ id: "missing" })]);

    expect(await getExpenseTabLedgerForUser("owner", "missing", DEFAULT_EXPENSE_TAB_FILTERS)).toBeNull();
    expect(mocks.getExpenseTabExpensesForUser).not.toHaveBeenCalled();
  });
});
