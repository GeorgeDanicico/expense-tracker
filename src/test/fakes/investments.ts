import type {
  InvestmentAccountWithTransactions,
  InvestmentAsset,
  InvestmentRepository,
} from "@/lib/investments/repository";
import type { InvestmentAccount, InvestmentBrokerId, InvestmentTransaction } from "@/lib/investments/types";

/** A stored account, with the user who owns it. */
export type FakeInvestmentAccount = InvestmentAccount & { userId: string };

function byExecution(left: InvestmentTransaction, right: InvestmentTransaction) {
  return Date.parse(left.executedAt) - Date.parse(right.executedAt) || left.id.localeCompare(right.id);
}

/**
 * In-memory `InvestmentRepository`. Seed `accounts` (with their `userId`) and `transactions` directly,
 * and read them back to check what a test changed.
 */
export class FakeInvestmentRepository implements InvestmentRepository {
  readonly accounts: FakeInvestmentAccount[] = [];
  readonly transactions: InvestmentTransaction[] = [];

  async listAccountsWithTransactions(userId: string, limits: { accounts: number; transactionsPerAccount: number }) {
    return this.accounts
      .filter((account) => account.userId === userId)
      .sort((left, right) => left.brokerId.localeCompare(right.brokerId))
      .slice(0, limits.accounts)
      .map((account) => ({
        account: this.toAccount(account),
        transactions: this.transactionsOf(account.id).slice(0, limits.transactionsPerAccount),
      }));
  }

  async getAssetHistory(userId: string, asset: InvestmentAsset, limit: number): Promise<InvestmentAccountWithTransactions | null> {
    const account = this.ownedAccount(userId, asset.accountId);
    const transactions = account ? this.assetTransactions(asset).reverse().slice(0, limit) : [];
    return account && transactions.length ? { account: this.toAccount(account), transactions } : null;
  }

  async listAssetTransactions(userId: string, asset: InvestmentAsset, limit: number) {
    return this.ownedAccount(userId, asset.accountId) ? this.assetTransactions(asset).slice(0, limit) : [];
  }

  async getOrCreateAccount(userId: string, brokerId: InvestmentBrokerId) {
    let account = this.accounts.find((stored) => stored.userId === userId && stored.brokerId === brokerId);
    if (!account) {
      account = { id: crypto.randomUUID(), userId, brokerId };
      this.accounts.push(account);
    }
    return this.toAccount(account);
  }

  async findTransaction(userId: string, transactionId: string) {
    const transaction = this.transactions.find((stored) => stored.id === transactionId);
    return transaction && this.ownedAccount(userId, transaction.investmentAccountId) ? { ...transaction } : null;
  }

  async createTransaction(_userId: string, transaction: InvestmentTransaction) {
    this.transactions.push({ ...transaction });
  }

  async deleteTransaction(_userId: string, transaction: InvestmentTransaction) {
    const index = this.transactions.findIndex(
      (stored) => stored.id === transaction.id && stored.investmentAccountId === transaction.investmentAccountId,
    );
    if (index >= 0) this.transactions.splice(index, 1);
  }

  private ownedAccount(userId: string, accountId: string) {
    return this.accounts.find((account) => account.id === accountId && account.userId === userId);
  }

  private toAccount({ id, brokerId }: FakeInvestmentAccount): InvestmentAccount {
    return { id, brokerId };
  }

  private transactionsOf(accountId: string) {
    return this.transactions
      .filter((transaction) => transaction.investmentAccountId === accountId)
      .map((transaction) => ({ ...transaction }))
      .sort(byExecution);
  }

  private assetTransactions({ accountId, instrument, currency }: InvestmentAsset) {
    return this.transactionsOf(accountId).filter(
      (transaction) => transaction.instrument === instrument && transaction.currency === currency,
    );
  }
}
