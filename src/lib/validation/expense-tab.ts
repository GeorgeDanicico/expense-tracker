import { z } from "zod";

import { EXPENSE_CATEGORIES, EXPENSE_SUBTYPES, SUBTYPE_CATEGORIES } from "@/lib/expenses/categories";

export const expenseTabIdSchema = z.uuid();

export const expenseTabSchema = z.object({
  name: z.string().trim().min(1, "Enter a tab name.").max(80, "Use at most 80 characters."),
  categoryKeys: z.array(z.enum(EXPENSE_CATEGORIES)),
  subtypeKeys: z.array(z.enum(EXPENSE_SUBTYPES)),
}).superRefine((value, context) => {
  if (!value.categoryKeys.length && !value.subtypeKeys.length) {
    context.addIssue({ code: "custom", path: ["categoryKeys"], message: "Choose at least one category or subtype." });
  }
}).transform((value) => {
  const categoryKeys = [...new Set(value.categoryKeys)];
  const subtypeKeys = [...new Set(value.subtypeKeys)].filter(
    (subtype) => !categoryKeys.includes(SUBTYPE_CATEGORIES[subtype]),
  );
  return { name: value.name, categoryKeys, subtypeKeys };
});
