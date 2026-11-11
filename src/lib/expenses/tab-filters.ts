import { addDays, isValidDate, toIsoDate } from "@/lib/calendar";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  EXPENSE_SUBTYPES,
  SUBTYPE_LABELS,
  type ExpenseCategory,
  type ExpenseSubtype,
} from "@/lib/expenses/categories";
import type { Expense } from "@/lib/expenses/types";

/**
 * The expense filters and everything the browser does with them, without Zod: the filter types, the URL
 * parameters they read from and write to, and the ledger's search. `filters.ts` adds the Zod schema the
 * server and the custom-tab filter form validate with, and re-exports all of this. SWR's keys
 * (`src/lib/api/keys.ts`) import the filters, so a Zod import here put Zod (about 23 KiB gzipped) in
 * the first load of every page (PF9).
 */

export type ExpenseTabFilters = {
  subtype: "all" | "none" | ExpenseSubtype;
  category: ExpenseCategory | null;
  search: string;
} & (
  | { scope: "all" }
  | { scope: "year"; year: number }
  | { scope: "range"; startDate: string; endDate: string }
);

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

/** What the search calls an expense without a subtype. The server's search (`expenseSearchFilter`) uses it too. */
export const NO_SUBTYPE_LABEL = "No subtype";

/** Whether the expense's text, category or subtype contains `term`, which is already lower-cased. */
export function matchesExpenseSearch(expense: Expense, term: string) {
  return [expense.description, expense.notes ?? "", CATEGORY_LABELS[expense.category],
    expense.subtype ? SUBTYPE_LABELS[expense.subtype] : NO_SUBTYPE_LABEL]
    .some((value) => value.toLowerCase().includes(term));
}

/** The month ledger's search and category filter (behind the Expenses screen's Filters chip). */
export type LedgerFilter = { query: string; category: ExpenseCategory | "all" };

export const NO_LEDGER_FILTER: LedgerFilter = { query: "", category: "all" };

/** The expenses `filter` keeps: the search in the description, notes, category or subtype, and the category. */
export function filterExpenses<T extends Expense>(expenses: readonly T[], { query, category }: LedgerFilter) {
  const term = query.trim().toLocaleLowerCase();
  return expenses.filter((expense) => (category === "all" || expense.category === category) && (!term || matchesExpenseSearch(expense, term)));
}

export type SearchParams = { get(name: string): string | null };
export const FILTER_KEYS = ["scope", "year", "startDate", "endDate", "subtype", "category", "search"] as const;


type Raw = Record<string, unknown>;

const SUBTYPE_FILTERS = ["all", "none", ...EXPENSE_SUBTYPES] as const;
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);

/**
 * `raw` as filters, or null when it isn't valid: the rules of `expenseTabFiltersSchema` (`filters.ts`), written
 * out so the browser doesn't need Zod. `filters.test.ts` runs both on the same inputs.
 */
export function filtersFromRaw(raw: Raw): ExpenseTabFilters | null {
  const { scope, year, startDate, endDate } = raw;
  const subtype = raw.subtype === undefined ? "all" : raw.subtype;
  const category = raw.category === undefined ? null : raw.category;
  const search = raw.search === undefined ? "" : raw.search;
  const allowed = new Set(["scope", "subtype", "category", "search", ...(scope === "year" ? ["year"] : scope === "range" ? ["startDate", "endDate"] : [])]);
  if (!Object.keys(raw).every((key) => allowed.has(key))) return null;
  if (!isOneOf(SUBTYPE_FILTERS, subtype)) return null;
  if (category !== null && !isOneOf(EXPENSE_CATEGORIES, category)) return null;
  if (typeof search !== "string" || search.trim().length > 200) return null;
  const common = { subtype, category, search: search.trim() };
  if (scope === "all") return { ...common, scope };
  if (scope === "year") {
    return typeof year === "number" && Number.isInteger(year) && year >= 100 && year <= 9999 ? { ...common, scope, year } : null;
  }
  if (scope === "range") {
    if (typeof startDate !== "string" || typeof endDate !== "string") return null;
    if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) return null;
    return { ...common, scope, startDate, endDate };
  }
  return null;
}

/** The filters in the page's query, as the raw object `filtersFromRaw` and the schema both read. */
export function rawFilters(params: SearchParams): Raw {
  const raw: Raw = { scope: params.get("scope") ?? "all" };
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value !== null) raw[key] = key === "year" ? (/^\d{4}$/.test(value) ? Number(value) : NaN) : value;
  }
  return raw;
}

/** The filters in the page's query, or the defaults when they are missing or invalid (all time, nothing filtered). */
export function readExpenseTabFilters(params: SearchParams): ExpenseTabFilters {
  return filtersFromRaw(rawFilters(params)) ?? { ...DEFAULT_EXPENSE_TAB_FILTERS };
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
