import type {
  InvestmentAccount,
  InvestmentBrokerId,
  InvestmentCurrency,
  InvestmentTransaction,
} from "@/lib/investments/types";

/** One investment account with some of its transactions. */
export type InvestmentAccountWithTransactions = {
  account: InvestmentAccount;
  transactions: InvestmentTransaction[];
};

/** One asset: an instrument in one currency, held in one investment account. */
export type InvestmentAsset = {
  accountId: string;
  instrument: string;
  currency: InvestmentCurrency;
};

/**
 * Investment accounts and their transactions. Storage only: the limits, the position checks, the
 * aggregation and the quotes live in `src/lib/investments/service.ts`. Every method acts for
 * `userId` and only ever sees that user's own accounts and transactions. Get it from
 * `getRepositories()`; never import an implementation.
 *
 * Transactions are ordered by `executedAt`, then by `id`.
 */
export interface InvestmentRepository {
  /**
   * The user's accounts by broker id, at most `limits.accounts` of them, each with its oldest
   * `limits.transactionsPerAccount` transactions, oldest first.
   */
  listAccountsWithTransactions(
    userId: string,
    limits: { accounts: number; transactionsPerAccount: number },
  ): Promise<InvestmentAccountWithTransactions[]>;
  /**
   * One of the user's accounts with its newest `limit` transactions for one asset, newest first.
   * Null when the account is not the user's, holds no transactions for the asset, or has a broker
   * this version does not know.
   */
  getAssetHistory(
    userId: string,
    asset: InvestmentAsset,
    limit: number,
  ): Promise<InvestmentAccountWithTransactions | null>;
  /**
   * The oldest `limit` transactions for one asset, oldest first. Empty when the account is not the
   * user's.
   */
  listAssetTransactions(userId: string, asset: InvestmentAsset, limit: number): Promise<InvestmentTransaction[]>;
  /** The user's account at `brokerId`, created on first use. */
  getOrCreateAccount(userId: string, brokerId: InvestmentBrokerId): Promise<InvestmentAccount>;
  /** One of the user's transactions, or null when it does not exist or belongs to someone else. */
  findTransaction(userId: string, transactionId: string): Promise<InvestmentTransaction | null>;
  /** Saves a new transaction. Its account must be one the user owns, from `getOrCreateAccount`. */
  createTransaction(userId: string, transaction: InvestmentTransaction): Promise<void>;
  /** Deletes a transaction the user owns, as returned by `findTransaction`. */
  deleteTransaction(userId: string, transaction: InvestmentTransaction): Promise<void>;
}
