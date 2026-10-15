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

/** A transaction row embedding its owning account, as the owner-filtered transaction queries read it. */
const ownedTransactionRow = (owner: string, overrides: Record<string, unknown> = {}) =>
  ({ ...transactionRow(overrides), investment_accounts: { user_id: owner } });

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

  describe("listAssetTransactions", () => {
    it("reads one asset's transactions oldest first, filtered by the owner through the account", async () => {
      const later = ownedTransactionRow(userId, { id: "30000000-0000-4000-8000-000000000002", executed_at: "2026-02-01T10:00:00Z" });
      const { queries } = useDatabase({ investment_transactions: [later, ownedTransactionRow(userId)] });

      const transactions = await investments.listAssetTransactions(userId, asset, 5_000);

      expect(transactions).toEqual([transactionFor(), transactionFor({ id: later.id, executedAt: later.executed_at })]);
      expect(queries[0]).toMatchObject({
        table: "investment_transactions",
        filters: [
          ["eq", "investment_account_id", ACCOUNT_ID],
          ["eq", "investment_accounts.user_id", userId],
          ["eq", "instrument", "VWCE.DE"],
          ["eq", "currency", "EUR"],
        ],
        orders: ["executed_at", "id"],
        limits: ["5000"],
      });
    });

    it("returns nothing from another user's account", async () => {
      useDatabase({ investment_transactions: [ownedTransactionRow(otherUserId)] });

      expect(await investments.listAssetTransactions(userId, asset, 5_000)).toEqual([]);
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase({}, { fail: () => true });

      await expect(investments.listAssetTransactions(userId, asset, 5_000)).rejects.toThrow(
        new Error("Unable to load investment history."),
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

  describe("findTransaction", () => {
    it("reads the transaction filtered by the owner through the account", async () => {
      const { queries } = useDatabase({ investment_transactions: [ownedTransactionRow(userId)] });

      expect(await investments.findTransaction(userId, transactionFor().id)).toEqual(transactionFor());
      expect(queries[0]).toMatchObject({
        table: "investment_transactions",
        filters: [["eq", "id", transactionFor().id], ["eq", "investment_accounts.user_id", userId]],
      });
    });

    it("returns null for another user's transaction", async () => {
      useDatabase({ investment_transactions: [ownedTransactionRow(otherUserId)] });

      expect(await investments.findTransaction(userId, transactionFor().id)).toBeNull();
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase({}, { fail: () => true });

      await expect(investments.findTransaction(userId, transactionFor().id)).rejects.toThrow(
        new Error("Unable to load investment order."),
      );
    });
  });

  describe("createTransaction", () => {
    it("stores the transaction in its account", async () => {
      const { tables } = useDatabase({ investment_transactions: [] });

      await investments.createTransaction(userId, transactionFor());

      expect(tables.investment_transactions).toEqual([{
        ...transactionRow(), amount: "150", quantity: "1.5", unit_price: "100",
      }]);
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase({}, { fail: () => true });

      await expect(investments.createTransaction(userId, transactionFor())).rejects.toThrow(
        new Error("The investment order could not be saved."),
      );
    });
  });

  describe("deleteTransaction", () => {
    it("deletes only the transaction in the account it was read from", async () => {
      const elsewhere = transactionRow({ investment_account_id: "other-account" });
      const { tables, queries } = useDatabase({ investment_transactions: [transactionRow(), elsewhere] });

      await investments.deleteTransaction(userId, transactionFor());

      expect(queries[0]).toMatchObject({
        operation: "delete",
        filters: [["eq", "id", transactionFor().id], ["eq", "investment_account_id", ACCOUNT_ID]],
      });
      expect(tables.investment_transactions).toEqual([elsewhere]);
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase({}, { fail: () => true });

      await expect(investments.deleteTransaction(userId, transactionFor())).rejects.toThrow(
        new Error("Unable to remove investment order."),
      );
    });
  });
});
