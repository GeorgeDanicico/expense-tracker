import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type { ExpenseRepository } from "@/lib/expenses/repository";
import { resetFakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

const mocks = vi.hoisted(() => ({ buildExpenseWorkbook: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
vi.mock("@/lib/export/xlsx", () => ({ buildExpenseWorkbook: mocks.buildExpenseWorkbook }));

import { GET as monthlyGet } from "./route";
import { GET as exportGet } from "./export/route";

describe("main Expenses API month limit", () => {
  let user: ReturnType<typeof signedInAs>;
  let listMonth: MockInstance<ExpenseRepository["listMonth"]>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T22:00:00Z"));
    user = signedInAs();
    const repositories = resetFakeRepositories();
    repositories.account.currencies.set(user.id, "RON");
    listMonth = vi.spyOn(repositories.expenses, "listMonth");
    mocks.buildExpenseWorkbook.mockReturnValue(new Uint8Array([1, 2, 3]));
  });
  afterEach(() => vi.useRealTimers());

  it("caps a future month for the main ledger and reports the effective month", async () => {
    const response = await callRoute(monthlyGet, { url: "/api/expenses?month=2027-02&context=main" });

    expect(response.body).toMatchObject({ month: "2027-01", effectiveMonth: "2027-01" });
    expect(listMonth).toHaveBeenCalledWith(user.id, "2027-01");
  });

  it("leaves a valid future month uncapped for Home's monthly view", async () => {
    const response = await callRoute(monthlyGet, { url: "/api/expenses?month=2027-02" });

    expect(response.body).toMatchObject({ month: "2027-02" });
    expect(listMonth).toHaveBeenCalledWith(user.id, "2027-02");
  });

  it("caps a future export to the effective month", async () => {
    const response = await callRoute(exportGet, { url: "/api/expenses/export?month=2027-02" });

    expect(response.status).toBe(200);
    expect(listMonth).toHaveBeenCalledWith(user.id, "2027-01");
  });

  it("names the exported workbook after the effective month, privately", async () => {
    const { headers } = await callRoute(exportGet, { url: "/api/expenses/export?month=2027-02" });

    expect(headers.get("content-disposition")).toContain("expenses-2027-01.xlsx");
    expect(headers.get("x-expense-month")).toBe("2027-01");
    expect(headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("rejects a malformed export month before reading expenses", async () => {
    const response = await callRoute(exportGet, { url: "/api/expenses/export?month=2027-13" });

    expect(response.status).toBe(400);
    expect(listMonth).not.toHaveBeenCalled();
  });
});
