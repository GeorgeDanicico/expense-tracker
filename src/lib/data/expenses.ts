import "server-only";

import { redirect } from "next/navigation";

import { getAuthenticatedUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CATEGORY_LABELS,
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

export type AnalyticsPeriod = "3m" | "6m" | "1y" | "2y" | "custom";
export type CustomGranularity = "month" | "day";

export type AnalyticsFilters = {
  period: AnalyticsPeriod;
  granularity: CustomGranularity;
  customDate: string;
};

export type Analytics = {
  label: string;
  total: number;
  count: number;
  monthlyAverage: number;
  topCategory: string;
  categoryTotals: { category: ExpenseCategory; label: string; total: number }[];
  series: { key: string; label: string; total: number }[];
};

export type DashboardData = {
  currentMonth: string;
  currentExpenses: Expense[];
  currentTotal: number;
  currentCount: number;
  currentAverage: number;
  currentLargest: number;
  analytics: Analytics;
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

function calculateAnalytics(
  expenses: Expense[],
  range: ReturnType<typeof getAnalyticsRange>,
): Analytics {
  const categoryMap = new Map<ExpenseCategory, number>();
  const monthMap = new Map<string, number>();
  let total = 0;

  for (const expense of expenses) {
    total += expense.amount;
    categoryMap.set(
      expense.category,
      (categoryMap.get(expense.category) ?? 0) + expense.amount,
    );
    const month = expense.expenseDate.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) ?? 0) + expense.amount);
  }

  const categoryTotals = Array.from(categoryMap, ([category, categoryTotal]) => ({
    category,
    label: CATEGORY_LABELS[category],
    total: categoryTotal,
  })).sort((a, b) => b.total - a.total);

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
    count: expenses.length,
    monthlyAverage: total / range.monthCount,
    topCategory: categoryTotals[0]?.label ?? "No data",
    categoryTotals,
    series,
  };
}

async function queryExpenses(start: string, endExclusive: string) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select("id, description, amount, category, expense_date, notes")
    .eq("user_id", user.id)
    .gte("expense_date", start)
    .lt("expense_date", endExclusive)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error("Unable to load expenses.");
  return (data as ExpenseRow[]).map(toExpense);
}

export async function getMonthlyExpenses(month: string) {
  const range = getMonthRange(month);
  return queryExpenses(range.start, range.endExclusive);
}

export async function getDashboardData(filters: AnalyticsFilters): Promise<DashboardData> {
  const currentMonth = getCurrentMonth();
  const currentRange = getMonthRange(currentMonth);
  const analyticsRange = getAnalyticsRange(filters);

  const [currentExpenses, analyticsExpenses] = await Promise.all([
    queryExpenses(currentRange.start, currentRange.endExclusive),
    queryExpenses(analyticsRange.start, analyticsRange.endExclusive),
  ]);

  let currentTotal = 0;
  let currentLargest = 0;
  for (const expense of currentExpenses) {
    currentTotal += expense.amount;
    currentLargest = Math.max(currentLargest, expense.amount);
  }

  return {
    currentMonth,
    currentExpenses,
    currentTotal,
    currentCount: currentExpenses.length,
    currentAverage: currentExpenses.length ? currentTotal / currentExpenses.length : 0,
    currentLargest,
    analytics: calculateAnalytics(analyticsExpenses, analyticsRange),
  };
}
