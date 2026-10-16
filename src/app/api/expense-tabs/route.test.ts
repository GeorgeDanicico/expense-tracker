import { beforeEach, describe, expect, it, vi } from "vitest";

import { aTab } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET, POST } from "@/app/api/expense-tabs/route";
import { PATCH, DELETE } from "@/app/api/expense-tabs/[id]/route";

const input = { name: "Car", categoryKeys: ["car" as const], subtypeKeys: [] };
const tab = aTab(input);
const params = { id: tab.id };
const url = `/api/expense-tabs/${tab.id}`;
const otherUserId = "10000000-0000-4000-8000-000000000099";

describe("expense tab routes", () => {
  let repositories: FakeRepositories;
  let user: ReturnType<typeof signedInAs>;

  beforeEach(() => {
    repositories = resetFakeRepositories();
    user = signedInAs();
  });

  it("lists the signed-in user's tabs", async () => {
    repositories.expenseTabs.tabs.set(user.id, [tab]);
    repositories.expenseTabs.tabs.set(otherUserId, [aTab({ id: "40000000-0000-4000-8000-000000000002" })]);

    const response = await callRoute(GET);

    expect(response.body).toEqual({ tabs: [tab], viewing: { memberId: null, displayName: null, readOnly: false } });
  });

  it("creates a tab from normalized selections, owned by the signed-in user", async () => {
    const create = vi.spyOn(repositories.expenseTabs, "create");

    const response = await callRoute(POST, {
      method: "POST",
      body: { name: "  Car  ", categoryKeys: ["car", "car"], subtypeKeys: ["car_fuel"], user_id: "another-user" },
    });

    expect(response).toMatchObject({ status: 201, body: { tab: input } });
    expect(create).toHaveBeenCalledWith(user.id, input);
    expect(repositories.expenseTabs.tabs.get(user.id)).toEqual([response.body.tab]);
    expect(repositories.expenseTabs.tabs.has("another-user")).toBe(false);
  });

  it.each([
    { ...input, name: " " },
    { ...input, categoryKeys: [] },
    { ...input, subtypeKeys: ["unknown"] },
    { ...input, categoryKeys: [null] },
  ])("rejects an invalid new tab: %j", async (body) => {
    const response = await callRoute(POST, { method: "POST", body });

    expect(response.status).toBe(422);
    expect(repositories.expenseTabs.tabs.size).toBe(0);
  });

  it("edits a tab's selections and keeps its identity", async () => {
    repositories.expenseTabs.tabs.set(user.id, [tab]);
    const update = vi.spyOn(repositories.expenseTabs, "update");
    const edited = { ...tab, name: "Fuel", categoryKeys: [], subtypeKeys: ["car_fuel"] };

    const response = await callRoute(PATCH, { method: "PATCH", url, params, body: edited });

    expect(response).toMatchObject({ status: 200, body: { tab: { ...edited, updatedAt: expect.any(String) } } });
    expect(update).toHaveBeenCalledWith(user.id, tab.id, { name: "Fuel", categoryKeys: [], subtypeKeys: ["car_fuel"] });
    expect(repositories.expenseTabs.tabs.get(user.id)).toEqual([response.body.tab]);
  });

  it("rejects an invalid edit before writing", async () => {
    repositories.expenseTabs.tabs.set(user.id, [tab]);

    const response = await callRoute(PATCH, { method: "PATCH", url, params, body: { ...input, subtypeKeys: [null] } });

    expect(response.status).toBe(422);
    expect(repositories.expenseTabs.tabs.get(user.id)).toEqual([tab]);
  });

  it("deletes the signed-in user's addressed tab", async () => {
    repositories.expenseTabs.tabs.set(user.id, [tab]);

    const response = await callRoute(DELETE, { method: "DELETE", url, params });

    expect(response.body).toEqual({ success: true });
    expect(repositories.expenseTabs.tabs.get(user.id)).toEqual([]);
  });

  it.each([
    { method: "PATCH", handler: PATCH, body: input },
    { method: "DELETE", handler: DELETE, body: undefined },
  ])("returns 404 when $method addresses a missing or foreign tab", async ({ method, handler, body }) => {
    repositories.expenseTabs.tabs.set(otherUserId, [tab]);

    const response = await callRoute(handler, { method, url, params, body });

    expect(response).toMatchObject({ status: 404, body: { error: "Expense tab not found." } });
    expect(repositories.expenseTabs.tabs.get(otherUserId)).toEqual([tab]);
  });

  it.each([
    { method: "PATCH", handler: PATCH, body: input },
    { method: "DELETE", handler: DELETE, body: undefined },
  ])("rejects a malformed id for $method before touching data", async ({ method, handler, body }) => {
    const update = vi.spyOn(repositories.expenseTabs, "update");
    const remove = vi.spyOn(repositories.expenseTabs, "delete");

    const response = await callRoute(handler, { method, url, params: { id: "invalid" }, body });

    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    { method: "GET", handler: GET, message: "Unable to load expense tabs." },
    { method: "POST", handler: POST, message: "Unable to save expense tab." },
    { method: "PATCH", handler: PATCH, message: "Unable to save expense tab." },
    { method: "DELETE", handler: DELETE, message: "Unable to delete expense tab." },
  ])("reports a $method data failure as its route message", async ({ method, handler, message }) => {
    for (const name of ["list", "get", "create", "update", "delete"] as const) {
      vi.spyOn(repositories.expenseTabs, name).mockRejectedValue(new Error("private database details"));
    }

    const response = await callRoute(handler, { method, url, params, body: ["POST", "PATCH"].includes(method) ? input : undefined });

    expect(response).toMatchObject({ status: 500, body: { error: message } });
  });
});
