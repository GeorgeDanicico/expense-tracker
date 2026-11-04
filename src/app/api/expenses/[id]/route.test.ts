import { beforeEach, describe, expect, it, vi } from "vitest";

import { anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { DELETE, PATCH } from "./route";

const ID = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";
const MISSING = "9d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";

describe("PATCH /api/expenses/[id]", () => {
  let user: ReturnType<typeof signedInAs>;
  let repositories: FakeRepositories;
  const patch = (id: string, body: unknown) => callRoute(PATCH, { method: "PATCH", url: `/api/expenses/${id}`, body, params: { id } });

  beforeEach(() => {
    user = signedInAs();
    repositories = resetFakeRepositories();
    repositories.expenses.expenses.set(user.id, [anExpense({ id: ID, description: "Fuel", amount: 10, category: "car", subtype: "car_fuel", expenseDate: "2026-10-04" })]);
  });

  it("changes only the fields named and answers the expense as stored", async () => {
    const response = await patch(ID, { amount: "12.50", notes: "Full tank" });

    expect(response.status).toBe(200);
    expect(response.body.expense).toMatchObject({ id: ID, description: "Fuel", amount: 12.5, notes: "Full tank", subtype: "car_fuel" });
  });

  it("moves the expense to another month by its date alone (audit D10)", async () => {
    const response = await patch(ID, { expenseDate: "2025-12-31" });

    expect(response.body.expense.expenseDate).toBe("2025-12-31");
  });

  it("refuses an empty change and a third decimal with 422, changing nothing", async () => {
    expect((await patch(ID, {})).status).toBe(422);
    const response = await patch(ID, { amount: "1.005" });

    expect(response.status).toBe(422);
    expect(response.body.fieldErrors.amount).toEqual(["Use at most two decimal places."]);
    expect(repositories.expenses.expenses.get(user.id)?.[0].amount).toBe(10);
  });

  it("answers 404 for an expense the caller doesn't own", async () => {
    expect(await patch(MISSING, { amount: 1 })).toMatchObject({ status: 404, body: { error: "Expense not found." } });
  });
});

describe("DELETE /api/expenses/[id]", () => {
  let user: ReturnType<typeof signedInAs>;
  let repositories: FakeRepositories;
  const remove = (id: string) => callRoute(DELETE, { method: "DELETE", url: `/api/expenses/${id}`, params: { id } });

  beforeEach(() => {
    user = signedInAs();
    repositories = resetFakeRepositories();
    repositories.expenses.expenses.set(user.id, [anExpense({ id: ID })]);
  });

  it("deletes the caller's expense", async () => {
    expect((await remove(ID)).status).toBe(200);
    expect(repositories.expenses.expenses.get(user.id)).toEqual([]);
  });

  it("answers 404 for a missing expense, as MCP's delete_expense does (audit B3)", async () => {
    expect(await remove(MISSING)).toMatchObject({ status: 404, body: { error: "Expense not found." } });
  });
});
