import type {
  AnalyticsFilters,
  AnalyticsPeriod,
  CustomGranularity,
} from "@/lib/types";
import { getCurrentMonth, isValidDate, isValidMonth } from "@/lib/utils/dates";

type SearchParamsReader = { get(name: string): string | null };

export function parseAnalyticsFilters(params: SearchParamsReader): AnalyticsFilters {
  const rawPeriod = params.get("period");
  const period: AnalyticsPeriod = ["3m", "6m", "1y", "2y", "custom"].includes(
    rawPeriod ?? "",
  )
    ? (rawPeriod as AnalyticsPeriod)
    : "3m";
  const granularity: CustomGranularity = params.get("granularity") === "day" ? "day" : "month";
  const rawDate = params.get("date") ?? "";
  const today = new Date().toISOString().slice(0, 10);
  const customDate =
    granularity === "day"
      ? isValidDate(rawDate)
        ? rawDate
        : today
      : isValidMonth(rawDate)
        ? rawDate
        : getCurrentMonth();

  return { period, granularity, customDate };
}
