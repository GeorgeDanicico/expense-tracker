import { z } from "zod";

import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  EXPENSE_SUBTYPES,
  SUBTYPE_LABELS,
} from "@/lib/expenses/categories";
import type { Expense } from "@/lib/expenses/types";
import { addDays, toIsoDate } from "@/lib/calendar";
import { calendarDate } from "@/lib/validation/primitives";

const common = {
  subtype: z.enum(["all", "none", ...EXPENSE_SUBTYPES]).default("all"),
  category: z.enum(EXPENSE_CATEGORIES).nullable().default(null),
  search: z.string().trim().max(200).default(""),
};

export const expenseTabFiltersSchema = z.discriminatedUnion("scope", [
  z.object({ ...common, scope: z.literal("all") }).strict(),
  z.object({ ...common, scope: z.literal("year"), year: z.number().int().min(100).max(9999) }).strict(),
  z.object({ ...common, scope: z.literal("range"), startDate: calendarDate, endDate: calendarDate }).strict(),
]).refine((filters) => filters.scope !== "range" || filters.startDate <= filters.endDate, {
  message: "The end date must be on or after the start date.", path: ["endDate"],
});

export type ExpenseTabFilters = z.infer<typeof expenseTabFiltersSchema>;
export const DEFAULT_EXPENSE_TAB_FILTERS: ExpenseTabFilters = {
  scope: "all", subtype: "all", category: null, search: "",
};

/** Expense dates are calendar dates; midnight and timezone offsets never enter the query. */
export function expenseTabDateBounds(filters: ExpenseTabFilters) {
  if (filters.scope === "all") return {};
  if (filters.scope === "year") {
    return { start: toIsoDate(filters.year, 1, 1),
      endExclusive: `${filters.year + 1}-01-01` };
  }
  return { start: filters.startDate, endExclusive: addDays(filters.endDate, 1) };
}

/** Whether the expense's text, category or subtype contains `term`, which is already lower-cased. */
export function matchesExpenseSearch(expense: Expense, term: string) {
  return [expense.description, expense.notes ?? "", CATEGORY_LABELS[expense.category],
    expense.subtype ? SUBTYPE_LABELS[expense.subtype] : "No subtype"]
    .some((value) => value.toLowerCase().includes(term));
}

type SearchParams = { get(name: string): string | null };
export const FILTER_KEYS = ["scope", "year", "startDate", "endDate", "subtype", "category", "search"] as const;

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
