import { z } from "zod";

import { EXPENSE_CATEGORIES, EXPENSE_SUBTYPES } from "@/lib/expenses/categories";
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
