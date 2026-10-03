import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn(), createClient: vi.fn(), getMonthlyExpensesForUser: vi.fn(), insert: vi.fn(), select: vi.fn(), single: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/data/expenses", () => ({ getMonthlyExpensesForUser: mocks.getMonthlyExpensesForUser }));

import { POST } from "@/app/api/expenses/route";

const body = { selectedMonth: "2026-09", expenseDate: "2026-09-01", description: "Fuel", amount: "10.50", category: "car", subtype: "car_fuel" };
const request = (data: unknown) => new NextRequest("http://localhost/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

describe("expense subtype creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "owner" });
    mocks.createClient.mockResolvedValue({ from: () => ({ insert: mocks.insert }) });
    mocks.insert.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ single: mocks.single });
    mocks.single.mockResolvedValue({ data: { id: "expense", description: "Fuel", amount: "10.50", category: "car", subtype: "car_fuel", expense_date: "2026-09-01", notes: null }, error: null });
  });

  it("writes the optional subtype using authenticated ownership", async () => {
    const response = await POST(request({ ...body, user_id: "someone-else" }));
    expect(response.status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "owner", category: "car", subtype: "car_fuel" }));
    expect((await response.json()).expense).toMatchObject({ category: "car", subtype: "car_fuel", amount: 10.5 });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("writes null for an omitted subtype", async () => {
    await POST(request({ ...body, subtype: undefined }));
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ subtype: null }));
  });

  it("returns the final stored classification after a database classifier", async () => {
    const response = await POST(request({ ...body, category: "transport", subtype: null }));
    expect((await response.json()).expense).toMatchObject({ category: "car", subtype: "car_fuel" });
  });

  it("rejects incompatible subtypes before database access", async () => {
    const response = await POST(request({ ...body, category: "groceries" }));
    expect(response.status).toBe(422);
    expect((await response.json()).fieldErrors.subtype).toHaveLength(1);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("authenticates before accepting writes", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    expect((await POST(request(body))).status).toBe(401);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
