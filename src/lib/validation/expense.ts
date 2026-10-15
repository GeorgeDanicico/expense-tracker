import { z } from "zod";

import {
  EXPENSE_CATEGORIES,
  EXPENSE_SUBTYPES,
  SUBTYPE_CATEGORIES,
  subtypeForCategory,
  type ExpenseCategory,
  type ExpenseSubtype,
} from "@/lib/expenses/categories";
import type { Expense } from "@/lib/expenses/types";

export const expenseSchema = z.object({
  description: z.string().trim().min(1, "Enter a description.").max(120),
  amount: z.coerce.number().positive("Amount must be greater than zero.").max(9_999_999_999.99),
  category: z.enum(EXPENSE_CATEGORIES),
  subtype: z.enum(EXPENSE_SUBTYPES).nullable().optional().default(null),
  expenseDate: z.iso.date("Choose a valid date."),
  notes: z.string().trim().max(500).optional(),
}).superRefine((expense, context) => {
  if (expense.subtype && SUBTYPE_CATEGORIES[expense.subtype] !== expense.category) {
    context.addIssue({ code: "custom", path: ["subtype"], message: "Choose a subtype belonging to the selected category." });
  }
});

/** A validated expense, ready to store. */
export type ExpenseInput = z.output<typeof expenseSchema>;

/** A partial change to a stored expense; `applyExpensePatch` validates the merged result. */
export type ExpensePatch = Partial<{
  description: string;
  amount: number | string;
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
  expenseDate: string;
  notes: string | null;
}>;

/**
 * Merges the patch into the stored expense and re-validates the whole expense with `expenseSchema`,
 * throwing its ZodError for an invalid result. A category change without an explicit subtype keeps
 * the stored subtype only when it still belongs.
 */
export function applyExpensePatch(current: Expense, patch: ExpensePatch): ExpenseInput {
  const category = patch.category ?? current.category;
  const subtype = patch.subtype !== undefined
    ? patch.subtype
    : patch.category !== undefined ? subtypeForCategory(category, current.subtype) : current.subtype;
  const notes = patch.notes !== undefined ? patch.notes ?? "" : current.notes ?? undefined;
  return expenseSchema.parse({
    description: patch.description ?? current.description,
    amount: patch.amount ?? current.amount,
    category,
    subtype,
    expenseDate: patch.expenseDate ?? current.expenseDate,
    notes,
  });
}
