import "server-only";

import type { Database } from "@/lib/database.types";
import { DomainError } from "@/lib/errors";
import {
  aggregateInvestments,
  calculateInvestmentPosition,
  InvestmentCalculationError,
} from "@/lib/investments/aggregate";
import { getInvestmentQuoteAdapter } from "@/lib/investments/quotes/get-adapter";
import { mergeInvestmentQuotes } from "@/lib/investments/valuation";
import type { Quote } from "@/lib/investments/quotes/types";
import {
  isInvestmentBrokerId,
  type InvestmentAccount,
  type InvestmentBrokerId,
  type InvestmentTransactionSide,
  type InvestmentTransactionInput,
  type InvestmentTransaction,
  type InvestmentTransactionsResponse,
  type InvestmentsOverview,
} from "@/lib/investments/types";
import { createClient } from "@/lib/supabase/server";

const MAX_ACCOUNTS = 2;
const MAX_TRANSACTIONS_PER_ACCOUNT = 5_000;

type Tables = Database["public"]["Tables"];

const TRANSACTION_COLUMNS =
  "id, investment_account_id, instrument, currency, side, amount, quantity, unit_price, executed_at";
const ACCOUNT_COLUMNS = "id, broker_id";

type InvestmentTransactionRow = Tables["investment_transactions"]["Row"];
type InvestmentAccountRow = Pick<Tables["investment_accounts"]["Row"], "id" | "broker_id">;

/** Embedded selects are untyped because the generated types declare no relationships. */
type InvestmentAccountWithTransactionsRow = InvestmentAccountRow & {
  investment_transactions: InvestmentTransactionRow[] | null;
};

function toTransaction(row: InvestmentTransactionRow): InvestmentTransaction {
  return {
    id: row.id,
    investmentAccountId: row.investment_account_id,
    instrument: row.instrument,
    currency: row.currency,
    // The table's check constraint limits `side` to buy/sell.
    side: row.side as InvestmentTransactionSide,
    amount: String(row.amount),
    quantity: String(row.quantity),
    unitPrice: String(row.unit_price),
    executedAt: row.executed_at,
  };
}

function toTransactionInsert(transaction: InvestmentTransaction): Tables["investment_transactions"]["Insert"] {
  return {
    id: transaction.id,
    investment_account_id: transaction.investmentAccountId,
    instrument: transaction.instrument,
    currency: transaction.currency,
    side: transaction.side,
    amount: transaction.amount,
    quantity: transaction.quantity,
    unit_price: transaction.unitPrice,
    executed_at: transaction.executedAt,
  };
}

/** Rejects a stored broker id this version does not know, failing with `failure`. */
function toAccount(row: InvestmentAccountRow, failure: string): InvestmentAccount {
  if (!isInvestmentBrokerId(row.broker_id)) throw new Error(failure);
  return { id: row.id, brokerId: row.broker_id };
}

function parseAccountRow(row: InvestmentAccountWithTransactionsRow) {
  return {
    account: toAccount(row, "Unable to load investments."),
    transactions: (row.investment_transactions ?? []).map(toTransaction),
  };
}

async function queryAccountsWithTransactions(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investment_accounts")
    .select(`${ACCOUNT_COLUMNS}, investment_transactions(${TRANSACTION_COLUMNS})`)
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

async function queryTransactionsForAsset(
  userId: string,
  accountId: string,
  instrument: string,
  currency: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investment_accounts")
    .select(`${ACCOUNT_COLUMNS}, investment_transactions!inner(${TRANSACTION_COLUMNS})`)
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

/** Reads an account only when it belongs to `userId`. */
async function queryOwnedAccount(userId: string, by: { id: string } | { brokerId: InvestmentBrokerId }) {
  const supabase = await createClient();
  let query = supabase
    .from("investment_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("user_id", userId);
  query = "id" in by ? query.eq("id", by.id) : query.eq("broker_id", by.brokerId);
  const { data, error } = await query.maybeSingle();

  if (error) throw new Error("Unable to load investment account.");
  return data ? toAccount(data, "Unable to load investment account.") : null;
}

async function getOrCreateOwnedAccount(userId: string, brokerId: InvestmentBrokerId) {
  const existing = await queryOwnedAccount(userId, { brokerId });
  if (existing) return existing;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investment_accounts")
    .insert({ user_id: userId, broker_id: brokerId })
    .select(ACCOUNT_COLUMNS)
    .single();

  if (!error && data) return toAccount(data, "Unable to create investment account.");

  // A second request can win the unique (user_id, broker_id) race. The
  // account is immutable in this version, so re-reading is sufficient.
  if (error?.code === "23505") {
    const racedAccount = await queryOwnedAccount(userId, { brokerId });
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
    .select(TRANSACTION_COLUMNS)
    .eq("investment_account_id", accountId)
    .eq("instrument", instrument)
    .eq("currency", currency)
    .order("executed_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_TRANSACTIONS_PER_ACCOUNT);

  if (error) throw new Error("Unable to load investment history.");
  return data.map(toTransaction);
}

function throwMutationCalculationError(error: unknown, prefix = "") {
  if (!(error instanceof InvestmentCalculationError)) throw error;

  const message = `${prefix}${error.message}`;
  throw new DomainError(
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
    .insert(toTransactionInsert(transaction))
    .select(TRANSACTION_COLUMNS)
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
    .select(TRANSACTION_COLUMNS)
    .eq("id", transactionId)
    .maybeSingle();

  if (error) throw new Error("Unable to load investment order.");
  if (!data) return false;

  const target = toTransaction(data);
  const account = await queryOwnedAccount(userId, { id: target.investmentAccountId });
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
  const brokerId = row.broker_id;

  return {
    accountId: row.id,
    instrument: params.instrument,
    currency: params.currency,
    transactions: (row.investment_transactions ?? []).map((transaction) => ({
      ...toTransaction(transaction),
      brokerId,
    })),
  };
}
