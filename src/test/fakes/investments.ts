import Decimal from "decimal.js";

import { DomainError } from "@/lib/errors";
import type {
  InvestmentAccountWithTransactions,
  InvestmentAsset,
  InvestmentRepository,
} from "@/lib/investments/repository";
import type { InvestmentAccount, InvestmentBrokerId, InvestmentTransaction } from "@/lib/investments/types";

// The SQL's messages (supabase/migrations/20261102000200_close_check_then_write_races.sql).
const REMOVAL_PREFIX = "This order cannot be removed because it would invalidate the later history: ";

/** A stored account, with the user who owns it. */
export type FakeInvestmentAccount = InvestmentAccount & { userId: string };

function byExecution(left: InvestmentTransaction, right: InvestmentTransaction) {
  return Date.parse(left.executedAt) - Date.parse(right.executedAt) || left.id.localeCompare(right.id);
}

/**
 * In-memory `InvestmentRepository`. Seed `accounts` (with their `userId`) and `transactions` directly,
 * and read them back to check what a test changed. Writes check the position as the SQL functions do.
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

  async getOrCreateAccount(userId: string, brokerId: InvestmentBrokerId) {
    let account = this.accounts.find((stored) => stored.userId === userId && stored.brokerId === brokerId);
    if (!account) {
      account = { id: crypto.randomUUID(), userId, brokerId };
      this.accounts.push(account);
    }
    return this.toAccount(account);
  }

  /** Like `record_investment_order`: saves the order, then refuses a sale larger than the position. */
  async createTransaction(userId: string, transaction: InvestmentTransaction) {
    if (!this.ownedAccount(userId, transaction.investmentAccountId)) throw new DomainError("That investment account wasn't found.", 404);
    this.transactions.push({ ...transaction });
    this.refuseOversell(transaction, "", () => this.transactions.pop());
  }

  /** Like `delete_investment_order`: false for an order the user doesn't own; refuses leaving a later sale too large. */
  async deleteTransaction(userId: string, transactionId: string) {
    const index = this.transactions.findIndex((stored) => stored.id === transactionId);
    const target = this.transactions[index];
    if (!target || !this.ownedAccount(userId, target.investmentAccountId)) return false;
    this.transactions.splice(index, 1);
    this.refuseOversell(target, REMOVAL_PREFIX, () => this.transactions.splice(index, 0, target));
    return true;
  }

  /** Throws the SQL's refusal, after `undo`, when a sale in the asset of `changed` exceeds the position. */
  private refuseOversell(changed: InvestmentTransaction, prefix: string, undo: () => void) {
    let held = new Decimal(0);
    for (const transaction of this.assetTransactions({ accountId: changed.investmentAccountId, instrument: changed.instrument, currency: changed.currency })) {
      held = transaction.side === "buy" ? held.plus(transaction.quantity) : held.minus(transaction.quantity);
      if (held.isNegative()) {
        undo();
        const message = `${prefix}Sell quantity exceeds the available ${changed.instrument} position.`;
        throw new DomainError(message, 422, { quantity: [message] });
      }
    }
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
