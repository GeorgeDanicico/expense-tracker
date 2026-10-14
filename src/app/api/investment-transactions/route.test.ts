import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { aTransaction } from "@/test/builders";
import { callRoute, signedInAs } from "@/test/route";

const mocks = vi.hoisted(() => ({
  getInvestmentTransactionsForUser: vi.fn(),
  createInvestmentTransactionForUser: vi.fn(),
  deleteInvestmentTransactionForUser: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/data/investments", () => mocks);

import { DELETE } from "@/app/api/investment-transactions/[id]/route";
import { GET, POST } from "@/app/api/investment-transactions/route";

const transaction = {
  ...aTransaction({
    id: "30000000-0000-4000-8000-000000000001",
    investmentAccountId: "20000000-0000-4000-8000-000000000001",
    executedAt: "2026-01-01T10:00:00.000Z",
  }),
  brokerId: "xtb",
};
const order = { brokerId: "xtb", instrument: "VWCE.DE", currency: "EUR", side: "buy", amount: "150", quantity: "1.5", unitPrice: "100", executedAt: "2026-01-01T10:00:00Z" };
const createOrder = (body: unknown) => callRoute(POST, { method: "POST", url: "/api/investment-transactions", body });
const deleteOrder = (id: string) => callRoute(DELETE, { method: "DELETE", url: `/api/investment-transactions/${id}`, params: { id } });

let user: ReturnType<typeof signedInAs>;

beforeEach(() => {
  vi.clearAllMocks();
  user = signedInAs();
});

describe("POST /api/investment-transactions", () => {
  it("returns field-level validation errors for a malformed order", async () => {
    const response = await createOrder({ ...order, instrument: "aapl.us", side: "sell", amount: "0", executedAt: "not-a-date" });

    expect(response.status).toBe(422);
    expect(response.body.error).toContain("highlighted");
    expect(Object.keys(response.body.fieldErrors)).toEqual(expect.arrayContaining(["amount", "executedAt"]));
    expect(mocks.createInvestmentTransactionForUser).not.toHaveBeenCalled();
  });

  it("normalizes a valid order before saving it for the signed-in user", async () => {
    mocks.createInvestmentTransactionForUser.mockResolvedValue({ transaction });

    await createOrder({ ...order, instrument: " vwce.de ", currency: "eur", amount: "150.0000000000" });

    expect(mocks.createInvestmentTransactionForUser).toHaveBeenCalledWith(user.id, {
      ...order, instrument: "VWCE.DE", currency: "EUR", amount: "150.0000000000", executedAt: "2026-01-01T10:00:00.000Z",
    });
  });

  it("responds 201 with the created transaction", async () => {
    mocks.createInvestmentTransactionForUser.mockResolvedValue({ transaction });

    const response = await createOrder(order);

    expect(response).toMatchObject({ status: 201, body: { transaction } });
  });

  it("passes an oversell rejection from the data layer through with its field errors", async () => {
    const message = "Sell quantity exceeds the available VWCE.DE position.";
    mocks.createInvestmentTransactionForUser.mockRejectedValue(new DomainError(message, 422, { quantity: [message] }));

    const response = await createOrder({ ...order, side: "sell", amount: "100", quantity: "2", unitPrice: "50" });

    expect(response).toMatchObject({ status: 422, body: { error: message, fieldErrors: { quantity: [message] } } });
  });
});

describe("GET /api/investment-transactions", () => {
  it("returns the signed-in user's history for one asset", async () => {
    const asset = { accountId: transaction.investmentAccountId, instrument: transaction.instrument, currency: transaction.currency };
    mocks.getInvestmentTransactionsForUser.mockResolvedValue({ ...asset, transactions: [transaction] });

    const response = await callRoute(GET, { url: `/api/investment-transactions?${new URLSearchParams(asset)}` });

    expect(response).toMatchObject({ status: 200, body: { transactions: [transaction] } });
    expect(mocks.getInvestmentTransactionsForUser).toHaveBeenCalledWith(user.id, asset);
  });
});

describe("DELETE /api/investment-transactions/[id]", () => {
  it("rejects a malformed id before touching the data layer", async () => {
    const response = await deleteOrder("not-a-uuid");

    expect(response.status).toBe(400);
    expect(mocks.deleteInvestmentTransactionForUser).not.toHaveBeenCalled();
  });

  it("returns 404 for another user's order", async () => {
    mocks.deleteInvestmentTransactionForUser.mockResolvedValue(false);

    const response = await deleteOrder(transaction.id);

    expect(response.status).toBe(404);
    expect(mocks.deleteInvestmentTransactionForUser).toHaveBeenCalledWith(user.id, transaction.id);
  });

  it("returns an empty 204 after deleting", async () => {
    mocks.deleteInvestmentTransactionForUser.mockResolvedValue(true);

    const response = await deleteOrder(transaction.id);

    expect(response).toMatchObject({ status: 204, body: null });
  });

  it("returns 409 when deleting would invalidate later history", async () => {
    mocks.deleteInvestmentTransactionForUser.mockRejectedValue(new DomainError("This order would invalidate the later history.", 409));

    const response = await deleteOrder(transaction.id);

    expect(response).toMatchObject({ status: 409, body: { error: "This order would invalidate the later history." } });
  });
});
