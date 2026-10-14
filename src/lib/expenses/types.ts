import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";

export type Expense = {
  id: string;
  description: string;
  amount: number;
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
  expenseDate: string;
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

export type ExpensesData = {
  month: string;
  expenses: Expense[];
  total: number;
  average: number;
};
