import { z } from "zod";

import { EXPENSE_CATEGORIES, EXPENSE_SUBTYPES } from "@/lib/expenses/categories";
import { rawFilters, type ExpenseTabFilters, type SearchParams } from "@/lib/expenses/tab-filters";
import { calendarDate } from "@/lib/validation/primitives";

// The Zod schema for the filters, for the server and the custom-tab filter form. What the browser reads them with, and
// everything else about them, is in `tab-filters.ts` (no Zod, PF9); it is all exported from here too.
export * from "@/lib/expenses/tab-filters";

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

// `tab-filters.ts` writes the same type out by hand; this fails to compile when the two drift.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _typesMatch: Same<z.infer<typeof expenseTabFiltersSchema>, ExpenseTabFilters> = true;
void _typesMatch;

/** Ignore the separately retained main month, but reject incompatible custom date modes. */
export function parseExpenseTabFilters(params: SearchParams) {
  return expenseTabFiltersSchema.safeParse(rawFilters(params));
}

