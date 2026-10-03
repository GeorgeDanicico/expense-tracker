import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getMonthlyExpensesForUser: vi.fn(),
  getAccountCurrencyForUser: vi.fn(),
  buildExpenseWorkbook: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/data/expenses", () => ({ getMonthlyExpensesForUser: mocks.getMonthlyExpensesForUser }));
vi.mock("@/lib/data/account", () => ({ getAccountCurrencyForUser: mocks.getAccountCurrencyForUser }));
vi.mock("@/lib/export/xlsx", () => ({ buildExpenseWorkbook: mocks.buildExpenseWorkbook }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { GET as monthlyGet } from "./route";
import { GET as exportGet } from "./export/route";

describe("main Expenses API month limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T22:00:00Z"));
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "owner" });
    mocks.getMonthlyExpensesForUser.mockResolvedValue([]);
    mocks.getAccountCurrencyForUser.mockResolvedValue("RON");
    mocks.buildExpenseWorkbook.mockReturnValue(new Uint8Array([1, 2, 3]));
  });
  afterEach(() => vi.useRealTimers());

  it("caps future monthly main-context requests and reports the effective month", async () => {
    const response = await monthlyGet(new NextRequest("http://localhost/api/expenses?month=2027-02&context=main"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ month: "2027-01", effectiveMonth: "2027-01" });
    expect(mocks.getMonthlyExpensesForUser).toHaveBeenCalledWith("owner", "2027-01");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("preserves unrestricted valid months for Home's monthly consumer", async () => {
    const response = await monthlyGet(new NextRequest("http://localhost/api/expenses?month=2027-02"));
    expect(await response.json()).toMatchObject({ month: "2027-02" });
    expect(mocks.getMonthlyExpensesForUser).toHaveBeenCalledWith("owner", "2027-02");
  });

  it("caps a direct future export and names the workbook for its effective month", async () => {
    const response = await exportGet(new NextRequest("http://localhost/api/expenses/export?month=2027-02"));
    expect(response.status).toBe(200);
    expect(mocks.getMonthlyExpensesForUser).toHaveBeenCalledWith("owner", "2027-01");
    expect(response.headers.get("content-disposition")).toContain("expenses-2027-01.xlsx");
    expect(response.headers.get("x-expense-month")).toBe("2027-01");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("rejects malformed exports before accessing financial data", async () => {
    const response = await exportGet(new NextRequest("http://localhost/api/expenses/export?month=2027-13"));
    expect(response.status).toBe(400);
    expect(mocks.getMonthlyExpensesForUser).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("authenticates both routes before accessing expenses", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    expect((await monthlyGet(new NextRequest("http://localhost/api/expenses?month=2027-02&context=main"))).status).toBe(401);
    expect((await exportGet(new NextRequest("http://localhost/api/expenses/export?month=2027-02"))).status).toBe(401);
    expect(mocks.getMonthlyExpensesForUser).not.toHaveBeenCalled();
  });
});
