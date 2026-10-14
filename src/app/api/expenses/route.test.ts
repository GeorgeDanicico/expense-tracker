import { beforeEach, describe, expect, it, vi } from "vitest";

import { anExpense } from "@/test/builders";
import { callRoute, signedInAs } from "@/test/route";

const mocks = vi.hoisted(() => ({ getMonthlyExpensesForUser: vi.fn(), createExpenseForUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/data/expenses", () => mocks);

import { POST } from "@/app/api/expenses/route";

const body = { selectedMonth: "2026-09", expenseDate: "2026-09-01", description: "Fuel", amount: "10.50", category: "car", subtype: "car_fuel" };
const stored = anExpense({ id: "expense", description: "Fuel", amount: 10.5, category: "car", subtype: "car_fuel", expenseDate: "2026-09-01" });
const post = (data: unknown) => callRoute(POST, { method: "POST", url: "/api/expenses", body: data });

describe("POST /api/expenses", () => {
  let user: ReturnType<typeof signedInAs>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = signedInAs();
    mocks.createExpenseForUser.mockResolvedValue(stored);
  });

  it("creates the expense for the signed-in user, ignoring a user_id in the body", async () => {
    const response = await post({ ...body, user_id: "someone-else" });

    expect(response.status).toBe(201);
    expect(mocks.createExpenseForUser).toHaveBeenCalledWith(user.id, expect.objectContaining({ category: "car", subtype: "car_fuel", amount: 10.5 }));
    expect(mocks.createExpenseForUser.mock.calls[0][1]).not.toHaveProperty("user_id");
  });

  it("writes null for an omitted subtype", async () => {
    await post({ ...body, subtype: undefined });

    expect(mocks.createExpenseForUser).toHaveBeenCalledWith(user.id, expect.objectContaining({ subtype: null }));
  });

  it("responds with the expense as stored, not as requested", async () => {
    const response = await post({ ...body, category: "transport", subtype: null });

    expect(response.body.expense).toEqual(stored);
  });

  it("rejects a subtype from another category before touching the database", async () => {
    const response = await post({ ...body, category: "groceries" });

    expect(response.status).toBe(422);
    expect(response.body.fieldErrors.subtype).toHaveLength(1);
    expect(mocks.createExpenseForUser).not.toHaveBeenCalled();
  });

  it("reports a storage failure with the route's own message", async () => {
    mocks.createExpenseForUser.mockRejectedValue(new Error("private failure"));

    const response = await post(body);

    expect(response).toMatchObject({ status: 500, body: { error: "The expense could not be saved." } });
  });
});
