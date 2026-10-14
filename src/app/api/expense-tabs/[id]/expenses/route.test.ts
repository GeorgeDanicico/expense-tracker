import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EXPENSE_TAB_FILTERS } from "@/lib/expenses/filters";
import { aTab, anExpense } from "@/test/builders";
import { callRoute, signedInAs } from "@/test/route";

const mocks = vi.hoisted(() => ({ getExpenseTabForUser: vi.fn(), getExpenseTabExpensesForUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/data/expense-tabs", () => ({ getExpenseTabForUser: mocks.getExpenseTabForUser }));
vi.mock("@/lib/data/expenses", () => ({ getExpenseTabExpensesForUser: mocks.getExpenseTabExpensesForUser }));

import { GET } from "./route";

const tab = aTab({ createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T01:00:00Z" });
const expenses = [anExpense({ description: "Service", amount: 12.5, expenseDate: "2024-02-29", category: "car", subtype: "car_maintenance" })];
const getLedger = (query = "", id = tab.id) => callRoute(GET, { url: `/api/expense-tabs/${id}/expenses?${query}`, params: { id } });

describe("GET /api/expense-tabs/[id]/expenses", () => {
  let user: ReturnType<typeof signedInAs>;

  beforeEach(() => {
    vi.resetAllMocks();
    user = signedInAs();
    mocks.getExpenseTabForUser.mockResolvedValue(tab);
    mocks.getExpenseTabExpensesForUser.mockResolvedValue(expenses);
  });

  it("returns the tab, its normalized filters, its expenses and their summary", async () => {
    const response = await getLedger("month=2026-10&categoryKeys=transport&revision=stale");

    expect(response).toMatchObject({
      status: 200,
      body: { tab, filters: DEFAULT_EXPENSE_TAB_FILTERS, expenses, total: 12.5, count: 1, average: 12.5 },
    });
  });

  it("reads the signed-in user's saved tab and its expenses", async () => {
    await getLedger();

    expect(mocks.getExpenseTabForUser).toHaveBeenCalledWith(user.id, tab.id);
    expect(mocks.getExpenseTabExpensesForUser).toHaveBeenCalledWith(user.id, tab, DEFAULT_EXPENSE_TAB_FILTERS);
  });

  it("passes normalized narrowing filters to data access", async () => {
    await getLedger("scope=range&startDate=2024-02-29&endDate=2024-02-29&subtype=none&category=car&search=++garage++");

    expect(mocks.getExpenseTabExpensesForUser).toHaveBeenCalledWith(user.id, tab, {
      scope: "range", startDate: "2024-02-29", endDate: "2024-02-29", subtype: "none", category: "car", search: "garage",
    });
  });

  it("returns 404 for a missing or foreign tab without reading expenses", async () => {
    mocks.getExpenseTabForUser.mockResolvedValue(null);

    const response = await getLedger();

    expect(response).toMatchObject({ status: 404, body: { error: "Expense tab not found." } });
    expect(mocks.getExpenseTabExpensesForUser).not.toHaveBeenCalled();
  });

  it("rejects a malformed tab id", async () => {
    const response = await getLedger("", "invalid");

    expect(response.status).toBe(400);
    expect(mocks.getExpenseTabForUser).not.toHaveBeenCalled();
  });

  it.each([
    "scope=year&year=2026&startDate=2026-01-01", "scope=year&year=nope",
    "scope=range&startDate=2025-02-29&endDate=2025-03-01", "scope=range&startDate=2026-05-01&endDate=2026-04-30",
    "subtype=unknown", "category=unknown",
  ])("rejects invalid filters before reading data: %s", async (query) => {
    const response = await getLedger(query);

    expect(response.status).toBe(422);
    expect(mocks.getExpenseTabForUser).not.toHaveBeenCalled();
  });

  it("returns a zero summary for a tab without expenses", async () => {
    mocks.getExpenseTabExpensesForUser.mockResolvedValue([]);

    const response = await getLedger();

    expect(response.body).toMatchObject({ expenses: [], total: 0, count: 0, average: 0 });
  });

  it("reports a failure with the route's own message", async () => {
    mocks.getExpenseTabExpensesForUser.mockRejectedValue(new Error("private SQL details"));

    const response = await getLedger();

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to load expense tab." } });
  });
});
