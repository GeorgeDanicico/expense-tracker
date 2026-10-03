import { z } from "zod";

import { EXPENSE_CATEGORIES, EXPENSE_SUBTYPES } from "@/lib/expenses/categories";
import { isValidDate } from "@/lib/utils/dates";

const common = {
  subtype: z.enum(["all", "none", ...EXPENSE_SUBTYPES]).default("all"),
  category: z.enum(EXPENSE_CATEGORIES).nullable().default(null),
  search: z.string().trim().max(200).default(""),
};
const calendarDate = z.string().refine(isValidDate, "Choose a real calendar date.");

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
    return { start: `${String(filters.year).padStart(4, "0")}-01-01`,
      endExclusive: `${filters.year + 1}-01-01` };
  }
  const end = new Date(`${filters.endDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const endExclusive = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}`;
  return { start: filters.startDate, endExclusive };
}
