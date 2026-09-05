import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  CATEGORY_LABELS,
  type Analytics,
  type AnalyticsFilters,
  type AnalyticsPeriod,
  type DashboardData,
  type Expense,
  type ExpenseCategory,
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

type ExpenseRow = {
  id: string;
  description: string;
  amount: number | string;
  category: ExpenseCategory;
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

async function queryExpensesForUser(userId: string, start: string, endExclusive: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select("id, description, amount, category, expense_date, notes")
    .eq("user_id", userId)
    .gte("expense_date", start)
    .lt("expense_date", endExclusive)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error("Unable to load expenses.");
  return (data as ExpenseRow[]).map(toExpense);
}

export async function getMonthlyExpensesForUser(userId: string, month: string) {
  const range = getMonthRange(month);
  return queryExpensesForUser(userId, range.start, range.endExclusive);
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
      .select("id, description, amount, category, expense_date, notes")
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
