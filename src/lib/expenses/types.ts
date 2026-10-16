import type { Viewing } from "@/lib/family/viewing";
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

/** An expense row as the lists show it; the family view adds whose it is and the currency to show it in. */
export type ListedExpense = Expense & { memberName?: string; currency?: string };

/** Expense figures in one currency. Totals of different currencies are never added together. */
export type CurrencyTotals = {
  currency: string;
  total: number;
  count: number;
  average: number;
  largest: number;
};

/** One member's share of the family view. */
export type MemberTotals = { memberId: string; name: string; currency: string; total: number; count: number };

/** `GET /api/expenses?member=all`: every member's month, newest first, with totals per currency. */
export type FamilyExpensesData = {
  month: string;
  expenses: (Expense & { memberId: string; memberName: string; currency: string })[];
  totals: CurrencyTotals[];
  viewing: Viewing;
};

/** `GET /api/dashboard?member=all`: the current month and the analytics range, combined per currency. */
export type FamilyDashboardData = {
  currentMonth: string;
  /** The current month, one entry per currency. */
  totals: CurrencyTotals[];
  /** The analytics range's totals, one entry per currency. */
  analyticsTotals: { currency: string; total: number; count: number }[];
  analyticsLabel: string;
  members: MemberTotals[];
  /** The newest five expenses across the family. */
  currentExpenses: FamilyExpensesData["expenses"];
  viewing: Viewing;
};
