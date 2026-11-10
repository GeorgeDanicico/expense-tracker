import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import type { Quote } from "@/lib/investments/quotes/types";
import { aTransaction } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

const quotes = vi.hoisted(() => ({ getQuotes: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
vi.mock("@/lib/investments/quotes/get-adapter", () => ({ getInvestmentQuoteAdapter: () => quotes }));

import {
  createInvestmentTransaction,
  deleteInvestmentTransaction,
  getInvestmentsOverview,
  getInvestmentTransactions,
  MAX_ACCOUNTS,
  MAX_TRANSACTIONS_PER_ACCOUNT,
  TOO_MANY_ORDERS_MESSAGE,
} from "@/lib/investments/service";

const USER = "owner";
const XTB = "20000000-0000-4000-8000-000000000001";
const buy = aTransaction({ id: "30000000-0000-4000-8000-000000000001", investmentAccountId: XTB });
const sell = aTransaction({
  id: "30000000-0000-4000-8000-000000000002",
  investmentAccountId: XTB,
  side: "sell",
  amount: "110",
  quantity: "1",
  unitPrice: "110",
  executedAt: "2026-02-01T10:00:00Z",
});
const order = {
  brokerId: "xtb" as const,
  instrument: "VWCE.DE",
  currency: "EUR",
  side: "buy" as const,
  amount: "150",
  quantity: "1.5",
  unitPrice: "100",
  executedAt: "2026-01-01T10:00:00.000Z",
};
const quote: Quote = { instrument: "VWCE.DE", price: "120", currency: "EUR", asOf: "2026-10-01T00:00:00Z", source: "YAHOO_FINANCE" };

let repositories: FakeRepositories;

/** `count` buys of one unit, a second apart. */
function manyBuys(count: number) {
  return Array.from({ length: count }, (_, index) => aTransaction({
    id: `30000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    investmentAccountId: XTB,
    amount: "100",
    quantity: "1",
    unitPrice: "100",
    executedAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
  }));
}

function seedAccount(userId: string, transactions = [buy]) {
  repositories.investments.accounts.push({ id: XTB, userId, brokerId: "xtb" });
  repositories.investments.transactions.push(...transactions);
}

beforeEach(() => {
  vi.clearAllMocks();
  repositories = resetFakeRepositories();
  quotes.getQuotes.mockResolvedValue(new Map([[quote.instrument, quote]]));
});

describe("getInvestmentsOverview", () => {
  it("values the user's positions with current quotes", async () => {
    seedAccount(USER);

    const overview = await getInvestmentsOverview(USER);

    expect(overview.brokers).toEqual([expect.objectContaining({ accountId: XTB, brokerId: "xtb" })]);
    expect(overview.brokers[0].assets).toEqual([expect.objectContaining({
      instrument: "VWCE.DE", quantity: "1.5", remainingCost: "150", currentPrice: "120", currentValue: "180", priceStatus: "current",
    })]);
    expect(quotes.getQuotes).toHaveBeenCalledWith(["VWCE.DE"]);
  });

  it("leaves out other users' accounts", async () => {
    seedAccount("someone-else");

    expect(await getInvestmentsOverview(USER)).toEqual({ brokers: [], calculationIssues: [] });
  });

  it("reads one transaction more than every account at its limit, so a cut history shows (B11)", async () => {
    const list = vi.spyOn(repositories.investments, "listAccountsWithTransactions");

    await getInvestmentsOverview(USER);

    expect(list).toHaveBeenCalledWith(USER, { accounts: MAX_ACCOUNTS, transactions: MAX_ACCOUNTS * MAX_TRANSACTIONS_PER_ACCOUNT + 1 });
  });

  it("refuses with a 409, instead of positions from part of the history, an account over the limit (B11)", async () => {
    seedAccount(USER, manyBuys(MAX_TRANSACTIONS_PER_ACCOUNT + 1));

    await expect(getInvestmentsOverview(USER)).rejects.toEqual(new DomainError(TOO_MANY_ORDERS_MESSAGE, 409));
  });

  it("shows an account at exactly the limit", async () => {
    seedAccount(USER, manyBuys(MAX_TRANSACTIONS_PER_ACCOUNT));

    const overview = await getInvestmentsOverview(USER);

    expect(overview.brokers[0].assets[0]).toMatchObject({ quantity: String(MAX_TRANSACTIONS_PER_ACCOUNT) });
  });

  it("marks prices unavailable when the price service is down", async () => {
    seedAccount(USER);
    quotes.getQuotes.mockRejectedValue(new Error("price service down"));

    const overview = await getInvestmentsOverview(USER);

    expect(overview.brokers[0].assets[0]).toMatchObject({ remainingCost: "150", currentPrice: null, priceStatus: "unavailable" });
  });
});

describe("getInvestmentTransactions", () => {
  const asset = { accountId: XTB, instrument: "VWCE.DE", currency: "EUR" };

  it("returns one asset's orders newest first, with the broker", async () => {
    seedAccount(USER, [buy, sell]);

    expect(await getInvestmentTransactions(USER, asset)).toEqual({
      ...asset,
      transactions: [{ ...sell, brokerId: "xtb" }, { ...buy, brokerId: "xtb" }],
    });
  });

  it("returns null for another user's account", async () => {
    seedAccount("someone-else");

    expect(await getInvestmentTransactions(USER, asset)).toBeNull();
  });

  it("refuses with a 409 an asset with more orders than the limit, instead of leaving the oldest out (B11)", async () => {
    seedAccount(USER, manyBuys(MAX_TRANSACTIONS_PER_ACCOUNT + 1));

    await expect(getInvestmentTransactions(USER, asset)).rejects.toEqual(new DomainError(TOO_MANY_ORDERS_MESSAGE, 409));
  });
});

describe("createInvestmentTransaction", () => {
  it("creates the broker account on the first order and saves the order in it", async () => {
    const { transaction } = await createInvestmentTransaction(USER, order);

    const [account] = repositories.investments.accounts;
    expect(account).toMatchObject({ userId: USER, brokerId: "xtb" });
    expect(transaction).toEqual({ ...order, id: expect.any(String), investmentAccountId: account.id });
    expect(repositories.investments.transactions).toEqual([
      expect.objectContaining({ id: transaction.id, investmentAccountId: account.id, instrument: "VWCE.DE", side: "buy" }),
    ]);
  });

  it("adds to the user's existing account at the broker", async () => {
    seedAccount(USER);

    await createInvestmentTransaction(USER, {
      ...order, side: "sell", amount: "110", quantity: "1", unitPrice: "110", executedAt: "2026-02-01T10:00:00.000Z",
    });

    expect(repositories.investments.accounts).toHaveLength(1);
    expect(repositories.investments.transactions.map((transaction) => transaction.investmentAccountId)).toEqual([XTB, XTB]);
  });

  it("rejects a sale larger than the position with a quantity error, saving nothing", async () => {
    const message = "Sell quantity exceeds the available VWCE.DE position.";

    const result = createInvestmentTransaction(USER, { ...order, side: "sell" });

    await expect(result).rejects.toThrow(DomainError);
    await expect(result).rejects.toMatchObject({ message, status: 422, fieldErrors: { quantity: [message] } });
    expect(repositories.investments.transactions).toEqual([]);
  });

  it("refuses one of two sells of the whole position made at once", async () => {
    seedAccount(USER);
    const sellAll = { ...order, side: "sell" as const, amount: "165", quantity: "1.5", unitPrice: "110", executedAt: "2026-02-01T10:00:00.000Z" };

    const results = await Promise.allSettled([createInvestmentTransaction(USER, sellAll), createInvestmentTransaction(USER, sellAll)]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(repositories.investments.transactions.filter((transaction) => transaction.side === "sell")).toHaveLength(1);
  });
});

describe("deleteInvestmentTransaction", () => {
  it("deletes the user's order", async () => {
    seedAccount(USER, [buy, sell]);

    expect(await deleteInvestmentTransaction(USER, sell.id)).toBe(true);
    expect(repositories.investments.transactions).toEqual([buy]);
  });

  it("returns false for another user's order, keeping it", async () => {
    seedAccount("someone-else");

    expect(await deleteInvestmentTransaction(USER, buy.id)).toBe(false);
    expect(repositories.investments.transactions).toEqual([buy]);
  });

  it("returns false for an order that does not exist", async () => {
    expect(await deleteInvestmentTransaction(USER, buy.id)).toBe(false);
  });

  it("rejects removing a purchase a later sale depends on", async () => {
    seedAccount(USER, [buy, sell]);
    const message = "This order cannot be removed because it would invalidate the later history: Sell quantity exceeds the available VWCE.DE position.";

    await expect(deleteInvestmentTransaction(USER, buy.id)).rejects.toMatchObject({ message, status: 422, fieldErrors: { quantity: [message] } });
    expect(repositories.investments.transactions).toEqual([buy, sell]);
  });
});
