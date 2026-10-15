import "server-only";

import { analyticsFromSummary, resolveAnalyticsRange } from "@/lib/expenses/analytics";
import type { ExpenseTabFilters } from "@/lib/expenses/filters";
import { summarizeExpenses } from "@/lib/expenses/summary";
import type { AnalyticsFilters, DashboardData } from "@/lib/expenses/types";
import { getBucharestMonth, getMonthRange } from "@/lib/calendar";
import { getRepositories } from "@/lib/repositories";

// Use cases shared by the REST routes and the MCP tools; each transport only reshapes the result.

export async function getMonthlyLedger(userId: string, month: string) {
  const expenses = await getRepositories().expenses.listMonth(userId, month);
  return { month, expenses, ...summarizeExpenses(expenses) };
}

/** Returns null when the user owns no tab with this id. */
export async function getExpenseTabLedger(userId: string, tabId: string, filters: ExpenseTabFilters) {
  const repositories = getRepositories();
  const tab = await repositories.expenseTabs.get(userId, tabId);
  if (!tab) return null;
  const expenses = await repositories.expenses.listForTab(userId, tab, filters);
  return { tab, filters, expenses, ...summarizeExpenses(expenses) };
}

/** The dashboard for the current Bucharest month, with analytics over the filters' range. */
export async function getDashboardData(userId: string, filters: AnalyticsFilters): Promise<DashboardData> {
  const currentMonth = getBucharestMonth();
  const analyticsRange = resolveAnalyticsRange(filters, currentMonth);
  const { currentExpenses, summary } = await getRepositories().expenses.getDashboard(userId, {
    current: getMonthRange(currentMonth),
    analytics: analyticsRange,
  });

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
