import "server-only";

import { aggregateInvestments } from "@/lib/investments/aggregate";
import { getInvestmentQuoteAdapter } from "@/lib/investments/quotes/get-adapter";
import { mergeInvestmentQuotes } from "@/lib/investments/valuation";
import {
  isInvestmentBrokerId,
  type InvestmentAccount,
  type InvestmentBrokerId,
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
