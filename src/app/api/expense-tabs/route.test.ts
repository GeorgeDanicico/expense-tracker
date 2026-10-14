import { beforeEach, describe, expect, it, vi } from "vitest";

import { aTab } from "@/test/builders";
import { callRoute, signedInAs } from "@/test/route";

const mocks = vi.hoisted(() => ({
  getExpenseTabsForUser: vi.fn(), createExpenseTabForUser: vi.fn(),
  updateExpenseTabForUser: vi.fn(), deleteExpenseTabForUser: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/data/expense-tabs", () => mocks);

import { GET, POST } from "@/app/api/expense-tabs/route";
import { PATCH, DELETE } from "@/app/api/expense-tabs/[id]/route";

const input = { name: "Car", categoryKeys: ["car" as const], subtypeKeys: [] };
const tab = aTab(input);
const params = { id: tab.id };
const url = `/api/expense-tabs/${tab.id}`;

describe("expense tab routes", () => {
  let user: ReturnType<typeof signedInAs>;

  beforeEach(() => {
    vi.resetAllMocks();
    user = signedInAs();
  });

  it("lists the signed-in user's tabs", async () => {
    mocks.getExpenseTabsForUser.mockResolvedValue([tab]);

    const response = await callRoute(GET);

    expect(response.body).toEqual({ tabs: [tab] });
    expect(mocks.getExpenseTabsForUser).toHaveBeenCalledWith(user.id);
  });

  it("creates a tab from normalized selections, owned by the signed-in user", async () => {
    mocks.createExpenseTabForUser.mockResolvedValue(tab);

    const response = await callRoute(POST, {
      method: "POST",
      body: { name: "  Car  ", categoryKeys: ["car", "car"], subtypeKeys: ["car_fuel"], user_id: "another-user" },
    });

    expect(response).toMatchObject({ status: 201, body: { tab } });
    expect(mocks.createExpenseTabForUser).toHaveBeenCalledWith(user.id, input);
  });

  it.each([
    { ...input, name: " " },
    { ...input, categoryKeys: [] },
    { ...input, subtypeKeys: ["unknown"] },
    { ...input, categoryKeys: [null] },
  ])("rejects an invalid new tab: %j", async (body) => {
    const response = await callRoute(POST, { method: "POST", body });

    expect(response.status).toBe(422);
    expect(mocks.createExpenseTabForUser).not.toHaveBeenCalled();
  });

  it("edits a tab's selections and keeps its identity", async () => {
    const edited = { ...tab, name: "Fuel", categoryKeys: [], subtypeKeys: ["car_fuel"] };
    mocks.updateExpenseTabForUser.mockResolvedValue(edited);

    const response = await callRoute(PATCH, { method: "PATCH", url, params, body: edited });

    expect(response).toMatchObject({ status: 200, body: { tab: edited } });
    expect(mocks.updateExpenseTabForUser).toHaveBeenCalledWith(user.id, tab.id, { name: "Fuel", categoryKeys: [], subtypeKeys: ["car_fuel"] });
  });

  it("rejects an invalid edit before writing", async () => {
    const response = await callRoute(PATCH, { method: "PATCH", url, params, body: { ...input, subtypeKeys: [null] } });

    expect(response.status).toBe(422);
    expect(mocks.updateExpenseTabForUser).not.toHaveBeenCalled();
  });

  it("deletes the signed-in user's addressed tab", async () => {
    mocks.deleteExpenseTabForUser.mockResolvedValue(true);

    const response = await callRoute(DELETE, { method: "DELETE", url, params });

    expect(response.body).toEqual({ success: true });
    expect(mocks.deleteExpenseTabForUser).toHaveBeenCalledWith(user.id, tab.id);
  });

  it.each([
    { method: "PATCH", handler: PATCH, body: input },
    { method: "DELETE", handler: DELETE, body: undefined },
  ])("returns 404 when $method addresses a missing or foreign tab", async ({ method, handler, body }) => {
    mocks.updateExpenseTabForUser.mockResolvedValue(null);
    mocks.deleteExpenseTabForUser.mockResolvedValue(false);

    const response = await callRoute(handler, { method, url, params, body });

    expect(response).toMatchObject({ status: 404, body: { error: "Expense tab not found." } });
  });

  it.each([
    { method: "PATCH", handler: PATCH, body: input },
    { method: "DELETE", handler: DELETE, body: undefined },
  ])("rejects a malformed id for $method before touching data", async ({ method, handler, body }) => {
    const response = await callRoute(handler, { method, url, params: { id: "invalid" }, body });

    expect(response.status).toBe(400);
    expect(mocks.updateExpenseTabForUser).not.toHaveBeenCalled();
    expect(mocks.deleteExpenseTabForUser).not.toHaveBeenCalled();
  });

  it.each([
    { method: "GET", handler: GET, message: "Unable to load expense tabs." },
    { method: "POST", handler: POST, message: "Unable to save expense tab." },
    { method: "PATCH", handler: PATCH, message: "Unable to save expense tab." },
    { method: "DELETE", handler: DELETE, message: "Unable to delete expense tab." },
  ])("reports a $method data failure as its route message", async ({ method, handler, message }) => {
    for (const mock of Object.values(mocks)) mock.mockRejectedValue(new Error("private database details"));

    const response = await callRoute(handler, { method, url, params, body: ["POST", "PATCH"].includes(method) ? input : undefined });

    expect(response).toMatchObject({ status: 500, body: { error: message } });
  });
});
