import "server-only";

import { aggregateInvestments } from "@/lib/investments/aggregate";
import { getInvestmentQuoteAdapter } from "@/lib/investments/quotes/get-adapter";
import type { Quote } from "@/lib/investments/quotes/types";
import type { InvestmentAsset } from "@/lib/investments/repository";
import type {
  InvestmentTransaction,
  InvestmentTransactionInput,
  InvestmentTransactionMutationResponse,
  InvestmentTransactionsResponse,
  InvestmentsOverview,
  FamilyInvestmentsOverview,
} from "@/lib/investments/types";
import { mergeInvestmentQuotes } from "@/lib/investments/valuation";
import { getRepositories } from "@/lib/repositories";

/** The most investment accounts a user has: one per broker. */
export const MAX_ACCOUNTS = 2;
/** The most transactions read, and recalculated, per account or per asset. */
export const MAX_TRANSACTIONS_PER_ACCOUNT = 5_000;

/** The user's positions per broker, valued with current quotes where the price service has them. */
export async function getInvestmentsOverview(userId: string): Promise<InvestmentsOverview> {
  const accountRows = await getRepositories().investments.listAccountsWithTransactions(userId, {
    accounts: MAX_ACCOUNTS,
    transactionsPerAccount: MAX_TRANSACTIONS_PER_ACCOUNT,
  });
  const accounts = accountRows.map(({ account }) => account);
  const transactions = accountRows.flatMap(({ transactions: rows }) => rows);
  const aggregate = aggregateInvestments(accounts, transactions);
  const instruments = [...new Set(
    aggregate.brokers.flatMap((broker) => broker.assets.map((asset) => asset.instrument)),
  )];
  let quotes = new Map<string, Quote>();

  try {
    quotes = await getInvestmentQuoteAdapter().getQuotes(instruments);
  } catch {
    // A missing or unavailable quote service should degrade valuations to
    // "unavailable" so manual net-worth items and investment history remain
    // usable on both pages.
  }

  return mergeInvestmentQuotes(aggregate, quotes);
}

/** Every viewer's investments, one overview each, in the order given. Nobody else's is read. */
export async function getFamilyInvestmentsOverview(
  viewers: Array<{ userId: string; memberId: string; name: string; currency: string }>,
): Promise<FamilyInvestmentsOverview> {
  const members = await Promise.all(
    viewers.map(async ({ userId, memberId, name, currency }) => ({
      memberId,
      name,
      currency,
      overview: await getInvestmentsOverview(userId),
    })),
  );
  return { members };
}

/** One asset's orders, newest first, or null when the user holds no such asset. */
export async function getInvestmentTransactions(
  userId: string,
  asset: InvestmentAsset,
): Promise<InvestmentTransactionsResponse | null> {
  const history = await getRepositories().investments.getAssetHistory(userId, asset, MAX_TRANSACTIONS_PER_ACCOUNT);
  if (!history) return null;
  const { brokerId } = history.account;

  return {
    accountId: history.account.id,
    instrument: asset.instrument,
    currency: asset.currency,
    transactions: history.transactions.map((transaction) => ({ ...transaction, brokerId })),
  };
}

/**
 * Records an order, creating the broker account on first use. Rejects a sale larger than the
 * position with a 422 on `quantity`; the repository checks it under a lock on the account, so two
 * sells at once can't both pass.
 */
export async function createInvestmentTransaction(
  userId: string,
  input: InvestmentTransactionInput,
): Promise<InvestmentTransactionMutationResponse> {
  const { investments } = getRepositories();
  const account = await investments.getOrCreateAccount(userId, input.brokerId);
  const transaction: InvestmentTransaction = {
    id: crypto.randomUUID(),
    investmentAccountId: account.id,
    instrument: input.instrument,
    currency: input.currency,
    side: input.side,
    amount: input.amount,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    executedAt: input.executedAt,
  };

  await investments.createTransaction(userId, transaction);

  return {
    transaction: {
      ...transaction,
      brokerId: account.brokerId,
    },
  };
}

/**
 * Deletes one of the user's orders. False when there is no such order. Rejects a removal that
 * would leave a later sale larger than the position (422), checked under the same lock.
 */
export async function deleteInvestmentTransaction(userId: string, transactionId: string): Promise<boolean> {
  return getRepositories().investments.deleteTransaction(userId, transactionId);
}
