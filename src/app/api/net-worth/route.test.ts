import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InvestmentsOverview } from "@/lib/investments/types";
import { buildNetWorthOverview } from "@/lib/net-worth/calculation";
import { aManualItem, aValuation } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

const mocks = vi.hoisted(() => ({ getInvestmentsOverview: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
vi.mock("@/lib/investments/service", () => mocks);

import { GET as getOverview } from "@/app/api/net-worth/route";
import { POST as createItem } from "@/app/api/net-worth/items/route";
import { PATCH as updateItem } from "@/app/api/net-worth/items/[id]/route";
import { POST as addValuation } from "@/app/api/net-worth/items/[id]/valuations/route";
import { PATCH as updateValuation } from "@/app/api/net-worth/valuations/[id]/route";

const itemId = "40000000-0000-4000-8000-000000000001";
const valuationId = "50000000-0000-4000-8000-000000000001";
const newItem = { name: "Cash", kind: "asset", category: "cash", currency: "EUR", value: "10", valuedOn: "2026-09-19" };
const noInvestments: InvestmentsOverview = { brokers: [], calculationIssues: [] };

let repositories: FakeRepositories;
let user: ReturnType<typeof signedInAs>;

beforeEach(() => {
  vi.clearAllMocks();
  repositories = resetFakeRepositories();
  user = signedInAs();
  mocks.getInvestmentsOverview.mockResolvedValue(noInvestments);
});

describe("GET /api/net-worth", () => {
  it("returns the signed-in user's composed overview", async () => {
    const own = aManualItem({ id: itemId, valuations: [aValuation({ id: valuationId, itemId })] });
    repositories.netWorth.seed(user.id, own);
    repositories.netWorth.seed("someone-else", aManualItem({ id: "other-item", name: "Not mine" }));

    const response = await callRoute(getOverview);

    expect(response).toMatchObject({ status: 200, body: buildNetWorthOverview(noInvestments, [own]) });
    expect(mocks.getInvestmentsOverview).toHaveBeenCalledWith(user.id);
  });
});

describe("net-worth item routes", () => {
  it("normalizes a valid new item before saving it", async () => {
    const response = await callRoute(createItem, {
      method: "POST",
      body: { ...newItem, name: "  Apartment  ", category: "Current account", currency: "eur", value: "1250.5000000000" },
    });

    expect(response).toMatchObject({ status: 201, body: { itemId: expect.any(String) } });
    expect(repositories.netWorth.items.get(response.body.itemId)).toEqual({
      id: response.body.itemId, userId: user.id, name: "Apartment", kind: "asset", category: "current-account",
      currency: "EUR", purchaseAmount: null, archivedAt: null,
    });
    expect([...repositories.netWorth.valuations.values()]).toEqual([
      { id: expect.any(String), itemId: response.body.itemId, value: "1250.5000000000", valuedOn: "2026-09-19" },
    ]);
  });

  it("rejects a purchase amount for cash without touching the data layer", async () => {
    const response = await callRoute(createItem, { method: "POST", body: { ...newItem, purchaseAmount: "10" } });

    expect(response.status).toBe(422);
    expect(response.body.fieldErrors.purchaseAmount).toBeDefined();
    expect(repositories.netWorth.items.size).toBe(0);
  });

  it("updates an owned item with a normalized category", async () => {
    repositories.netWorth.seed(user.id, aManualItem({ id: itemId, name: "Savings" }));

    const response = await callRoute(updateItem, {
      method: "PATCH", params: { id: itemId }, body: { name: "Current account", category: "Emergency Cash" },
    });

    expect(response.status).toBe(200);
    expect(repositories.netWorth.items.get(itemId)).toMatchObject({ name: "Current account", category: "emergency-cash" });
  });

  it("clears the purchase amount when an item becomes cash", async () => {
    repositories.netWorth.seed(user.id, aManualItem({ id: itemId, category: "jewelry", purchaseAmount: "500" }));

    await callRoute(updateItem, { method: "PATCH", params: { id: itemId }, body: { category: "cash" } });

    expect(repositories.netWorth.items.get(itemId)).toMatchObject({ category: "cash", purchaseAmount: null });
  });

  it("rejects a purchase amount on a cash item", async () => {
    repositories.netWorth.seed(user.id, aManualItem({ id: itemId, category: "cash" }));

    const response = await callRoute(updateItem, { method: "PATCH", params: { id: itemId }, body: { purchaseAmount: "10" } });

    expect(response).toMatchObject({
      status: 422,
      body: { fieldErrors: { purchaseAmount: ["Purchase amount is only available for non-cash assets."] } },
    });
  });

  it("does not update another user's item", async () => {
    repositories.netWorth.seed("someone-else", aManualItem({ id: itemId, name: "Savings" }));

    const response = await callRoute(updateItem, { method: "PATCH", params: { id: itemId }, body: { name: "Mine now" } });

    expect(response).toMatchObject({ status: 404, body: { error: "Net-worth item not found." } });
    expect(repositories.netWorth.items.get(itemId)?.name).toBe("Savings");
  });
});

describe("net-worth valuation routes", () => {
  it("adds a dated zero valuation", async () => {
    repositories.netWorth.seed(user.id, aManualItem({ id: itemId }));

    const response = await callRoute(addValuation, { method: "POST", params: { id: itemId }, body: { value: "0", valuedOn: "2026-09-20" } });

    const valuation = { id: expect.any(String), itemId, value: "0", valuedOn: "2026-09-20" };
    expect(response).toMatchObject({ status: 201, body: { valuation } });
    expect(repositories.netWorth.valuations.get(response.body.valuation.id)).toEqual(valuation);
  });

  it("refuses a new value for an archived item", async () => {
    repositories.netWorth.seed(user.id, aManualItem({ id: itemId, archivedAt: "2026-09-30T10:00:00Z" }));

    const response = await callRoute(addValuation, { method: "POST", params: { id: itemId }, body: { value: "1", valuedOn: "2026-09-20" } });

    expect(response).toMatchObject({ status: 409, body: { error: "Archived items cannot receive new values." } });
  });

  it("corrects a dated valuation", async () => {
    repositories.netWorth.seed(user.id, aManualItem({ id: itemId, valuations: [aValuation({ id: valuationId, itemId })] }));

    const response = await callRoute(updateValuation, {
      method: "PATCH", params: { id: valuationId }, body: { value: "225000", valuedOn: "2026-09-20" },
    });

    const valuation = { id: valuationId, itemId, value: "225000", valuedOn: "2026-09-20" };
    expect(response).toMatchObject({ status: 200, body: { valuation } });
    expect(repositories.netWorth.valuations.get(valuationId)).toEqual(valuation);
  });

  it("does not correct a valuation on another user's item", async () => {
    repositories.netWorth.seed("someone-else", aManualItem({ id: itemId, valuations: [aValuation({ id: valuationId, itemId })] }));

    const response = await callRoute(updateValuation, {
      method: "PATCH", params: { id: valuationId }, body: { value: "225000", valuedOn: "2026-09-20" },
    });

    expect(response).toMatchObject({ status: 404, body: { error: "Valuation not found." } });
  });
});
