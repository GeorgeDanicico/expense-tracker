import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn(), getExpenseTabForUser: vi.fn(), getExpenseTabExpensesForUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/data/expense-tabs", () => ({ getExpenseTabForUser: mocks.getExpenseTabForUser }));
vi.mock("@/lib/data/expenses", () => ({ getExpenseTabExpensesForUser: mocks.getExpenseTabExpensesForUser }));
import { GET } from "./route";
import { DEFAULT_EXPENSE_TAB_FILTERS } from "@/lib/expenses/tab-filters";

const id = "40000000-0000-4000-8000-000000000041";
const context = { params: Promise.resolve({ id }) };
const tab = { id, name: "Car", categoryKeys: ["car"], subtypeKeys: [], createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T01:00:00Z" };
const expenses = [{ id: "expense", description: "Service", amount: 12.50, expenseDate: "2024-02-29", category: "car", subtype: "car_maintenance", notes: null }];
const request = (query = "") => new NextRequest(`http://localhost/api/expense-tabs/${id}/expenses?${query}`);
const expectPrivate = (response: Response) => expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");

describe("custom ledger GET", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "owner" });
    mocks.getExpenseTabForUser.mockResolvedValue(tab);
    mocks.getExpenseTabExpensesForUser.mockResolvedValue(expenses);
  });
  it("authenticates before resolving a tab or reading financial data", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expectPrivate(response);
    expect(mocks.getExpenseTabForUser).not.toHaveBeenCalled();
    expect(mocks.getExpenseTabExpensesForUser).not.toHaveBeenCalled();
  });
  it("loads saved owner membership and returns identifying normalized metadata", async () => {
    const response = await GET(request("month=2026-10&categoryKeys=transport&revision=stale"), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tab, tabId: id, tabRevision: tab.updatedAt,
      filters: DEFAULT_EXPENSE_TAB_FILTERS, expenses, total: 12.50, count: 1, average: 12.50 });
    expect(mocks.getExpenseTabForUser).toHaveBeenCalledWith("owner", id);
    expect(mocks.getExpenseTabExpensesForUser).toHaveBeenCalledWith("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);
    expectPrivate(response);
  });
  it("passes normalized narrowing filters to data access", async () => {
    const response = await GET(request("scope=range&startDate=2024-02-29&endDate=2024-02-29&subtype=none&category=car&search=++garage++"), context);
    expect(response.status).toBe(200);
    expect(mocks.getExpenseTabExpensesForUser).toHaveBeenCalledWith("owner", tab, {
      scope: "range", startDate: "2024-02-29", endDate: "2024-02-29", subtype: "none", category: "car", search: "garage",
    });
  });
  it("returns the same 404 for missing and other-owner identifiers before querying expenses", async () => {
    mocks.getExpenseTabForUser.mockResolvedValue(null);
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Expense tab not found." });
    expect(mocks.getExpenseTabExpensesForUser).not.toHaveBeenCalled();
    expectPrivate(response);
  });
  it("rejects malformed identifiers", async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: "invalid" }) });
    expect(response.status).toBe(400);
    expect(mocks.getExpenseTabForUser).not.toHaveBeenCalled();
    expectPrivate(response);
  });
  it.each([
    "scope=year&year=2026&startDate=2026-01-01", "scope=year&year=nope",
    "scope=range&startDate=2025-02-29&endDate=2025-03-01", "scope=range&startDate=2026-05-01&endDate=2026-04-30",
    "subtype=unknown", "category=unknown",
  ])("rejects invalid filters before database access: %s", async (query) => {
    const response = await GET(request(query), context);
    expect(response.status).toBe(422);
    expect(mocks.getExpenseTabForUser).not.toHaveBeenCalled();
    expectPrivate(response);
  });
  it("returns complete empty state metadata", async () => {
    mocks.getExpenseTabExpensesForUser.mockResolvedValue([]);
    const response = await GET(request(), context);
    expect(await response.json()).toMatchObject({ expenses: [], total: 0, count: 0, average: 0 });
  });
  it.each(["tab", "expenses"])("handles %s retrieval failures without leaking details", async (stage) => {
    (stage === "tab" ? mocks.getExpenseTabForUser : mocks.getExpenseTabExpensesForUser).mockRejectedValue(new Error("private SQL details"));
    const response = await GET(request(), context);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to load expense tab." });
    expectPrivate(response);
  });
});
