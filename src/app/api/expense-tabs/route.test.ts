import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(), getExpenseTabsForUser: vi.fn(),
  createExpenseTabForUser: vi.fn(), updateExpenseTabForUser: vi.fn(), deleteExpenseTabForUser: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/data/expense-tabs", () => mocks);

import { GET, POST } from "@/app/api/expense-tabs/route";
import { PATCH, DELETE } from "@/app/api/expense-tabs/[id]/route";

const user = { id: "10000000-0000-4000-8000-000000000031" };
const id = "40000000-0000-4000-8000-000000000031";
const context = { params: Promise.resolve({ id }) };
const input = { name: "Car", categoryKeys: ["car"], subtypeKeys: [] };
const tab = { id, ...input, createdAt: "2026-10-03T12:00:00Z", updatedAt: "2026-10-03T12:00:00Z" };
function request(method: string, body: unknown = input) {
  return new Request(`http://localhost/api/expense-tabs/${id}`, {
    method, body: method === "DELETE" ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
}

describe("owner-scoped expense tab routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(user);
  });

  it.each(["GET", "POST", "PATCH", "DELETE"])("requires authentication for %s", async (method) => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const response = method === "GET" ? await GET()
      : method === "POST" ? await POST(request(method))
      : method === "PATCH" ? await PATCH(request(method), context)
      : await DELETE(request(method), context);
    expect(response.status).toBe(401);
    expectPrivate(response);
    expect(mocks.getExpenseTabsForUser).not.toHaveBeenCalled();
    expect(mocks.createExpenseTabForUser).not.toHaveBeenCalled();
    expect(mocks.updateExpenseTabForUser).not.toHaveBeenCalled();
    expect(mocks.deleteExpenseTabForUser).not.toHaveBeenCalled();
  });

  it("reloads owner configurations", async () => {
    mocks.getExpenseTabsForUser.mockResolvedValue([tab]);
    const response = await GET();
    expect(await response.json()).toEqual({ tabs: [tab] });
    expect(mocks.getExpenseTabsForUser).toHaveBeenCalledWith(user.id);
    expectPrivate(response);
  });

  it("creates normalized selections using authenticated ownership", async () => {
    mocks.createExpenseTabForUser.mockResolvedValue(tab);
    const response = await POST(request("POST", {
      name: "  Car  ", categoryKeys: ["car", "car"], subtypeKeys: ["car_fuel"], user_id: "another-user",
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ tab });
    expect(mocks.createExpenseTabForUser).toHaveBeenCalledWith(user.id, input);
    expectPrivate(response);
  });

  it.each([
    { ...input, name: " " },
    { ...input, categoryKeys: [] },
    { ...input, subtypeKeys: ["unknown"] },
    { ...input, categoryKeys: [null] },
  ])("rejects invalid create requests", async (body) => {
    const response = await POST(request("POST", body));
    expect(response.status).toBe(422);
    expectPrivate(response);
    expect(mocks.createExpenseTabForUser).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("http://localhost/api/expense-tabs", { method: "POST", body: "{" }));
    expect(response.status).toBe(422);
  });

  it("edits selections while preserving identity", async () => {
    const edited = { ...tab, name: "Fuel", categoryKeys: [], subtypeKeys: ["car_fuel"] };
    mocks.updateExpenseTabForUser.mockResolvedValue(edited);
    const response = await PATCH(request("PATCH", edited), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tab: edited });
    expect(mocks.updateExpenseTabForUser).toHaveBeenCalledWith(user.id, id, {
      name: "Fuel", categoryKeys: [], subtypeKeys: ["car_fuel"],
    });
    expectPrivate(response);
  });

  it("rejects invalid edits before writing", async () => {
    const response = await PATCH(request("PATCH", { ...input, subtypeKeys: [null] }), context);
    expect(response.status).toBe(422);
    expect(mocks.updateExpenseTabForUser).not.toHaveBeenCalled();
  });

  it.each(["PATCH", "DELETE"])("returns 404 for inaccessible %s IDs", async (method) => {
    mocks.updateExpenseTabForUser.mockResolvedValue(null);
    mocks.deleteExpenseTabForUser.mockResolvedValue(false);
    const response = method === "PATCH" ? await PATCH(request(method), context) : await DELETE(request(method), context);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Expense tab not found." });
    expectPrivate(response);
  });

  it.each(["PATCH", "DELETE"])("rejects malformed %s IDs", async (method) => {
    const invalidContext = { params: Promise.resolve({ id: "invalid" }) };
    const response = method === "PATCH" ? await PATCH(request(method), invalidContext) : await DELETE(request(method), invalidContext);
    expect(response.status).toBe(400);
    expect(mocks.updateExpenseTabForUser).not.toHaveBeenCalled();
    expect(mocks.deleteExpenseTabForUser).not.toHaveBeenCalled();
  });

  it("deletes only the addressed owner configuration", async () => {
    mocks.deleteExpenseTabForUser.mockResolvedValue(true);
    const response = await DELETE(request("DELETE"), context);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.deleteExpenseTabForUser).toHaveBeenCalledWith(user.id, id);
    expectPrivate(response);
  });

  it.each(["GET", "POST", "PATCH", "DELETE"])("reports %s data errors without leaking internals", async (method) => {
    for (const mock of [mocks.getExpenseTabsForUser, mocks.createExpenseTabForUser, mocks.updateExpenseTabForUser, mocks.deleteExpenseTabForUser]) {
      mock.mockRejectedValue(new Error("private database details"));
    }
    const response = method === "GET" ? await GET()
      : method === "POST" ? await POST(request(method))
      : method === "PATCH" ? await PATCH(request(method), context)
      : await DELETE(request(method), context);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private database details");
    expectPrivate(response);
  });
});
