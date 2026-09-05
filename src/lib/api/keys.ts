import type { AnalyticsFilters } from "@/lib/types";

export const ACCOUNT_API_KEY = "/api/account";

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
