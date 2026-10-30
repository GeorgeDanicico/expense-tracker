import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type { ExpenseRepository } from "@/lib/expenses/repository";

import { aKid, aParent, anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { POST } from "@/app/api/expenses/route";

const body = { selectedMonth: "2026-09", expenseDate: "2026-09-01", description: "Fuel", amount: "10.50", category: "car", subtype: "car_fuel" };
const stored = anExpense({ id: "expense", description: "Fuel", amount: 10.5, category: "car", subtype: "car_fuel", expenseDate: "2026-09-01" });
const post = (data: unknown) => callRoute(POST, { method: "POST", url: "/api/expenses", body: data });

describe("POST /api/expenses", () => {
  let user: ReturnType<typeof signedInAs>;
  let create: MockInstance<ExpenseRepository["create"]>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = signedInAs();
    create = vi.spyOn(resetFakeRepositories().expenses, "create").mockResolvedValue(stored);
  });

  it("creates the expense for the signed-in user, ignoring a user_id in the body", async () => {
    const response = await post({ ...body, user_id: "someone-else" });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(user.id, expect.objectContaining({ category: "car", subtype: "car_fuel", amount: 10.5 }));
    expect(create.mock.calls[0][1]).not.toHaveProperty("user_id");
  });

  it("writes null for an omitted subtype", async () => {
    await post({ ...body, subtype: undefined });

    expect(create).toHaveBeenCalledWith(user.id, expect.objectContaining({ subtype: null }));
  });

  it("responds with the expense as stored, not as requested", async () => {
    const response = await post({ ...body, category: "transport", subtype: null });

    expect(response.body.expense).toEqual(stored);
  });

  it("rejects a subtype from another category before touching the database", async () => {
    const response = await post({ ...body, category: "groceries" });

    expect(response.status).toBe(422);
    expect(response.body.fieldErrors.subtype).toHaveLength(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("reports a storage failure with the route's own message", async () => {
    create.mockRejectedValue(new Error("private failure"));

    const response = await post(body);

    expect(response).toMatchObject({ status: 500, body: { error: "The expense could not be saved." } });
  });
});

describe("POST /api/expenses in a family", () => {
  let repositories: FakeRepositories;

  beforeEach(() => {
    signedInAs();
    repositories = resetFakeRepositories();
    vi.spyOn(repositories.expenses, "create").mockResolvedValue(stored);
    vi.stubEnv("FAMILY_ENABLED", "true");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("creates the expense for a kid with expenses on", async () => {
    repositories.family.membership = aKid({ permissions: { expenses: "edit", investments: "off", net_worth: "off", family_finance: "off", mcp: "off", ai: "off" } });

    expect(await post(body)).toMatchObject({ status: 201, body: { expense: stored } });
  });

  it("refuses a kid with expenses off", async () => {
    repositories.family.membership = aKid({ permissions: { expenses: "off", investments: "edit", net_worth: "edit", family_finance: "view", mcp: "off", ai: "off" } });

    expect(await post(body)).toMatchObject({ status: 403, body: { error: "You don't have access to this." } });
    expect(repositories.expenses.create).not.toHaveBeenCalled();
  });

  it("creates the expense for a parent, as before", async () => {
    repositories.family.membership = aParent();

    expect((await post(body)).status).toBe(201);
  });
});
