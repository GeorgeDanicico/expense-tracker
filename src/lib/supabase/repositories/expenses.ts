import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/database.types";
import { DomainError } from "@/lib/errors";
import type { DashboardSummary } from "@/lib/expenses/analytics";
import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";
import { expenseTabDateBounds, matchesExpenseSearch, type ExpenseTabFilters } from "@/lib/expenses/filters";
import type { ExpenseRepository } from "@/lib/expenses/repository";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import type { Expense } from "@/lib/expenses/types";
import { getMonthRange } from "@/lib/calendar";
import { expenseTabMembershipFilter } from "@/lib/supabase/filters";
import { isUserFacing, translateDatabaseError, type DatabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { validateExpensePatch, type ExpenseChanges, type ExpenseInput } from "@/lib/validation/expense";

const EXPENSE_COLUMNS = "id, description, amount, category, subtype, expense_date, notes";
/** Postgres' check_violation. */
const CHECK_VIOLATION = "23514";

type ExpenseRow = Pick<
  Database["public"]["Tables"]["expenses"]["Row"],
  "id" | "description" | "amount" | "category" | "subtype" | "expense_date" | "notes"
>;

function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    description: row.description,
    amount: Number(row.amount),
    // The table's check constraints limit both columns to the known keys.
    category: row.category as ExpenseCategory,
    subtype: row.subtype as ExpenseSubtype | null,
    expenseDate: row.expense_date,
    notes: row.notes,
  };
}

type ExpenseQuery = {
  start?: string;
  endExclusive?: string;
  tab?: ExpenseTab;
  filters?: ExpenseTabFilters;
};

const EXPENSE_PAGE_SIZE = 500;

type ExpenseFilterQuery = ReturnType<typeof selectOwnedExpensePage>;

function selectOwnedExpensePage(supabase: SupabaseClient<Database>, userId: string) {
  return supabase.from("expenses")
    .select(EXPENSE_COLUMNS, { count: "exact" })
    .eq("user_id", userId);
}

/** Narrows an owner-scoped query by tab membership, date bounds, category and subtype. */
function applyExpenseScope(query: ExpenseFilterQuery, options: ExpenseQuery) {
  if (options.tab) {
    // Throws for a key outside the category and subtype catalogue: nothing unchecked reaches `.or()`.
    // eslint-disable-next-line no-restricted-syntax -- the string comes from expenseTabMembershipFilter, which checks every key
    query = query.or(expenseTabMembershipFilter(options.tab.categoryKeys, options.tab.subtypeKeys));
  }
  if (options.start) query = query.gte("expense_date", options.start);
  if (options.endExclusive) query = query.lt("expense_date", options.endExclusive);
  if (options.filters?.category) query = query.eq("category", options.filters.category);
  if (options.filters?.subtype === "none") query = query.is("subtype", null);
  else if (options.filters?.subtype && options.filters.subtype !== "all") query = query.eq("subtype", options.filters.subtype);
  return query;
}

type Page<Row> = { data: Row[] | null; error: DatabaseError | null; count: number | null };

/** Reads every page, failing the whole read when any page errors or the total comes up short. */
async function fetchAllPages<Row>(fetchPage: (from: number, to: number) => PromiseLike<Page<Row>>) {
  const rows: Row[] = [];
  let offset = 0;
  while (true) {
    const { data, error, count } = await fetchPage(offset, offset + EXPENSE_PAGE_SIZE - 1);
    if (error) throw translateDatabaseError(error, "Unable to load expenses.");
    const page = data ?? [];
    if (!page.length) {
      if (count !== null && offset < count) throw new Error("Unable to load complete expenses.");
      break;
    }
    rows.push(...page);
    offset += page.length;
    // Advance by actual rows, so a server cap smaller than our page size cannot truncate history.
    if (count !== null && offset >= count) break;
  }
  return rows;
}

async function queryExpensesForUser(userId: string, options: ExpenseQuery) {
  const supabase = await createClient();
  // An empty selection must never turn into an unrestricted expense query.
  if (options.tab && !options.tab.categoryKeys.length && !options.tab.subtypeKeys.length) return [];
  const rows = await fetchAllPages((from, to) =>
    applyExpenseScope(selectOwnedExpensePage(supabase, userId), options)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to));
  const expenses = rows.map(toExpense);
  const search = options.filters?.search.toLowerCase() ?? "";
  return search ? expenses.filter((expense) => matchesExpenseSearch(expense, search)) : expenses;
}

function toExpenseWrite(input: ExpenseInput) {
  return {
    description: input.description,
    amount: input.amount,
    category: input.category,
    subtype: input.subtype,
    expense_date: input.expenseDate,
    notes: input.notes || null,
  };
}

/** The patch for `update_expense`, keyed by column. Only the fields the change names are in it. */
function toExpenseChanges(changes: ExpenseChanges): Json {
  const columns: Record<string, Json> = {};
  if (changes.description !== undefined) columns.description = changes.description;
  if (changes.amount !== undefined) columns.amount = changes.amount;
  if (changes.category !== undefined) columns.category = changes.category;
  if (changes.subtype !== undefined) columns.subtype = changes.subtype;
  if (changes.expenseDate !== undefined) columns.expense_date = changes.expenseDate;
  if (changes.notes !== undefined) columns.notes = changes.notes;
  return columns;
}

/**
 * `ExpenseRepository` on the `expenses` table. Every table query filters by `user_id` itself instead
 * of relying on RLS, so the user's own pages stay theirs once parents may read family rows (F43).
 * The `get_expense_dashboard` RPC gets the same `userId` as `p_user_id`; `update_expense` finds the
 * expense by the caller, so an edit for anyone but the signed-in user finds nothing.
 * Database errors go through `translateDatabaseError`: a known code is its status (a unique violation
 * a 409) with the generic message, anything else a 500.
 */
export const supabaseExpenseRepository: ExpenseRepository = {
  async listMonth(userId, month) {
    return queryExpensesForUser(userId, getMonthRange(month));
  },

  async listRange(userId, { start, endExclusive }) {
    return queryExpensesForUser(userId, { start, endExclusive });
  },

  async recentCategoriesByMerchant(userId, since) {
    const supabase = await createClient();
    // The explicit owner filter is this repository's, as in every query here: parents' RLS reads are wider.
    const rows = await fetchAllPages((from, to) =>
      selectOwnedExpensePage(supabase, userId)
        .gte("expense_date", since)
        .neq("category", "other")
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to));
    return rows.map((row) => ({
      description: row.description,
      category: row.category as ExpenseCategory,
      subtype: row.subtype as ExpenseSubtype | null,
      expenseDate: row.expense_date,
    }));
  },

  async listForTab(userId, tab, filters) {
    return queryExpensesForUser(userId, { tab, filters, ...expenseTabDateBounds(filters) });
  },

  async getDashboard(userId, { current, analytics }) {
    const supabase = await createClient();
    const [recentResult, summaryResult] = await Promise.all([
      supabase
        .from("expenses")
        .select(EXPENSE_COLUMNS)
        .eq("user_id", userId)
        .gte("expense_date", current.start)
        .lt("expense_date", current.endExclusive)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5),
      supabase.rpc("get_expense_dashboard", {
        p_current_start: current.start,
        p_current_end_exclusive: current.endExclusive,
        p_analytics_start: analytics.start,
        p_analytics_end_exclusive: analytics.endExclusive,
        p_user_id: userId,
      }),
    ]);

    if (recentResult.error || summaryResult.error) {
      throw new Error("Unable to load dashboard data.");
    }

    return {
      currentExpenses: recentResult.data.map(toExpense),
      summary: summaryResult.data as unknown as DashboardSummary,
    };
  },

  /** The owner comes from `userId`, never from the input. */
  async create(userId, input) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("expenses")
      .insert({ user_id: userId, ...toExpenseWrite(input) })
      .select(EXPENSE_COLUMNS)
      .single();
    if (error) throw translateDatabaseError(error, "The expense could not be saved.");
    if (!data) throw new Error("The expense could not be saved.");
    return toExpense(data);
  },

  /**
   * One `update_expense` call: only the fields in the patch are written, in a single update ...
   * returning, so a parallel edit to another field isn't lost.
   */
  async update(_userId, id, patch) {
    const changes = validateExpensePatch(patch);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_expense", { p_id: id, p_patch: toExpenseChanges(changes) });
    if (error) {
      // A subtype outside the stored category, which only the database can see.
      if (error.code === CHECK_VIOLATION && isUserFacing(error)) {
        throw new DomainError(error.message, 422, { subtype: [error.message] });
      }
      throw translateDatabaseError(error, "The expense could not be saved.");
    }
    return data[0] ? toExpense(data[0]) : null;
  },

  async delete(userId, id) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("expenses")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id");
    if (error) throw translateDatabaseError(error, "Unable to delete expense.");
    return (data?.length ?? 0) > 0;
  },
};
