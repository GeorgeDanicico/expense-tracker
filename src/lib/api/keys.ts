import type { AnalyticsFilters } from "@/lib/types";
import { resolveMainExpenseMonth } from "@/lib/utils/dates";
import { expenseTabFilterParams } from "@/lib/frontend/expense-tab-state";
import type { ExpenseTabFilters } from "@/lib/expenses/tab-filters";

export const ACCOUNT_API_KEY = "/api/account";
export const INVESTMENTS_API_KEY = "/api/investments";
export const NET_WORTH_API_KEY = "/api/net-worth";
export const EXPENSE_TABS_API_KEY = "/api/expense-tabs";

export function expenseTabApiKey(id: string) {
  return `${EXPENSE_TABS_API_KEY}/${encodeURIComponent(id)}`;
}

export function expenseTabExpensesApiKey(id: string, filters: ExpenseTabFilters, revision?: string) {
  const params = expenseTabFilterParams(filters);
  if (revision) params.set("revision", revision);
  return `${expenseTabApiKey(id)}/expenses?${params}`;
}

export function dashboardApiKey(filters: AnalyticsFilters) {
  const params = new URLSearchParams({
    period: filters.period,
    granularity: filters.granularity,
    date: filters.customDate,
  });
  return `/api/dashboard?${params}`;
}

export function expensesApiKey(month: string) {
  return `/api/expenses?month=${encodeURIComponent(month)}`;
}

export function mainExpensesApiKey(month: string) {
  return `${expensesApiKey(resolveMainExpenseMonth(month))}&context=main`;
}

export function mainExpensesExportUrl(month: string) {
  return `/api/expenses/export?month=${encodeURIComponent(resolveMainExpenseMonth(month))}`;
}

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
