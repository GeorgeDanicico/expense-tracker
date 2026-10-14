import { beforeEach, describe, expect, it, vi } from "vitest";

import { aValuation } from "@/test/builders";
import { callRoute, signedInAs } from "@/test/route";

const mocks = vi.hoisted(() => ({
  getNetWorthOverviewForUser: vi.fn(),
  createNetWorthItemForUser: vi.fn(),
  updateNetWorthItemForUser: vi.fn(),
  addNetWorthValuationForUser: vi.fn(),
  updateNetWorthValuationForUser: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/data/net-worth", () => mocks);

import { GET as getOverview } from "@/app/api/net-worth/route";
import { POST as createItem } from "@/app/api/net-worth/items/route";
import { PATCH as updateItem } from "@/app/api/net-worth/items/[id]/route";
import { POST as addValuation } from "@/app/api/net-worth/items/[id]/valuations/route";
import { PATCH as updateValuation } from "@/app/api/net-worth/valuations/[id]/route";

const itemId = "40000000-0000-4000-8000-000000000001";
const valuationId = "50000000-0000-4000-8000-000000000001";
const newItem = { name: "Cash", kind: "asset", category: "cash", currency: "EUR", value: "10", valuedOn: "2026-09-19" };

let user: ReturnType<typeof signedInAs>;

beforeEach(() => {
  vi.clearAllMocks();
  user = signedInAs();
});

describe("GET /api/net-worth", () => {
  it("returns the signed-in user's composed overview", async () => {
    const overview = { entries: [], totalsByCurrency: [], attention: [], calculationIssues: [] };
    mocks.getNetWorthOverviewForUser.mockResolvedValue(overview);

    const response = await callRoute(getOverview);

    expect(response).toMatchObject({ status: 200, body: overview });
    expect(mocks.getNetWorthOverviewForUser).toHaveBeenCalledWith(user.id);
  });
});

describe("net-worth item routes", () => {
  it("normalizes a valid new item before saving it", async () => {
    mocks.createNetWorthItemForUser.mockResolvedValue({ itemId });

    const response = await callRoute(createItem, {
      method: "POST",
      body: { ...newItem, name: "  Apartment  ", category: "Current account", currency: "eur", value: "1250.5000000000" },
    });

    expect(response).toMatchObject({ status: 201, body: { itemId } });
    expect(mocks.createNetWorthItemForUser).toHaveBeenCalledWith(user.id, {
      ...newItem, name: "Apartment", category: "current-account", purchaseAmount: null, value: "1250.5000000000",
    });
  });

  it("rejects a purchase amount for cash without touching the data layer", async () => {
    const response = await callRoute(createItem, { method: "POST", body: { ...newItem, purchaseAmount: "10" } });

    expect(response.status).toBe(422);
    expect(response.body.fieldErrors.purchaseAmount).toBeDefined();
    expect(mocks.createNetWorthItemForUser).not.toHaveBeenCalled();
  });

  it("updates an owned item with a normalized category", async () => {
    mocks.updateNetWorthItemForUser.mockResolvedValue(true);

    const response = await callRoute(updateItem, {
      method: "PATCH", params: { id: itemId }, body: { name: "Current account", category: "Emergency Cash" },
    });

    expect(response.status).toBe(200);
    expect(mocks.updateNetWorthItemForUser).toHaveBeenCalledWith(user.id, itemId, { name: "Current account", category: "emergency-cash" });
  });
});

describe("net-worth valuation routes", () => {
  it("adds a dated zero valuation", async () => {
    const valuation = aValuation({ id: valuationId, itemId, value: "0", valuedOn: "2026-09-20" });
    mocks.addNetWorthValuationForUser.mockResolvedValue(valuation);

    const response = await callRoute(addValuation, { method: "POST", params: { id: itemId }, body: { value: "0", valuedOn: "2026-09-20" } });

    expect(response).toMatchObject({ status: 201, body: { valuation } });
    expect(mocks.addNetWorthValuationForUser).toHaveBeenCalledWith(user.id, itemId, { value: "0", valuedOn: "2026-09-20" });
  });

  it("corrects a dated valuation", async () => {
    mocks.updateNetWorthValuationForUser.mockResolvedValue(aValuation({ id: valuationId, itemId, value: "225000" }));

    const response = await callRoute(updateValuation, {
      method: "PATCH", params: { id: valuationId }, body: { value: "225000", valuedOn: "2026-09-20" },
    });

    expect(response.status).toBe(200);
    expect(mocks.updateNetWorthValuationForUser).toHaveBeenCalledWith(user.id, valuationId, { value: "225000", valuedOn: "2026-09-20" });
  });
});
