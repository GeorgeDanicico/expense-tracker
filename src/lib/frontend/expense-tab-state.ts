import { DEFAULT_EXPENSE_TAB_FILTERS, expenseTabFiltersSchema, type ExpenseTabFilters } from "@/lib/expenses/tab-filters";

type SearchParams = { get(name: string): string | null };
const FILTER_KEYS = ["scope", "year", "startDate", "endDate", "subtype", "category", "search"] as const;

/** Ignore the separately retained main month, but reject incompatible custom date modes. */
export function parseExpenseTabFilters(params: SearchParams) {
  const raw: Record<string, unknown> = { scope: params.get("scope") ?? "all" };
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value !== null) raw[key] = key === "year" ? (/^\d{4}$/.test(value) ? Number(value) : NaN) : value;
  }
  return expenseTabFiltersSchema.safeParse(raw);
}

export function readExpenseTabFilters(params: SearchParams): ExpenseTabFilters {
  const parsed = parseExpenseTabFilters(params);
  return parsed.success ? parsed.data : { ...DEFAULT_EXPENSE_TAB_FILTERS };
}

export function expenseTabFilterParams(filters: ExpenseTabFilters) {
  const params = new URLSearchParams({ scope: filters.scope });
  if (filters.scope === "year") params.set("year", String(filters.year));
  if (filters.scope === "range") {
    params.set("startDate", filters.startDate);
    params.set("endDate", filters.endDate);
  }
  if (filters.subtype !== "all") params.set("subtype", filters.subtype);
  if (filters.category) params.set("category", filters.category);
  if (filters.search) params.set("search", filters.search.trim());
  return params;
}

/** Passing no filters on a tab click deliberately opens its all-time scope. */
export function expenseTabHref(params: SearchParams & { toString(): string }, tabId: string | null,
  filters: ExpenseTabFilters = DEFAULT_EXPENSE_TAB_FILTERS) {
  const next = new URLSearchParams(params.toString());
  for (const key of FILTER_KEYS) next.delete(key);
  next.delete("tab");
  if (tabId) {
    next.set("tab", tabId);
    for (const [key, value] of expenseTabFilterParams(filters)) next.set(key, value);
  }
  return `/expenses${next.size ? `?${next}` : ""}`;
}
