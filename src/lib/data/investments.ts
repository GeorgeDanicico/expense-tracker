import "server-only";

import {
  aggregateInvestments,
  calculateInvestmentPosition,
  InvestmentCalculationError,
} from "@/lib/investments/aggregate";
import { getInvestmentQuoteAdapter } from "@/lib/investments/quotes/get-adapter";
import { mergeInvestmentQuotes } from "@/lib/investments/valuation";
import {
  isInvestmentBrokerId,
  type InvestmentAccount,
  type InvestmentBrokerId,
  type InvestmentTransactionInput,
  type InvestmentTransaction,
  type InvestmentTransactionsResponse,
  type InvestmentsOverview,
} from "@/lib/investments/types";
import { createClient } from "@/lib/supabase/server";

const MAX_ACCOUNTS = 2;
const MAX_TRANSACTIONS_PER_ACCOUNT = 5_000;

type InvestmentTransactionRow = {
  id: string;
  investment_account_id: string;
  instrument: string;
  currency: string;
  side: "buy" | "sell";
  amount: number | string;
  quantity: number | string;
  unit_price: number | string;
  executed_at: string;
};

type InvestmentAccountWithTransactionsRow = {
  id: string;
  broker_id: string;
  investment_transactions: InvestmentTransactionRow[] | null;
};

type InvestmentAccountRow = {
  id: string;
  broker_id: string;
};

export class InvestmentMutationError extends Error {
  readonly status: 404 | 409 | 422;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    message: string,
    status: 404 | 409 | 422,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "InvestmentMutationError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

function toTransaction(row: InvestmentTransactionRow): InvestmentTransaction {
  return {
    id: row.id,
    investmentAccountId: row.investment_account_id,
    instrument: row.instrument,
    currency: row.currency,
    side: row.side,
    amount: String(row.amount),
    quantity: String(row.quantity),
    unitPrice: String(row.unit_price),
    executedAt: row.executed_at,
  };
}

function parseAccountRow(row: InvestmentAccountWithTransactionsRow) {
  if (!isInvestmentBrokerId(row.broker_id)) {
    throw new Error("Unable to load investments.");
  }

  return {
    account: {
      id: row.id,
      brokerId: row.broker_id,
    } satisfies InvestmentAccount,
    transactions: (row.investment_transactions ?? []).map(toTransaction),
  };
}

async function queryAccountsWithTransactions(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investment_accounts")
    .select(
      "id, broker_id, investment_transactions(id, investment_account_id, instrument, currency, side, amount, quantity, unit_price, executed_at)",
    )
    .eq("user_id", userId)
    .order("broker_id", { ascending: true })
    .order("executed_at", {
      foreignTable: "investment_transactions",
      ascending: true,
    })
    .order("id", {
      foreignTable: "investment_transactions",
      ascending: true,
    })
    .limit(MAX_ACCOUNTS)
    .limit(MAX_TRANSACTIONS_PER_ACCOUNT, { foreignTable: "investment_transactions" });

  if (error) throw new Error("Unable to load investments.");
  return (data as unknown as InvestmentAccountWithTransactionsRow[]).map(parseAccountRow);
}

export async function getInvestmentsOverviewForUser(userId: string): Promise<InvestmentsOverview> {
  const accountRows = await queryAccountsWithTransactions(userId);
  const accounts = accountRows.map(({ account }) => account);
  const transactions = accountRows.flatMap(({ transactions: rows }) => rows);
  const aggregate = aggregateInvestments(accounts, transactions);
  const instruments = [...new Set(
    aggregate.brokers.flatMap((broker) => broker.assets.map((asset) => asset.instrument)),
  )];
  const quotes = await getInvestmentQuoteAdapter().getQuotes(instruments);

  return mergeInvestmentQuotes(aggregate, quotes);
}

async function queryTransactionsForAsset(
  userId: string,
  accountId: string,
  instrument: string,
  currency: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investment_accounts")
    .select(
      "id, broker_id, investment_transactions!inner(id, investment_account_id, instrument, currency, side, amount, quantity, unit_price, executed_at)",
    )
    .eq("id", accountId)
    .eq("user_id", userId)
    .eq("investment_transactions.instrument", instrument)
    .eq("investment_transactions.currency", currency)
    .order("executed_at", {
      foreignTable: "investment_transactions",
      ascending: false,
    })
    .order("id", {
      foreignTable: "investment_transactions",
      ascending: false,
    })
    .limit(MAX_TRANSACTIONS_PER_ACCOUNT, { foreignTable: "investment_transactions" })
    .maybeSingle();

  if (error) throw new Error("Unable to load investment transactions.");
  return data as unknown as InvestmentAccountWithTransactionsRow | null;
}

async function queryOwnedAccountForBroker(userId: string, brokerId: InvestmentBrokerId) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investment_accounts")
    .select("id, broker_id")
    .eq("user_id", userId)
    .eq("broker_id", brokerId)
    .maybeSingle();

  if (error) throw new Error("Unable to load investment account.");
  if (!data) return null;

  const row = data as unknown as InvestmentAccountRow;
  if (!isInvestmentBrokerId(row.broker_id)) {
    throw new Error("Unable to load investment account.");
  }

  return {
    id: row.id,
    brokerId: row.broker_id,
  } satisfies InvestmentAccount;
}

async function getOrCreateOwnedAccount(userId: string, brokerId: InvestmentBrokerId) {
  const existing = await queryOwnedAccountForBroker(userId, brokerId);
  if (existing) return existing;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investment_accounts")
    .insert({ user_id: userId, broker_id: brokerId })
    .select("id, broker_id")
    .single();

  if (!error && data) {
    const row = data as unknown as InvestmentAccountRow;
    if (!isInvestmentBrokerId(row.broker_id)) {
      throw new Error("Unable to create investment account.");
    }
    return {
      id: row.id,
      brokerId: row.broker_id,
    } satisfies InvestmentAccount;
  }

  // A second request can win the unique (user_id, broker_id) race. The
  // account is immutable in this version, so re-reading is sufficient.
  if (error?.code === "23505") {
    const racedAccount = await queryOwnedAccountForBroker(userId, brokerId);
    if (racedAccount) return racedAccount;
  }

  throw new Error("Unable to create investment account.");
}

async function queryDirectAssetTransactions(
  accountId: string,
  instrument: string,
  currency: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investment_transactions")
    .select("id, investment_account_id, instrument, currency, side, amount, quantity, unit_price, executed_at")
    .eq("investment_account_id", accountId)
    .eq("instrument", instrument)
    .eq("currency", currency)
    .order("executed_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_TRANSACTIONS_PER_ACCOUNT);

  if (error) throw new Error("Unable to load investment history.");
  return (data as unknown as InvestmentTransactionRow[]).map(toTransaction);
}

function throwMutationCalculationError(error: unknown, prefix = "") {
  if (!(error instanceof InvestmentCalculationError)) throw error;

  const message = `${prefix}${error.message}`;
  throw new InvestmentMutationError(
    message,
    error.issue.code === "oversell" ? 422 : 409,
    error.issue.code === "oversell" ? { quantity: [message] } : undefined,
  );
}

export async function createInvestmentTransactionForUser(
  userId: string,
  input: InvestmentTransactionInput,
) {
  const account = await getOrCreateOwnedAccount(userId, input.brokerId);
  const existingTransactions = await queryDirectAssetTransactions(
    account.id,
    input.instrument,
    input.currency,
  );
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

  try {
    calculateInvestmentPosition([...existingTransactions, transaction]);
  } catch (error) {
    throwMutationCalculationError(error);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investment_transactions")
    .insert({
      id: transaction.id,
      investment_account_id: transaction.investmentAccountId,
      instrument: transaction.instrument,
      currency: transaction.currency,
      side: transaction.side,
      amount: transaction.amount,
      quantity: transaction.quantity,
      unit_price: transaction.unitPrice,
      executed_at: transaction.executedAt,
    })
    .select("id, investment_account_id, instrument, currency, side, amount, quantity, unit_price, executed_at")
    .single();

  if (error || !data) throw new Error("The investment order could not be saved.");

  return {
    transaction: {
      ...transaction,
      brokerId: account.brokerId,
    },
  };
}

export async function deleteInvestmentTransactionForUser(
  userId: string,
  transactionId: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investment_transactions")
    .select("id, investment_account_id, instrument, currency, side, amount, quantity, unit_price, executed_at")
    .eq("id", transactionId)
    .maybeSingle();

  if (error) throw new Error("Unable to load investment order.");
  if (!data) return false;

  const target = toTransaction(data as unknown as InvestmentTransactionRow);
  const account = await queryOwnedAccountById(userId, target.investmentAccountId);
  if (!account) return false;

  const transactions = await queryDirectAssetTransactions(
    target.investmentAccountId,
    target.instrument,
    target.currency,
  );
  const remainingTransactions = transactions.filter((transaction) => transaction.id !== transactionId);

  try {
    calculateInvestmentPosition(remainingTransactions);
  } catch (calculationError) {
    throwMutationCalculationError(
      calculationError,
      "This order cannot be removed because it would invalidate the later history: ",
    );
  }

  const { error: deleteError } = await supabase
    .from("investment_transactions")
    .delete()
    .eq("id", transactionId)
    .eq("investment_account_id", target.investmentAccountId);

  if (deleteError) throw new Error("Unable to remove investment order.");
  return true;
}

async function queryOwnedAccountById(userId: string, accountId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investment_accounts")
    .select("id, broker_id")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Unable to load investment account.");
  if (!data) return null;

  const row = data as unknown as InvestmentAccountRow;
  if (!isInvestmentBrokerId(row.broker_id)) throw new Error("Unable to load investment account.");
  return { id: row.id, brokerId: row.broker_id } satisfies InvestmentAccount;
}

export async function getInvestmentTransactionsForUser(
  userId: string,
  params: { accountId: string; instrument: string; currency: string },
): Promise<InvestmentTransactionsResponse | null> {
  const row = await queryTransactionsForAsset(
    userId,
    params.accountId,
    params.instrument,
    params.currency,
  );
  if (!row || !isInvestmentBrokerId(row.broker_id)) return null;

  return {
    accountId: row.id,
    instrument: params.instrument,
    currency: params.currency,
    transactions: (row.investment_transactions ?? []).map((transaction) => ({
      ...toTransaction(transaction),
      brokerId: row.broker_id as InvestmentBrokerId,
    })),
  };
}
