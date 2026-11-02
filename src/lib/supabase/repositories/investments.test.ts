import { beforeEach, describe, expect, it, vi } from "vitest";

import { aTransaction } from "@/test/builders";
import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { supabaseInvestmentRepository as investments } from "@/lib/supabase/repositories/investments";

const userId = "10000000-0000-4000-8000-000000000081";
const otherUserId = "10000000-0000-4000-8000-000000000082";
const ACCOUNT_ID = "20000000-0000-4000-8000-000000000081";
const asset = { accountId: ACCOUNT_ID, instrument: "VWCE.DE", currency: "EUR" };
const limits = { accounts: 2, transactionsPerAccount: 5_000 };

/** A transaction row as the database stores it. */
function transactionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    investment_account_id: ACCOUNT_ID,
    instrument: "VWCE.DE",
    currency: "EUR",
    side: "buy",
    amount: 150,
    quantity: 1.5,
    unit_price: 100,
    executed_at: "2026-01-01T10:00:00Z",
    ...overrides,
  };
}

/** The domain transaction for `transactionRow(overrides)`. */
const transactionFor = (overrides: Partial<ReturnType<typeof aTransaction>> = {}) =>
  aTransaction({ id: "30000000-0000-4000-8000-000000000001", investmentAccountId: ACCOUNT_ID, ...overrides });

function useDatabase(tables: Record<string, Record<string, unknown>[]>, options?: FakeSupabaseOptions) {
  const database = fakeSupabase(tables, options);
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

describe("Supabase investment repository", () => {
  beforeEach(() => vi.resetAllMocks());

  describe("listAccountsWithTransactions", () => {
    it("reads only the user's accounts, each with its transactions oldest first", async () => {
      const later = transactionRow({ id: "30000000-0000-4000-8000-000000000002", executed_at: "2026-02-01T10:00:00Z" });
      const { queries } = useDatabase({
        investment_accounts: [
          { id: "other-account", user_id: otherUserId, broker_id: "xtb", investment_transactions: [] },
          { id: ACCOUNT_ID, user_id: userId, broker_id: "xtb", investment_transactions: [later, transactionRow()] },
        ],
      });

      const accounts = await investments.listAccountsWithTransactions(userId, limits);

      expect(accounts).toEqual([{
        account: { id: ACCOUNT_ID, brokerId: "xtb" },
        transactions: [transactionFor(), transactionFor({ id: later.id, executedAt: later.executed_at })],
      }]);
      expect(queries[0]).toMatchObject({
        table: "investment_accounts",
        filters: [["eq", "user_id", userId]],
        orders: ["broker_id", "investment_transactions.executed_at", "investment_transactions.id"],
        limits: ["2", "investment_transactions:5000"],
      });
    });

    it("rejects an account with a broker this version does not know", async () => {
      useDatabase({ investment_accounts: [{ id: ACCOUNT_ID, user_id: userId, broker_id: "unknown", investment_transactions: [] }] });

      await expect(investments.listAccountsWithTransactions(userId, limits)).rejects.toThrow(new Error("Unable to load investments."));
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase({}, { fail: () => true });

      await expect(investments.listAccountsWithTransactions(userId, limits)).rejects.toThrow(new Error("Unable to load investments."));
    });
  });

  describe("getAssetHistory", () => {
    const account = (owner: string, transactions = [transactionRow()]) =>
      ({ id: ACCOUNT_ID, user_id: owner, broker_id: "xtb", investment_transactions: transactions });

    it("reads one asset of the user's account, newest first", async () => {
      const later = transactionRow({ id: "30000000-0000-4000-8000-000000000002", executed_at: "2026-02-01T10:00:00Z" });
      const otherAsset = transactionRow({ id: "30000000-0000-4000-8000-000000000003", instrument: "AAPL.US", currency: "USD" });
      const { queries } = useDatabase({ investment_accounts: [account(userId, [transactionRow(), otherAsset, later])] });

      const history = await investments.getAssetHistory(userId, asset, 5_000);

      expect(history).toEqual({
        account: { id: ACCOUNT_ID, brokerId: "xtb" },
        transactions: [transactionFor({ id: later.id, executedAt: later.executed_at }), transactionFor()],
      });
      expect(queries[0]).toMatchObject({
        table: "investment_accounts",
        filters: [
          ["eq", "id", ACCOUNT_ID],
          ["eq", "user_id", userId],
          ["eq", "investment_transactions.instrument", "VWCE.DE"],
          ["eq", "investment_transactions.currency", "EUR"],
        ],
        orders: ["investment_transactions.executed_at", "investment_transactions.id"],
        limits: ["investment_transactions:5000"],
      });
    });

    it("returns null for another user's account", async () => {
      useDatabase({ investment_accounts: [account(otherUserId)] });

      expect(await investments.getAssetHistory(userId, asset, 5_000)).toBeNull();
    });

    it("returns null when the account holds no transactions for the asset", async () => {
      useDatabase({ investment_accounts: [account(userId, [transactionRow({ instrument: "AAPL.US" })])] });

      expect(await investments.getAssetHistory(userId, asset, 5_000)).toBeNull();
    });

    it("returns null for an account with a broker this version does not know", async () => {
      useDatabase({ investment_accounts: [{ ...account(userId), broker_id: "unknown" }] });

      expect(await investments.getAssetHistory(userId, asset, 5_000)).toBeNull();
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase({}, { fail: () => true });

      await expect(investments.getAssetHistory(userId, asset, 5_000)).rejects.toThrow(
        new Error("Unable to load investment transactions."),
      );
    });
  });

  describe("getOrCreateAccount", () => {
    it("returns the user's existing account at the broker", async () => {
      const { queries } = useDatabase({
        investment_accounts: [
          { id: "other-account", user_id: otherUserId, broker_id: "xtb" },
          { id: ACCOUNT_ID, user_id: userId, broker_id: "xtb" },
        ],
      });

      expect(await investments.getOrCreateAccount(userId, "xtb")).toEqual({ id: ACCOUNT_ID, brokerId: "xtb" });
      expect(queries).toHaveLength(1);
      expect(queries[0].filters).toEqual([["eq", "user_id", userId], ["eq", "broker_id", "xtb"]]);
    });

    it("creates the account for the user on first use", async () => {
      const { tables } = useDatabase({ investment_accounts: [{ id: "other-account", user_id: otherUserId, broker_id: "xtb" }] });

      const account = await investments.getOrCreateAccount(userId, "xtb");

      expect(tables.investment_accounts).toContainEqual({ id: account.id, user_id: userId, broker_id: "xtb" });
    });

    it("re-reads the account when a parallel request created it first", async () => {
      const raced =fakeSupabase({ investment_accounts: [{ id: ACCOUNT_ID, user_id: userId, broker_id: "xtb" }] });
      const failedInsert = {
        from: () => ({
          insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }) }) }),
        }),
      };
      mocks.createClient
        .mockResolvedValueOnce(fakeSupabase({ investment_accounts: [] }).client)
        .mockResolvedValueOnce(failedInsert)
        .mockResolvedValueOnce(raced.client);

      expect(await investments.getOrCreateAccount(userId, "xtb")).toEqual({ id: ACCOUNT_ID, brokerId: "xtb" });
      expect(raced.queries[0].filters).toEqual([["eq", "user_id", userId], ["eq", "broker_id", "xtb"]]);
    });

    it("hides a failed insert behind a generic message", async () => {
      useDatabase({ investment_accounts: [] }, { fail: (query) => query.operation === "insert" });

      await expect(investments.getOrCreateAccount(userId, "xtb")).rejects.toThrow(
        new Error("Unable to create investment account."),
      );
    });

    it("hides a failed read behind a generic message", async () => {
      useDatabase({}, { fail: () => true });

      await expect(investments.getOrCreateAccount(userId, "xtb")).rejects.toThrow(
        new Error("Unable to load investment account."),
      );
    });
  });

  describe("createTransaction", () => {
    it("records the order through record_investment_order", async () => {
      const { rpcs, queries } = useDatabase({});

      await investments.createTransaction(userId, transactionFor());

      expect(rpcs).toEqual([{
        fn: "record_investment_order",
        args: {
          p_id: "30000000-0000-4000-8000-000000000001",
          p_account_id: ACCOUNT_ID,
          p_instrument: "VWCE.DE",
          p_currency: "EUR",
          p_side: "buy",
          p_amount: "150",
          p_quantity: "1.5",
          p_unit_price: "100",
          p_executed_at: "2026-01-01T10:00:00Z",
        },
      }]);
      expect(queries).toEqual([]);
    });

    it("turns the function's oversell refusal into a quantity error", async () => {
      const message = "Sell quantity exceeds the available VWCE.DE position.";
      useDatabase({}, { rpc: () => ({ data: null, error: { code: "23514", message, hint: "user" } }) });

      await expect(investments.createTransaction(userId, transactionFor({ side: "sell" }))).rejects.toMatchObject({
        name: "DomainError", message, status: 422, fieldErrors: { quantity: [message] },
      });
    });

    it("keeps a table check's own message private", async () => {
      useDatabase({}, { rpc: () => ({ data: null, error: { code: "23514", message: "violates check constraint \"amount_positive\"" } }) });

      await expect(investments.createTransaction(userId, transactionFor())).rejects.toMatchObject({
        name: "DomainError", message: "The investment order could not be saved.", status: 422, fieldErrors: undefined,
      });
    });

    it("reports an account that isn't the user's as not found", async () => {
      useDatabase({}, { rpc: () => ({ data: null, error: { code: "P0002", message: "That investment account wasn't found.", hint: "user" } }) });

      await expect(investments.createTransaction(userId, transactionFor())).rejects.toMatchObject({
        message: "That investment account wasn't found.", status: 404,
      });
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase({}, { rpc: () => ({ data: null, error: { message: "private" } }) });

      await expect(investments.createTransaction(userId, transactionFor())).rejects.toThrow(
        new Error("The investment order could not be saved."),
      );
    });
  });

  describe("deleteTransaction", () => {
    it("deletes the order through delete_investment_order", async () => {
      const { rpcs } = useDatabase({}, { rpc: () => ({ data: true, error: null }) });

      expect(await investments.deleteTransaction(userId, transactionFor().id)).toBe(true);
      expect(rpcs).toEqual([{ fn: "delete_investment_order", args: { p_transaction_id: transactionFor().id } }]);
    });

    it("returns false when the user has no such order", async () => {
      useDatabase({}, { rpc: () => ({ data: false, error: null }) });

      expect(await investments.deleteTransaction(userId, transactionFor().id)).toBe(false);
    });

    it("turns the function's refusal into a quantity error", async () => {
      const message = "This order cannot be removed because it would invalidate the later history: Sell quantity exceeds the available VWCE.DE position.";
      useDatabase({}, { rpc: () => ({ data: null, error: { code: "23514", message, hint: "user" } }) });

      await expect(investments.deleteTransaction(userId, transactionFor().id)).rejects.toMatchObject({
        message, status: 422, fieldErrors: { quantity: [message] },
      });
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase({}, { rpc: () => ({ data: null, error: { message: "private" } }) });

      await expect(investments.deleteTransaction(userId, transactionFor().id)).rejects.toThrow(
        new Error("Unable to remove investment order."),
      );
    });
  });
});
