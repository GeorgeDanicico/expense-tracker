import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aKid, aParent, aTransaction } from "@/test/builders";
import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { DELETE } from "@/app/api/investment-transactions/[id]/route";
import { GET, POST } from "@/app/api/investment-transactions/route";

const ACCOUNT_ID = "20000000-0000-4000-8000-000000000001";
const transaction = aTransaction({
  id: "30000000-0000-4000-8000-000000000001",
  investmentAccountId: ACCOUNT_ID,
  executedAt: "2026-01-01T10:00:00.000Z",
});
const order = { brokerId: "xtb", instrument: "VWCE.DE", currency: "EUR", side: "buy", amount: "150", quantity: "1.5", unitPrice: "100", executedAt: "2026-01-01T10:00:00Z" };
const createOrder = (body: unknown) => callRoute(POST, { method: "POST", url: "/api/investment-transactions", body });
const deleteOrder = (id: string) => callRoute(DELETE, { method: "DELETE", url: `/api/investment-transactions/${id}`, params: { id } });

let repositories: FakeRepositories;
let user: ReturnType<typeof signedInAs>;

/** Seeds an XTB account for `userId` holding `transactions`. */
function seedAccount(userId: string, transactions = [transaction]) {
  repositories.investments.accounts.push({ id: ACCOUNT_ID, userId, brokerId: "xtb" });
  repositories.investments.transactions.push(...transactions);
}

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  user = signedInAs();
});

describe("POST /api/investment-transactions", () => {
  it("returns field-level validation errors for a malformed order", async () => {
    const response = await createOrder({ ...order, instrument: "aapl.us", side: "sell", amount: "0", executedAt: "not-a-date" });

    expect(response.status).toBe(422);
    expect(response.body.error).toContain("highlighted");
    expect(Object.keys(response.body.fieldErrors)).toEqual(expect.arrayContaining(["amount", "executedAt"]));
    expect(repositories.investments.accounts).toEqual([]);
    expect(repositories.investments.transactions).toEqual([]);
  });

  it("normalizes a valid order before saving it for the signed-in user", async () => {
    await createOrder({ ...order, instrument: " vwce.de ", currency: "eur", amount: "150.0000000000" });

    const [account] = repositories.investments.accounts;
    expect(account).toMatchObject({ userId: user.id, brokerId: "xtb" });
    expect(repositories.investments.transactions).toEqual([{
      id: expect.any(String),
      investmentAccountId: account.id,
      instrument: "VWCE.DE",
      currency: "EUR",
      side: "buy",
      amount: "150.0000000000",
      quantity: "1.5",
      unitPrice: "100",
      executedAt: "2026-01-01T10:00:00.000Z",
    }]);
  });

  it("responds 201 with the created transaction", async () => {
    const response = await createOrder(order);

    const [stored] = repositories.investments.transactions;
    expect(response).toMatchObject({ status: 201, body: { transaction: { ...stored, brokerId: "xtb" } } });
  });

  it("passes an oversell rejection from the data layer through with its field errors", async () => {
    const message = "Sell quantity exceeds the available VWCE.DE position.";

    const response = await createOrder({ ...order, side: "sell", amount: "100", quantity: "2", unitPrice: "50" });

    expect(response).toMatchObject({ status: 422, body: { error: message, fieldErrors: { quantity: [message] } } });
  });
});

describe("GET /api/investment-transactions", () => {
  it("returns the signed-in user's history for one asset", async () => {
    seedAccount(user.id);
    const asset = { accountId: transaction.investmentAccountId, instrument: transaction.instrument, currency: transaction.currency };

    const response = await callRoute(GET, { url: `/api/investment-transactions?${new URLSearchParams(asset)}` });

    expect(response).toMatchObject({ status: 200, body: { ...asset, transactions: [{ ...transaction, brokerId: "xtb" }] } });
  });

  it("returns 404 for another user's asset", async () => {
    seedAccount("someone-else");
    const asset = { accountId: transaction.investmentAccountId, instrument: transaction.instrument, currency: transaction.currency };

    const response = await callRoute(GET, { url: `/api/investment-transactions?${new URLSearchParams(asset)}` });

    expect(response).toMatchObject({ status: 404, body: { error: "Investment asset not found." } });
  });
});

describe("DELETE /api/investment-transactions/[id]", () => {
  it("rejects a malformed id before touching the data layer", async () => {
    const findTransaction = vi.spyOn(repositories.investments, "findTransaction");

    const response = await deleteOrder("not-a-uuid");

    expect(response.status).toBe(400);
    expect(findTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 for another user's order", async () => {
    seedAccount("someone-else");

    const response = await deleteOrder(transaction.id);

    expect(response.status).toBe(404);
    expect(repositories.investments.transactions).toEqual([transaction]);
  });

  it("returns an empty 204 after deleting", async () => {
    seedAccount(user.id);

    const response = await deleteOrder(transaction.id);

    expect(response).toMatchObject({ status: 204, body: null });
    expect(repositories.investments.transactions).toEqual([]);
  });

  it("returns 409 when deleting would invalidate later history", async () => {
    // A stored order the calculation cannot read, after the one being removed.
    const unreadable = aTransaction({ id: "30000000-0000-4000-8000-000000000002", investmentAccountId: ACCOUNT_ID, executedAt: "not-a-date" });
    seedAccount(user.id, [transaction, unreadable]);

    const response = await deleteOrder(transaction.id);

    expect(response).toMatchObject({
      status: 409,
      body: { error: "This order cannot be removed because it would invalidate the later history: executedAt must be a valid timestamp." },
    });
    expect(repositories.investments.transactions).toHaveLength(2);
  });
});

describe("investment transactions in a family", () => {
  beforeEach(() => vi.stubEnv("FAMILY_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a kid with investments off and saves nothing", async () => {
    repositories.family.membership = aKid({ permissions: { expenses: "edit", investments: "off", net_worth: "off", family_finance: "off" } });

    const response = await createOrder(order);

    expect(response).toMatchObject({ status: 403, body: { error: "You don't have access to this." } });
    expect(repositories.investments.transactions).toEqual([]);
  });

  it("refuses a kid with investments off when deleting an order", async () => {
    repositories.family.membership = aKid({ permissions: { expenses: "edit", investments: "off", net_worth: "off", family_finance: "off" } });
    seedAccount(user.id);

    const response = await deleteOrder(transaction.id);

    expect(response.status).toBe(403);
    expect(repositories.investments.transactions).toEqual([transaction]);
  });

  it("saves the order for a kid with investments on", async () => {
    repositories.family.membership = aKid({ permissions: { expenses: "off", investments: "edit", net_worth: "off", family_finance: "off" } });

    expect((await createOrder(order)).status).toBe(201);
  });

  it("saves the order for a parent, as before", async () => {
    repositories.family.membership = aParent();

    expect((await createOrder(order)).status).toBe(201);
  });

  it("saves the order for a user without a family, as before", async () => {
    expect((await createOrder(order)).status).toBe(201);
    expect(repositories.family.calls).toEqual(["touchLastActive", "getMembership"]);
  });
});
