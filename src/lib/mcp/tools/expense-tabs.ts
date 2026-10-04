import { z } from "zod";

import {
  createExpenseTabForUser,
  deleteExpenseTabForUser,
  getExpenseTabForUser,
  getExpenseTabsForUser,
  updateExpenseTabForUser,
} from "@/lib/data/expense-tabs";
import { getExpenseTabExpensesForUser } from "@/lib/data/expenses";
import { EXPENSE_CATEGORIES, EXPENSE_SUBTYPES } from "@/lib/expenses/categories";
import { summarizeExpenses } from "@/lib/expenses/summary";
import { DEFAULT_EXPENSE_TAB_FILTERS, expenseTabFiltersSchema } from "@/lib/expenses/tab-filters";
import { CREATE, defineTool, DELETE, READ, UPDATE } from "@/lib/mcp/define-tool";
import { expenseTabSchema } from "@/lib/validation/expense-tab";

const tabFields = {
  name: z.string(),
  categoryKeys: z.array(z.enum(EXPENSE_CATEGORIES)).default([]),
  subtypeKeys: z.array(z.enum(EXPENSE_SUBTYPES)).default([]),
};
const idSchema = z.object({ id: z.uuid() });
const updateTabSchema = z.object({ id: z.uuid(), ...tabFields });

// The filters union is advertised flat; the real discriminated schema validates it in the handler.
const flatFilters = z.object({
  scope: z.enum(["all", "year", "range"]).optional().describe("year needs year; range needs startDate and endDate (YYYY-MM-DD)"),
  year: z.number().int().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  category: z.enum(EXPENSE_CATEGORIES).nullable().optional(),
  subtype: z.enum(["all", "none", ...EXPENSE_SUBTYPES]).optional(),
  search: z.string().optional(),
});
const tabExpensesSchema = z.object({
  tabId: z.uuid(),
  filters: z.preprocess(
    (value) => value && typeof value === "object" ? { scope: "all", ...value } : value,
    expenseTabFiltersSchema,
  ).default(DEFAULT_EXPENSE_TAB_FILTERS),
});

export const expenseTabTools = [
  defineTool({
    name: "list_expense_tabs",
    title: "List expense tabs",
    description: "Saved expense tabs, each grouping categories and subtypes.",
    schema: z.object({}),
    annotations: READ,
    run: async (_input, { userId }) => ({ tabs: await getExpenseTabsForUser(userId) }),
  }),
  defineTool({
    name: "get_expense_tab_expenses",
    title: "Get expense tab expenses",
    description: "Expenses in a tab with total, count and average. Filters default to all time.",
    schema: tabExpensesSchema,
    shape: { tabId: z.uuid(), filters: flatFilters.optional() },
    annotations: READ,
    notFound: "Expense tab not found.",
    run: async ({ tabId, filters }, { userId }) => {
      const tab = await getExpenseTabForUser(userId, tabId);
      if (!tab) return null;
      const expenses = await getExpenseTabExpensesForUser(userId, tab, filters);
      return { tab, filters, expenses, ...summarizeExpenses(expenses) };
    },
  }),
  defineTool({
    name: "create_expense_tab",
    title: "Create expense tab",
    description: "Save a tab of categories and/or subtypes (at least one).",
    schema: expenseTabSchema,
    shape: tabFields,
    annotations: CREATE,
    run: async (input, { userId }) => ({ tab: await createExpenseTabForUser(userId, input) }),
  }),
  defineTool({
    name: "update_expense_tab",
    title: "Update expense tab",
    description: "Replace a tab's name, categories and subtypes.",
    schema: updateTabSchema,
    annotations: UPDATE,
    notFound: "Expense tab not found.",
    run: async ({ id, ...input }, { userId }) => {
      const tab = await updateExpenseTabForUser(userId, id, expenseTabSchema.parse(input));
      return tab && { tab };
    },
  }),
  defineTool({
    name: "delete_expense_tab",
    title: "Delete expense tab",
    description: "Permanently delete a saved tab. Its expenses are kept.",
    schema: idSchema,
    annotations: DELETE,
    notFound: "Expense tab not found.",
    run: async ({ id }, { userId }) => (await deleteExpenseTabForUser(userId, id)) && { deleted: true, id },
  }),
];
