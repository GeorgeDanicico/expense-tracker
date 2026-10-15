import { z } from "zod";

import { CATEGORY_LABELS, EXPENSE_CATEGORIES, SUBTYPE_LABELS, subtypesForCategory } from "@/lib/expenses/categories";
import { defineTool, READ } from "@/lib/mcp/define-tool";
import { getBucharestToday } from "@/lib/calendar";
import { getRepositories } from "@/lib/repositories";

export const accountTools = [
  defineTool({
    name: "get_account",
    title: "Get account",
    description: "Account email, currency, today's date and the expense categories with their subtypes.",
    schema: z.object({}),
    annotations: READ,
    run: async (_input, { userId, email }) => ({
      email,
      currency: await getRepositories().account.getCurrency(userId),
      today: getBucharestToday(),
      categories: EXPENSE_CATEGORIES.map((category) => ({
        key: category,
        label: CATEGORY_LABELS[category],
        subtypes: subtypesForCategory(category).map((subtype) => ({ key: subtype, label: SUBTYPE_LABELS[subtype] })),
      })),
    }),
  }),
];
