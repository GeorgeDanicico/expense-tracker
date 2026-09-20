import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class NetWorthMutationError extends Error {
    status: 404 | 409 | 422;
    fieldErrors?: Record<string, string[]>;

    constructor(message: string, status: 404 | 409 | 422, fieldErrors?: Record<string, string[]>) {
      super(message);
      this.name = "NetWorthMutationError";
      this.status = status;
      this.fieldErrors = fieldErrors;
    }
  }

  return {
    getAuthenticatedUser: vi.fn(),
    getNetWorthOverviewForUser: vi.fn(),
    createNetWorthItemForUser: vi.fn(),
    updateNetWorthItemForUser: vi.fn(),
    addNetWorthValuationForUser: vi.fn(),
    updateNetWorthValuationForUser: vi.fn(),
    NetWorthMutationError,
  };
});

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/data/net-worth", () => ({
  getNetWorthOverviewForUser: mocks.getNetWorthOverviewForUser,
  createNetWorthItemForUser: mocks.createNetWorthItemForUser,
  updateNetWorthItemForUser: mocks.updateNetWorthItemForUser,
  addNetWorthValuationForUser: mocks.addNetWorthValuationForUser,
  updateNetWorthValuationForUser: mocks.updateNetWorthValuationForUser,
  NetWorthMutationError: mocks.NetWorthMutationError,
}));

import { GET as getOverview } from "@/app/api/net-worth/route";
import { POST as createItem } from "@/app/api/net-worth/items/route";
import { PATCH as updateItem } from "@/app/api/net-worth/items/[id]/route";
import { POST as addValuation } from "@/app/api/net-worth/items/[id]/valuations/route";
import { PATCH as updateValuation } from "@/app/api/net-worth/valuations/[id]/route";

const user = { id: "10000000-0000-0000-0000-000000000001", email: "owner@example.test" };
const itemId = "40000000-0000-4000-8000-000000000001";
const valuationId = "50000000-0000-4000-8000-000000000001";

const overview = {
  entries: [],
  totalsByCurrency: [],
  attention: [],
  calculationIssues: [],
};

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("net-worth overview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(user);
  });

  it("rejects unauthenticated reads", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const response = await getOverview();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(mocks.getNetWorthOverviewForUser).not.toHaveBeenCalled();
  });

  it("returns the composed overview with private cache headers", async () => {
    mocks.getNetWorthOverviewForUser.mockResolvedValue(overview);

    const response = await getOverview();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual(overview);
    expect(mocks.getNetWorthOverviewForUser).toHaveBeenCalledWith(user.id);
  });
});
describe("net-worth item routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(user);
  });

  it("normalizes a valid item before calling the data layer", async () => {
    mocks.createNetWorthItemForUser.mockResolvedValue({ itemId });

    const response = await createItem(jsonRequest("http://localhost/api/net-worth/items", "POST", {
      name: "  Apartment  ",
      kind: "asset",
      category: "Current account",
      currency: "eur",
      value: "1250.5000000000",
      valuedOn: "2026-09-19",
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ itemId });
    expect(mocks.createNetWorthItemForUser).toHaveBeenCalledWith(user.id, {
      name: "Apartment",
      kind: "asset",
      category: "current-account",
      currency: "EUR",
      purchaseAmount: null,
      value: "1250.5000000000",
      valuedOn: "2026-09-19",
    });
  });

  it("rejects purchase amounts for cash without touching the data layer", async () => {
    const response = await createItem(jsonRequest("http://localhost/api/net-worth/items", "POST", {
      name: "Cash",
      kind: "asset",
      category: "cash",
      currency: "EUR",
      purchaseAmount: "10",
      value: "10",
      valuedOn: "2026-09-19",
    }));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.fieldErrors.purchaseAmount).toBeDefined();
    expect(mocks.createNetWorthItemForUser).not.toHaveBeenCalled();
  });

  it("updates an owned item and preserves cache headers", async () => {
    mocks.updateNetWorthItemForUser.mockResolvedValue(true);

    const response = await updateItem(
      jsonRequest(`http://localhost/api/net-worth/items/${itemId}`, "PATCH", {
        name: "Current account",
        category: "Emergency Cash",
      }),
      { params: Promise.resolve({ id: itemId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(mocks.updateNetWorthItemForUser).toHaveBeenCalledWith(user.id, itemId, {
      name: "Current account",
      category: "emergency-cash",
    });
  });
});

describe("net-worth valuation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(user);
  });

  it("adds a dated zero valuation", async () => {
    const valuation = { id: valuationId, itemId, value: "0", valuedOn: "2026-09-20" };
    mocks.addNetWorthValuationForUser.mockResolvedValue(valuation);

    const response = await addValuation(
      jsonRequest(`http://localhost/api/net-worth/items/${itemId}/valuations`, "POST", {
        value: "0",
        valuedOn: "2026-09-20",
      }),
      { params: Promise.resolve({ id: itemId }) },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ valuation });
    expect(mocks.addNetWorthValuationForUser).toHaveBeenCalledWith(user.id, itemId, {
      value: "0",
      valuedOn: "2026-09-20",
    });
  });

  it("corrects a dated valuation", async () => {
    const valuation = { id: valuationId, itemId, value: "225000", valuedOn: "2026-09-20" };
    mocks.updateNetWorthValuationForUser.mockResolvedValue(valuation);

    const response = await updateValuation(
      jsonRequest(`http://localhost/api/net-worth/valuations/${valuationId}`, "PATCH", {
        value: "225000",
        valuedOn: "2026-09-20",
      }),
      { params: Promise.resolve({ id: valuationId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateNetWorthValuationForUser).toHaveBeenCalledWith(user.id, valuationId, {
      value: "225000",
      valuedOn: "2026-09-20",
    });
  });
});
