import "server-only";

import { analyticsFromSummary, resolveAnalyticsRange } from "@/lib/expenses/analytics";
import type { ExpenseTabFilters } from "@/lib/expenses/filters";
import { summarizeExpenses } from "@/lib/expenses/summary";
import { compareFamilyExpenses, groupByCurrency } from "@/lib/expenses/family";
import type {
  AnalyticsFilters,
  DashboardData,
  FamilyDashboardData,
  FamilyExpensesData,
} from "@/lib/expenses/types";
import { formatMonth, getBucharestMonth, getMonthRange } from "@/lib/calendar";
import type { FamilyViewer } from "@/lib/family/viewed-user";
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

// The family view (`?member=all`): each member is fetched on their own through the repository, then
// combined here. Money is only ever added within one currency.

/** Every member's expenses for `month`, newest first, with totals per currency. */
export async function getFamilyMonthlyLedger(viewers: FamilyViewer[], month: string) {
  const { expenses: repository } = getRepositories();
  const perMember = await Promise.all(viewers.map((viewer) => repository.listMonth(viewer.userId, month)));
  const expenses = perMember
    .flatMap((list, index) =>
      list.map((expense) => ({
        ...expense,
        memberId: viewers[index].memberId,
        memberName: viewers[index].name,
        currency: viewers[index].currency,
      })),
    )
    .toSorted(compareFamilyExpenses);
  const totals = groupByCurrency(
    expenses.map((expense) => ({ currency: expense.currency, total: expense.amount, count: 1, largest: expense.amount })),
  );
  return { month, expenses, totals } satisfies Omit<FamilyExpensesData, "viewing">;
}

/** The dashboard for the whole family: this month and the analytics range, combined per currency. */
export async function getFamilyDashboardData(
  viewers: FamilyViewer[],
  filters: AnalyticsFilters,
): Promise<Omit<FamilyDashboardData, "viewing">> {
  const perMember = await Promise.all(viewers.map((viewer) => getDashboardData(viewer.userId, filters)));
  const first = perMember[0];
  return {
    currentMonth: first?.currentMonth ?? getBucharestMonth(),
    totals: groupByCurrency(
      perMember.map((data, index) => ({
        currency: viewers[index].currency,
        total: data.currentTotal,
        count: data.currentCount,
        largest: data.currentLargest,
      })),
    ),
    analyticsTotals: groupByCurrency(
      perMember.map((data, index) => ({
        currency: viewers[index].currency,
        total: data.analytics.total,
        count: data.analytics.count,
        largest: 0,
      })),
    ).map(({ currency, total, count }) => ({ currency, total, count })),
    analyticsLabel: first?.analytics.label ?? "",
    members: perMember.map((data, index) => ({
      memberId: viewers[index].memberId,
      name: viewers[index].name,
      currency: viewers[index].currency,
      total: data.currentTotal,
      count: data.currentCount,
      series: [
        ...data.analytics.series.filter((point) => point.key !== data.currentMonth),
        { key: data.currentMonth, label: formatMonth(data.currentMonth), total: data.currentTotal },
      ],
      categoryTotals: data.analytics.categoryTotals,
    })),
    currentExpenses: perMember
      .flatMap((data, index) =>
        data.currentExpenses.map((expense) => ({
          ...expense,
          memberId: viewers[index].memberId,
          memberName: viewers[index].name,
          currency: viewers[index].currency,
        })),
      )
      .toSorted(compareFamilyExpenses),
  };
}
