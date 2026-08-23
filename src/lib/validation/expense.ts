import { z } from "zod";

import { EXPENSE_CATEGORIES } from "@/lib/types";

export const expenseSchema = z.object({
  description: z.string().trim().min(1, "Enter a description.").max(120),
  amount: z.coerce.number().positive("Amount must be greater than zero.").max(9_999_999_999.99),
  category: z.enum(EXPENSE_CATEGORIES),
  expenseDate: z.iso.date("Choose a valid date."),
  notes: z.string().trim().max(500).optional(),
});
