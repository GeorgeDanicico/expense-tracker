import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { DashboardSummary } from "@/lib/expenses/analytics";
import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";
import { expenseTabDateBounds, matchesExpenseSearch, type ExpenseTabFilters } from "@/lib/expenses/filters";
import type { ExpenseRepository } from "@/lib/expenses/repository";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import type { Expense } from "@/lib/expenses/types";
import { getMonthRange } from "@/lib/calendar";
import { createClient } from "@/lib/supabase/server";
import { applyExpensePatch, type ExpenseInput } from "@/lib/validation/expense";

const EXPENSE_COLUMNS = "id, description, amount, category, subtype, expense_date, notes";

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
    const membership: string[] = [];
    if (options.tab.categoryKeys.length) membership.push(`category.in.(${options.tab.categoryKeys.join(",")})`);
    if (options.tab.subtypeKeys.length) membership.push(`subtype.in.(${options.tab.subtypeKeys.join(",")})`);
    query = query.or(membership.join(","));
  }
  if (options.start) query = query.gte("expense_date", options.start);
  if (options.endExclusive) query = query.lt("expense_date", options.endExclusive);
  if (options.filters?.category) query = query.eq("category", options.filters.category);
  if (options.filters?.subtype === "none") query = query.is("subtype", null);
  else if (options.filters?.subtype && options.filters.subtype !== "all") query = query.eq("subtype", options.filters.subtype);
  return query;
}

type Page<Row> = { data: Row[] | null; error: unknown; count: number | null };

/** Reads every page, failing the whole read when any page errors or the total comes up short. */
async function fetchAllPages<Row>(fetchPage: (from: number, to: number) => PromiseLike<Page<Row>>) {
  const rows: Row[] = [];
  let offset = 0;
  while (true) {
    const { data, error, count } = await fetchPage(offset, offset + EXPENSE_PAGE_SIZE - 1);
    if (error) throw new Error("Unable to load expenses.");
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

/**
 * `ExpenseRepository` on the `expenses` table. Every table query filters by `user_id` itself instead
 * of relying on RLS, so the user's own pages stay theirs once parents may read family rows (F43).
 * The `get_expense_dashboard` RPC gets the same `userId` as `p_user_id`.
 * Its errors stay plain `Error`s (500s), as before the repository existed.
 */
export const supabaseExpenseRepository: ExpenseRepository = {
  async listMonth(userId, month) {
    return queryExpensesForUser(userId, getMonthRange(month));
  },

  async listRange(userId, { start, endExclusive }) {
    return queryExpensesForUser(userId, { start, endExclusive });
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
    if (error || !data) throw new Error("The expense could not be saved.");
    return toExpense(data);
  },

  async update(userId, id, patch) {
    const supabase = await createClient();
    const { data: existing, error: loadError } = await supabase
      .from("expenses")
      .select(EXPENSE_COLUMNS)
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (loadError) throw new Error("Unable to load expense.");
    if (!existing) return null;

    const validated = applyExpensePatch(toExpense(existing), patch);
    const { data, error } = await supabase
      .from("expenses")
      .update(toExpenseWrite(validated))
      .eq("id", id)
      .eq("user_id", userId)
      .select(EXPENSE_COLUMNS)
      .maybeSingle();
    if (error) throw new Error("The expense could not be saved.");
    return data ? toExpense(data) : null;
  },

  async delete(userId, id) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("expenses")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id");
    if (error) throw new Error("Unable to delete expense.");
    return (data?.length ?? 0) > 0;
  },
};
