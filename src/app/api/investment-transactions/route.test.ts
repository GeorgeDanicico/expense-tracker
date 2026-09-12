import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class InvestmentMutationError extends Error {
    status: 404 | 409 | 422;
    fieldErrors?: Record<string, string[]>;

    constructor(message: string, status: 404 | 409 | 422, fieldErrors?: Record<string, string[]>) {
      super(message);
      this.name = "InvestmentMutationError";
      this.status = status;
      this.fieldErrors = fieldErrors;
    }
  }

  return {
    getAuthenticatedUser: vi.fn(),
    getInvestmentTransactionsForUser: vi.fn(),
    createInvestmentTransactionForUser: vi.fn(),
    deleteInvestmentTransactionForUser: vi.fn(),
    InvestmentMutationError,
  };
});

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/data/investments", () => ({
  createInvestmentTransactionForUser: mocks.createInvestmentTransactionForUser,
  deleteInvestmentTransactionForUser: mocks.deleteInvestmentTransactionForUser,
  getInvestmentTransactionsForUser: mocks.getInvestmentTransactionsForUser,
  InvestmentMutationError: mocks.InvestmentMutationError,
}));

import { DELETE } from "@/app/api/investment-transactions/[id]/route";
import { GET, POST } from "@/app/api/investment-transactions/route";

const user = { id: "10000000-0000-0000-0000-000000000001", email: "investor@example.test" };
const transaction = {
  id: "30000000-0000-4000-8000-000000000001",
  investmentAccountId: "20000000-0000-4000-8000-000000000001",
  brokerId: "xtb" as const,
  instrument: "VWCE.DE",
  currency: "EUR",
  side: "buy" as const,
  amount: "150",
  quantity: "1.5",
  unitPrice: "100",
  executedAt: "2026-01-01T10:00:00.000Z",
};

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("investment transaction routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated writes", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const response = await POST(jsonRequest("http://localhost/api/investment-transactions", "POST", {}));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(mocks.createInvestmentTransactionForUser).not.toHaveBeenCalled();
  });

  it("returns field-level validation errors for malformed orders", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(user);

    const response = await POST(jsonRequest("http://localhost/api/investment-transactions", "POST", {
      brokerId: "xtb",
      instrument: "aapl.us",
      currency: "usd",
      side: "sell",
      amount: "0",
      quantity: "1",
      unitPrice: "10",
      executedAt: "not-a-date",
    }));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.error).toContain("highlighted");
    expect(payload.fieldErrors.amount).toBeDefined();
    expect(payload.fieldErrors.executedAt).toBeDefined();
    expect(mocks.createInvestmentTransactionForUser).not.toHaveBeenCalled();
  });

  it("normalizes a valid order and returns the created transaction", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(user);
    mocks.createInvestmentTransactionForUser.mockResolvedValue({ transaction });

    const response = await POST(jsonRequest("http://localhost/api/investment-transactions", "POST", {
      brokerId: "xtb",
      instrument: " vwce.de ",
      currency: "eur",
      side: "buy",
      amount: "150.0000000000",
      quantity: "1.5",
      unitPrice: "100",
      executedAt: "2026-01-01T10:00:00Z",
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.transaction).toEqual(transaction);
    expect(mocks.createInvestmentTransactionForUser).toHaveBeenCalledWith(user.id, {
      brokerId: "xtb",
      instrument: "VWCE.DE",
      currency: "EUR",
      side: "buy",
      amount: "150.0000000000",
      quantity: "1.5",
      unitPrice: "100",
      executedAt: "2026-01-01T10:00:00.000Z",
    });
  });

  it("surfaces chronological oversell errors from the data layer", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(user);
    mocks.createInvestmentTransactionForUser.mockRejectedValue(
      new mocks.InvestmentMutationError("Sell quantity exceeds the available VWCE.DE position.", 422, {
        quantity: ["Sell quantity exceeds the available VWCE.DE position."],
      }),
    );

    const response = await POST(jsonRequest("http://localhost/api/investment-transactions", "POST", {
      brokerId: "xtb",
      instrument: "VWCE.DE",
      currency: "EUR",
      side: "sell",
      amount: "100",
      quantity: "2",
      unitPrice: "50",
      executedAt: "2026-01-02T10:00Z",
    }));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.error).toContain("Sell quantity exceeds");
    expect(payload.fieldErrors.quantity).toHaveLength(1);
  });

  it("returns only the owned asset history", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(user);
    mocks.getInvestmentTransactionsForUser.mockResolvedValue({
      accountId: transaction.investmentAccountId,
      instrument: transaction.instrument,
      currency: transaction.currency,
      transactions: [transaction],
    });

    const response = await GET(new NextRequest(
      `http://localhost/api/investment-transactions?accountId=${transaction.investmentAccountId}&instrument=${transaction.instrument}&currency=${transaction.currency}`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ transactions: [transaction] });
    expect(mocks.getInvestmentTransactionsForUser).toHaveBeenCalledWith(user.id, {
      accountId: transaction.investmentAccountId,
      instrument: transaction.instrument,
      currency: transaction.currency,
    });
  });
});

describe("investment transaction deletion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(user);
  });

  it("rejects malformed identifiers before touching the data layer", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/investment-transactions/not-a-uuid"),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.deleteInvestmentTransactionForUser).not.toHaveBeenCalled();
  });

  it("returns not found for another user's order", async () => {
    mocks.deleteInvestmentTransactionForUser.mockResolvedValue(false);

    const response = await DELETE(
      new Request(`http://localhost/api/investment-transactions/${transaction.id}`),
      { params: Promise.resolve({ id: transaction.id }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.deleteInvestmentTransactionForUser).toHaveBeenCalledWith(user.id, transaction.id);
  });

  it("returns 204 after a guarded deletion", async () => {
    mocks.deleteInvestmentTransactionForUser.mockResolvedValue(true);

    const response = await DELETE(
      new Request(`http://localhost/api/investment-transactions/${transaction.id}`),
      { params: Promise.resolve({ id: transaction.id }) },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.text()).toBe("");
  });

  it("surfaces a deletion conflict without deleting", async () => {
    mocks.deleteInvestmentTransactionForUser.mockRejectedValue(
      new mocks.InvestmentMutationError("This order would invalidate the later history.", 409),
    );

    const response = await DELETE(
      new Request(`http://localhost/api/investment-transactions/${transaction.id}`),
      { params: Promise.resolve({ id: transaction.id }) },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("invalidate");
  });
});
