import "server-only";

import type { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { SUBTYPE_LABELS, subtypeForCategory } from "@/lib/expenses/categories";
import { expenseTabDateBounds, type ExpenseTabFilters } from "@/lib/expenses/tab-filters";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import {
  CATEGORY_LABELS,
  type Analytics,
  type AnalyticsFilters,
  type AnalyticsPeriod,
  type DashboardData,
  type Expense,
  type ExpenseCategory,
  type ExpenseSubtype,
} from "@/lib/types";
import {
  formatDate,
  formatMonth,
  getCurrentMonth,
  getMonthRange,
  isValidDate,
  isValidMonth,
  shiftMonth,
} from "@/lib/utils/dates";
import { expenseSchema } from "@/lib/validation/expense";

export { summarizeExpenses } from "@/lib/expenses/summary";

const EXPENSE_COLUMNS = "id, description, amount, category, subtype, expense_date, notes";

export type ExpenseInput = z.output<typeof expenseSchema>;

export type ExpensePatch = Partial<{
  description: string;
  amount: number | string;
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
  expenseDate: string;
  notes: string | null;
}>;

type ExpenseRow = {
  id: string;
  description: string;
  amount: number | string;
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
  expense_date: string;
  notes: string | null;
};

type DashboardSummary = {
  currentTotal: number | string;
  currentCount: number;
  currentLargest: number | string;
  analyticsTotal: number | string;
  analyticsCount: number;
  categoryTotals: { category: ExpenseCategory; total: number | string }[];
  monthlyTotals: { key: string; total: number | string }[];
};

const PERIOD_MONTHS: Record<Exclude<AnalyticsPeriod, "custom">, number> = {
  "3m": 3,
  "6m": 6,
  "1y": 12,
  "2y": 24,
};

function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    description: row.description,
    amount: Number(row.amount),
    category: row.category,
    subtype: row.subtype,
    expenseDate: row.expense_date,
    notes: row.notes,
  };
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function getAnalyticsRange(filters: AnalyticsFilters) {
  const currentMonth = getCurrentMonth();

  if (filters.period !== "custom") {
    const numberOfMonths = PERIOD_MONTHS[filters.period];
    return {
      start: `${shiftMonth(currentMonth, -numberOfMonths)}-01`,
      endExclusive: `${currentMonth}-01`,
      label: `Previous ${numberOfMonths} months`,
      monthCount: numberOfMonths,
      granularity: "month" as const,
    };
  }

  if (filters.granularity === "day" && isValidDate(filters.customDate)) {
    return {
      start: filters.customDate,
      endExclusive: nextDate(filters.customDate),
      label: formatDate(filters.customDate),
      monthCount: 1,
      granularity: "day" as const,
    };
  }

  const customMonth = isValidMonth(filters.customDate)
    ? filters.customDate
    : currentMonth;
  const range = getMonthRange(customMonth);
  return {
    start: range.start,
    endExclusive: range.endExclusive,
    label: formatMonth(customMonth),
    monthCount: 1,
    granularity: "month" as const,
  };
}

function buildMonthKeys(start: string, endExclusive: string) {
  const keys: string[] = [];
  let cursor = start.slice(0, 7);
  const last = endExclusive.slice(0, 7);

  while (cursor < last) {
    keys.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }

  return keys;
}

function analyticsFromSummary(
  summary: DashboardSummary,
  range: ReturnType<typeof getAnalyticsRange>,
): Analytics {
  const total = Number(summary.analyticsTotal);
  const categoryTotals = summary.categoryTotals.map((item) => ({
    category: item.category,
    label: CATEGORY_LABELS[item.category],
    total: Number(item.total),
  }));
  const monthMap = new Map(
    summary.monthlyTotals.map((item) => [item.key, Number(item.total)]),
  );
  const series =
    range.granularity === "day"
      ? [{ key: range.start, label: formatDate(range.start), total }]
      : buildMonthKeys(range.start, range.endExclusive).map((key) => ({
          key,
          label: new Intl.DateTimeFormat("en-US", {
            month: "short",
            year: range.monthCount > 12 ? "2-digit" : undefined,
          }).format(new Date(`${key}-01T12:00:00`)),
          total: monthMap.get(key) ?? 0,
        }));

  return {
    label: range.label,
    total,
    count: Number(summary.analyticsCount),
    monthlyAverage: total / range.monthCount,
    topCategory: categoryTotals[0]?.label ?? "No data",
    categoryTotals,
    series,
  };
}

type ExpenseQuery = {
  start?: string;
  endExclusive?: string;
  tab?: ExpenseTab;
  filters?: ExpenseTabFilters;
};

const EXPENSE_PAGE_SIZE = 500;

async function queryExpensesForUser(userId: string, options: ExpenseQuery) {
  const supabase = await createClient();
  const expenses: Expense[] = [];
  let offset = 0;
  // An empty selection must never turn into an unrestricted expense query.
  if (options.tab && !options.tab.categoryKeys.length && !options.tab.subtypeKeys.length) return [];
  while (true) {
    let query = supabase.from("expenses")
      .select(EXPENSE_COLUMNS, { count: "exact" })
      .eq("user_id", userId);
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
    const { data, error, count } = await query
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + EXPENSE_PAGE_SIZE - 1);
    if (error) throw new Error("Unable to load expenses.");
    const page = (data ?? []) as ExpenseRow[];
    if (!page.length) {
      if (count !== null && offset < count) throw new Error("Unable to load complete expenses.");
      break;
    }
    expenses.push(...page.map(toExpense));
    offset += page.length;
    // Advance by actual rows, so a server cap smaller than our page size cannot truncate history.
    if (count !== null && offset >= count) break;
  }
  const search = options.filters?.search.toLowerCase() ?? "";
  return search ? expenses.filter((expense) =>
    [expense.description, expense.notes ?? "", CATEGORY_LABELS[expense.category],
      expense.subtype ? SUBTYPE_LABELS[expense.subtype] : "No subtype"]
      .some((value) => value.toLowerCase().includes(search))) : expenses;
}

export async function getMonthlyExpensesForUser(userId: string, month: string) {
  const range = getMonthRange(month);
  return queryExpensesForUser(userId, range);
}

/** The caller first resolves the saved tab using authenticated ownership. */
export async function getExpenseTabExpensesForUser(userId: string, tab: ExpenseTab, filters: ExpenseTabFilters) {
  return queryExpensesForUser(userId, { tab, filters, ...expenseTabDateBounds(filters) });
}

export async function getDashboardDataForUser(
  userId: string,
  filters: AnalyticsFilters,
): Promise<DashboardData> {
  const currentMonth = getCurrentMonth();
  const currentRange = getMonthRange(currentMonth);
  const analyticsRange = getAnalyticsRange(filters);

  const supabase = await createClient();
  const [recentResult, summaryResult] = await Promise.all([
    supabase
      .from("expenses")
      .select(EXPENSE_COLUMNS)
      .eq("user_id", userId)
      .gte("expense_date", currentRange.start)
      .lt("expense_date", currentRange.endExclusive)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.rpc("get_expense_dashboard", {
      p_current_start: currentRange.start,
      p_current_end_exclusive: currentRange.endExclusive,
      p_analytics_start: analyticsRange.start,
      p_analytics_end_exclusive: analyticsRange.endExclusive,
    }),
  ]);

  if (recentResult.error || summaryResult.error) {
    throw new Error("Unable to load dashboard data.");
  }

  const currentExpenses = (recentResult.data as ExpenseRow[]).map(toExpense);
  const summary = summaryResult.data as unknown as DashboardSummary;
  const currentTotal = Number(summary.currentTotal);
  const currentCount = Number(summary.currentCount);
  const currentLargest = Number(summary.currentLargest);

  return {
    currentMonth,
    currentExpenses,
    currentTotal,
    currentCount,
    currentAverage: currentCount ? currentTotal / currentCount : 0,
    currentLargest,
    analytics: analyticsFromSummary(summary, analyticsRange),
  };
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

/** Ownership always comes from the authenticated caller, never from the input. */
export async function createExpenseForUser(userId: string, input: ExpenseInput): Promise<Expense> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .insert({ user_id: userId, ...toExpenseWrite(input) })
    .select(EXPENSE_COLUMNS)
    .single();
  if (error || !data) throw new Error("The expense could not be saved.");
  return toExpense(data as ExpenseRow);
}

/** Resolves to whether an owned row was deleted. */
export async function deleteExpenseForUser(userId: string, id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw new Error("Unable to delete expense.");
  return (data?.length ?? 0) > 0;
}

/**
 * Merges the patch into the owned row and re-validates the whole expense with `expenseSchema`.
 * Throws the ZodError for an invalid result; resolves to null when the row is missing or not owned.
 * A category change without an explicit subtype keeps the stored subtype only when it still belongs.
 */
export async function updateExpenseForUser(
  userId: string,
  id: string,
  patch: ExpensePatch,
): Promise<Expense | null> {
  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("expenses")
    .select(EXPENSE_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (loadError) throw new Error("Unable to load expense.");
  if (!existing) return null;

  const current = toExpense(existing as ExpenseRow);
  const category = patch.category ?? current.category;
  const subtype = patch.subtype !== undefined
    ? patch.subtype
    : patch.category !== undefined ? subtypeForCategory(category, current.subtype) : current.subtype;
  const notes = patch.notes !== undefined ? patch.notes ?? "" : current.notes ?? undefined;
  const validated = expenseSchema.parse({
    description: patch.description ?? current.description,
    amount: patch.amount ?? current.amount,
    category,
    subtype,
    expenseDate: patch.expenseDate ?? current.expenseDate,
    notes,
  });

  const { data, error } = await supabase
    .from("expenses")
    .update(toExpenseWrite(validated))
    .eq("id", id)
    .eq("user_id", userId)
    .select(EXPENSE_COLUMNS)
    .maybeSingle();
  if (error) throw new Error("The expense could not be saved.");
  return data ? toExpense(data as ExpenseRow) : null;
}
