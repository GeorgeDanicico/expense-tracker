import type {
  AnalyticsFilters,
  AnalyticsPeriod,
  CustomGranularity,
} from "@/lib/types";
import {
  ANALYTICS_PERIODS,
  getProcessLocalMonth,
  getUtcToday,
  isValidDate,
  isValidMonth,
} from "@/lib/calendar";

type SearchParamsReader = { get(name: string): string | null };

export function parseAnalyticsFilters(params: SearchParamsReader): AnalyticsFilters {
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
