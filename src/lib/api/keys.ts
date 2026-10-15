import type { AnalyticsFilters } from "@/lib/expenses/types";
import { resolveMainExpenseMonth } from "@/lib/calendar";
import { expenseTabFilterParams, type ExpenseTabFilters } from "@/lib/expenses/filters";
import type { ExpenseTab } from "@/lib/expenses/tabs";

// Each key notes the response type its GET returns. Types owned by a domain
// module are referenced there; wrapper shapes that only exist on the wire live here.

/** GET → `AccountData` (`@/lib/account/types`); PATCH returns the updated `AccountData`. */
export const ACCOUNT_API_KEY = "/api/account";
/** GET → `InvestmentsOverview` (`@/lib/investments/types`). */
export const INVESTMENTS_API_KEY = "/api/investments";
/** GET → `NetWorthOverview` (`@/lib/net-worth/types`). */
export const NET_WORTH_API_KEY = "/api/net-worth";
/** GET → {@link TabsResponse}; POST returns {@link SavedTabResponse}. */
export const EXPENSE_TABS_API_KEY = "/api/expense-tabs";

export type TabsResponse = { tabs: ExpenseTab[] };
export type SavedTabResponse = { tab: ExpenseTab };

/** PATCH → {@link SavedTabResponse}; DELETE → `{ success: true }`. */
export function expenseTabApiKey(id: string) {
  return `${EXPENSE_TABS_API_KEY}/${encodeURIComponent(id)}`;
}

/** GET → `ExpenseTabLedgerData` (`@/lib/expenses/tabs`). */
export function expenseTabExpensesApiKey(id: string, filters: ExpenseTabFilters, revision?: string) {
  const params = expenseTabFilterParams(filters);
  if (revision) params.set("revision", revision);
  return `${expenseTabApiKey(id)}/expenses?${params}`;
}

/** GET → `DashboardData` (`@/lib/expenses/types`). */
export function dashboardApiKey(filters: AnalyticsFilters) {
  const params = new URLSearchParams({
    period: filters.period,
    granularity: filters.granularity,
    date: filters.customDate,
  });
  return `/api/dashboard?${params}`;
}

/** GET → `ExpensesData` (`@/lib/expenses/types`). */
export function expensesApiKey(month: string) {
  return `/api/expenses?month=${encodeURIComponent(month)}`;
}

/** GET → `ExpensesData` (`@/lib/expenses/types`). */
export function mainExpensesApiKey(month: string) {
  return `${expensesApiKey(resolveMainExpenseMonth(month))}&context=main`;
}

export function mainExpensesExportUrl(month: string) {
  return `/api/expenses/export?month=${encodeURIComponent(resolveMainExpenseMonth(month))}`;
}

/** GET → `InvestmentTransactionsResponse` (`@/lib/investments/types`). */
export function investmentTransactionsApiKey({
  accountId,
  instrument,
  currency,
}: {
  accountId: string;
  instrument: string;
  currency: string;
}) {
  const params = new URLSearchParams({ accountId, instrument, currency });
  return `/api/investment-transactions?${params}`;
}
