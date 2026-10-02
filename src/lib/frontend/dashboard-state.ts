import { getCurrentMonth, isValidMonth } from "@/lib/utils/dates";

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
  currentMonth = getCurrentMonth(),
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
