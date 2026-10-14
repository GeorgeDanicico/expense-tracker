import {
  ANALYTICS_PERIODS,
  getProcessLocalMonth,
  getUtcToday,
  isValidDate,
  isValidMonth,
} from "@/lib/calendar";
import type {
  AnalyticsFilters,
  AnalyticsPeriod,
  CustomGranularity,
} from "@/lib/expenses/types";

export type DashboardView = "summary" | "monthly" | "history";
type Params = { get(name: string): string | null };

export function dashboardView(params: Params): DashboardView {
  const view = params.get("view");
  if (view === "monthly" || view === "history" || view === "summary")
    return view;
  if (
    view === null &&
    ["period", "granularity", "date"].some((key) => params.get(key) !== null)
  )
    return "history";
  return "summary";
}

export function dashboardMonth(
  params: Params,
  currentMonth = getProcessLocalMonth(),
) {
  const month = params.get("month") ?? "";
  return isValidMonth(month) ? month : currentMonth;
}

export function dashboardHref(
  params: URLSearchParams,
  changes: Record<string, string>,
) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) next.set(key, value);
  return `/dashboard?${next}`;
}

export function parseAnalyticsFilters(params: Params): AnalyticsFilters {
  const rawPeriod = params.get("period");
  const period: AnalyticsPeriod = (ANALYTICS_PERIODS as readonly string[]).includes(
    rawPeriod ?? "",
  )
    ? (rawPeriod as AnalyticsPeriod)
    : "3m";
  const granularity: CustomGranularity = params.get("granularity") === "day" ? "day" : "month";
  const rawDate = params.get("date") ?? "";
  const today = getUtcToday();
  const customDate =
    granularity === "day"
      ? isValidDate(rawDate)
        ? rawDate
        : today
      : isValidMonth(rawDate)
        ? rawDate
        : getProcessLocalMonth();

  return { period, granularity, customDate };
}
