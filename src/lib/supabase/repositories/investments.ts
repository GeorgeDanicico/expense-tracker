import "server-only";

import type { Database } from "@/lib/database.types";
import type {
  InvestmentAccountWithTransactions,
  InvestmentRepository,
} from "@/lib/investments/repository";
import {
  isInvestmentBrokerId,
  type InvestmentAccount,
  type InvestmentBrokerId,
  type InvestmentTransaction,
  type InvestmentTransactionSide,
} from "@/lib/investments/types";
import { createClient } from "@/lib/supabase/server";

type Tables = Database["public"]["Tables"];

const TRANSACTION_COLUMNS =
  "id, investment_account_id, instrument, currency, side, amount, quantity, unit_price, executed_at";
const ACCOUNT_COLUMNS = "id, broker_id";
/**
 * `investment_transactions` has no `user_id`, so a transaction query embeds its account and filters
 * on `investment_accounts.user_id`. `!inner` drops transactions whose account does not match.
 */
const OWNING_ACCOUNT = "investment_accounts!inner(user_id)";

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

function parseAccountRow(row: InvestmentAccountWithTransactionsRow): InvestmentAccountWithTransactions {
  return {
    account: toAccount(row, "Unable to load investments."),
    transactions: (row.investment_transactions ?? []).map(toTransaction),
  };
}

/** Reads an account only when it belongs to `userId`. */
async function findOwnedAccount(userId: string, by: { id: string } | { brokerId: InvestmentBrokerId }) {
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

/**
 * `InvestmentRepository` on the `investment_accounts` and `investment_transactions` tables. Every
 * read filters by owner: accounts on `user_id`, transactions through their account. Writes go to an
 * account the caller already read as its own, and the tables' write policies stay owner-only.
 * Errors stay the plain `Error`s (500s) the data functions threw before the repository existed.
 */
export const supabaseInvestmentRepository: InvestmentRepository = {
  async listAccountsWithTransactions(userId, limits) {
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
      .limit(limits.accounts)
      .limit(limits.transactionsPerAccount, { foreignTable: "investment_transactions" });

    if (error) throw new Error("Unable to load investments.");
    return (data as unknown as InvestmentAccountWithTransactionsRow[]).map(parseAccountRow);
  },

  async getAssetHistory(userId, { accountId, instrument, currency }, limit) {
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
      .limit(limit, { foreignTable: "investment_transactions" })
      .maybeSingle();

    if (error) throw new Error("Unable to load investment transactions.");
    const row = data as unknown as InvestmentAccountWithTransactionsRow | null;
    if (!row || !isInvestmentBrokerId(row.broker_id)) return null;

    return {
      account: { id: row.id, brokerId: row.broker_id },
      transactions: (row.investment_transactions ?? []).map(toTransaction),
    };
  },

  async listAssetTransactions(userId, { accountId, instrument, currency }, limit) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("investment_transactions")
      .select(`${TRANSACTION_COLUMNS}, ${OWNING_ACCOUNT}`)
      .eq("investment_account_id", accountId)
      .eq("investment_accounts.user_id", userId)
      .eq("instrument", instrument)
      .eq("currency", currency)
      .order("executed_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);

    if (error) throw new Error("Unable to load investment history.");
    return (data as unknown as InvestmentTransactionRow[]).map(toTransaction);
  },

  async getOrCreateAccount(userId, brokerId) {
    const existing = await findOwnedAccount(userId, { brokerId });
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
      const racedAccount = await findOwnedAccount(userId, { brokerId });
      if (racedAccount) return racedAccount;
    }

    throw new Error("Unable to create investment account.");
  },

  async findTransaction(userId, transactionId) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("investment_transactions")
      .select(`${TRANSACTION_COLUMNS}, ${OWNING_ACCOUNT}`)
      .eq("id", transactionId)
      .eq("investment_accounts.user_id", userId)
      .maybeSingle();

    if (error) throw new Error("Unable to load investment order.");
    return data ? toTransaction(data as unknown as InvestmentTransactionRow) : null;
  },

  // An insert cannot filter. The account comes from `getOrCreateAccount`, which filters by owner.
  async createTransaction(_userId, transaction) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("investment_transactions")
      .insert(toTransactionInsert(transaction))
      .select(TRANSACTION_COLUMNS)
      .single();

    if (error || !data) throw new Error("The investment order could not be saved.");
  },

  // A delete cannot embed the account, so it is scoped to the account `findTransaction` checked.
  async deleteTransaction(_userId, transaction) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("investment_transactions")
      .delete()
      .eq("id", transaction.id)
      .eq("investment_account_id", transaction.investmentAccountId);

    if (error) throw new Error("Unable to remove investment order.");
  },
};
