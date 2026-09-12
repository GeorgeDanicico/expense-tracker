import type { AnalyticsFilters } from "@/lib/types";

export const ACCOUNT_API_KEY = "/api/account";
export const INVESTMENTS_API_KEY = "/api/investments";

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
