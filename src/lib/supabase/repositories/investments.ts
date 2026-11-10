import "server-only";

import type { Database } from "@/lib/database.types";
import { DomainError } from "@/lib/errors";
import type { InvestmentRepository } from "@/lib/investments/repository";
import {
  isInvestmentBrokerId,
  type InvestmentAccount,
  type InvestmentBrokerId,
  type InvestmentTransaction,
  type InvestmentTransactionSide,
} from "@/lib/investments/types";
import { isUserFacing, translateDatabaseError, type DatabaseError } from "@/lib/supabase/errors";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import { createClient } from "@/lib/supabase/server";

type Tables = Database["public"]["Tables"];

const TRANSACTION_COLUMNS =
  "id, investment_account_id, instrument, currency, side, amount, quantity, unit_price, executed_at";
const ACCOUNT_COLUMNS = "id, broker_id";
const LOAD_INVESTMENTS_ERROR = "Unable to load investments.";
/** Postgres' check_violation. */
const CHECK_VIOLATION = "23514";

type InvestmentTransactionRow = Tables["investment_transactions"]["Row"];
type InvestmentAccountRow = Pick<Tables["investment_accounts"]["Row"], "id" | "broker_id">;

/** A transaction with its account's broker; embedded selects are untyped because the generated types declare no relationships. */
type AssetTransactionRow = InvestmentTransactionRow & { investment_accounts: { broker_id: string } };

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

/** Rejects a stored broker id this version does not know, failing with `failure`. */
function toAccount(row: InvestmentAccountRow, failure: string): InvestmentAccount {
  if (!isInvestmentBrokerId(row.broker_id)) throw new Error(failure);
  return { id: row.id, brokerId: row.broker_id };
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

  if (error) throw translateDatabaseError(error, "Unable to load investment account.");
  return data ? toAccount(data, "Unable to load investment account.") : null;
}

/**
 * The order functions refuse a sale larger than the position with a check violation marked for users
 * (supabase/migrations/20261102000200_close_check_then_write_races.sql). It is the quantity's
 * problem, so it carries a field error as well; anything else goes through `translateDatabaseError`.
 */
function translateOrderError(error: DatabaseError, fallback: string) {
  if (error.code === CHECK_VIOLATION && isUserFacing(error)) {
    return new DomainError(error.message, 422, { quantity: [error.message] });
  }
  return translateDatabaseError(error, fallback);
}

/**
 * `InvestmentRepository` on the `investment_accounts` and `investment_transactions` tables. Every
 * read filters by owner: accounts on `user_id`, transactions through their account (an inner join).
 * Transactions are read page by page (`fetchAllPages`), never as a list embedded under the account:
 * PostgREST's `max-rows` cuts an embedded list at 1,000 rows without saying so. Orders are
 * written by `record_investment_order` and `delete_investment_order`, which lock the account, check
 * that it is the caller's and check the position inside the same transaction. Database errors go through `translateDatabaseError`: a known code is its status (a unique violation
 * a 409) with the generic message, anything else a 500.
 */
export const supabaseInvestmentRepository: InvestmentRepository = {
  async listAccountsWithTransactions(userId, limits) {
    const supabase = await createClient();
    const [accounts, rows] = await Promise.all([
      supabase.from("investment_accounts").select(ACCOUNT_COLUMNS).eq("user_id", userId)
        .order("broker_id", { ascending: true }).limit(limits.accounts),
      fetchAllPages((from, to) => supabase
        .from("investment_transactions")
        .select(`${TRANSACTION_COLUMNS}, investment_accounts!inner(user_id)`, { count: "exact" })
        .eq("investment_accounts.user_id", userId)
        .order("executed_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to), LOAD_INVESTMENTS_ERROR, { limit: limits.transactions }),
    ]);

    if (accounts.error) throw translateDatabaseError(accounts.error, LOAD_INVESTMENTS_ERROR);
    // Read newest first, so a limit only ever leaves out the oldest; each account's list is oldest first.
    const byAccount = Map.groupBy((rows as unknown as InvestmentTransactionRow[]).map(toTransaction).reverse(),
      (transaction) => transaction.investmentAccountId);
    return accounts.data.map((row) => {
      const account = toAccount(row, LOAD_INVESTMENTS_ERROR);
      return { account, transactions: byAccount.get(account.id) ?? [] };
    });
  },

  async getAssetHistory(userId, { accountId, instrument, currency }, limit) {
    const supabase = await createClient();
    const rows = await fetchAllPages((from, to) => supabase
      .from("investment_transactions")
      .select(`${TRANSACTION_COLUMNS}, investment_accounts!inner(user_id, broker_id)`, { count: "exact" })
      .eq("investment_account_id", accountId)
      .eq("investment_accounts.user_id", userId)
      .eq("instrument", instrument)
      .eq("currency", currency)
      .order("executed_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to), "Unable to load investment transactions.", { limit }) as unknown as AssetTransactionRow[];

    const brokerId = rows[0]?.investment_accounts.broker_id;
    if (brokerId === undefined || !isInvestmentBrokerId(brokerId)) return null;
    return { account: { id: accountId, brokerId }, transactions: rows.map(toTransaction) };
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

    throw error ? translateDatabaseError(error, "Unable to create investment account.") : new Error("Unable to create investment account.");
  },

  // The account comes from `getOrCreateAccount`; the function checks again that it is the caller's.
  async createTransaction(_userId, transaction) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_investment_order", {
      p_id: transaction.id,
      p_account_id: transaction.investmentAccountId,
      p_instrument: transaction.instrument,
      p_currency: transaction.currency,
      p_side: transaction.side,
      p_amount: transaction.amount,
      p_quantity: transaction.quantity,
      p_unit_price: transaction.unitPrice,
      p_executed_at: transaction.executedAt,
    });

    if (error) throw translateOrderError(error, "The investment order could not be saved.");
  },

  // The function finds the order through an account the caller owns.
  async deleteTransaction(_userId, transactionId) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("delete_investment_order", { p_transaction_id: transactionId });

    if (error) throw translateOrderError(error, "Unable to remove investment order.");
    return data === true;
  },
};
