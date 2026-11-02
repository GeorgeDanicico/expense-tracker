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
 * Investment accounts and their transactions. The limits, the aggregation and the quotes live in
 * `src/lib/investments/service.ts`. The position check on a write is the storage's, so it runs
 * under a lock on the account (S10: two sells at once can't both pass it). Every method acts for
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
  /** The user's account at `brokerId`, created on first use. */
  getOrCreateAccount(userId: string, brokerId: InvestmentBrokerId): Promise<InvestmentAccount>;
  /**
   * Saves a new transaction in one of the user's accounts, from `getOrCreateAccount`. Under a lock on
   * the account, so orders are checked one at a time: rejects (`DomainError` 422, on `quantity`) a
   * sale larger than the position the asset's history leaves for it, saving nothing.
   */
  createTransaction(userId: string, transaction: InvestmentTransaction): Promise<void>;
  /**
   * Deletes one of the user's transactions, under the same lock. False when the user has no such
   * transaction. Rejects (`DomainError` 422, on `quantity`) a removal that would leave a later sale
   * larger than the position, deleting nothing.
   */
  deleteTransaction(userId: string, transactionId: string): Promise<boolean>;
}
