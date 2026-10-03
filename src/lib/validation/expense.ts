import { z } from "zod";

import { EXPENSE_CATEGORIES, EXPENSE_SUBTYPES, SUBTYPE_CATEGORIES } from "@/lib/expenses/categories";

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
