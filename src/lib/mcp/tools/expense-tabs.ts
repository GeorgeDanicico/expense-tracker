import { z } from "zod";

import { getExpenseTabLedgerForUser } from "@/lib/data/ledgers";
import { EXPENSE_CATEGORIES, EXPENSE_SUBTYPES } from "@/lib/expenses/categories";
import { DEFAULT_EXPENSE_TAB_FILTERS, expenseTabFiltersSchema } from "@/lib/expenses/filters";
import { CREATE, defineTool, DELETE, READ, UPDATE } from "@/lib/mcp/define-tool";
import { getRepositories } from "@/lib/repositories";
import { expenseTabSchema } from "@/lib/validation/expense-tab";
import { idSchema } from "@/lib/validation/primitives";

const tabFields = {
  name: z.string(),
  categoryKeys: z.array(z.enum(EXPENSE_CATEGORIES)).default([]),
  subtypeKeys: z.array(z.enum(EXPENSE_SUBTYPES)).default([]),
};
const idInput = z.object({ id: idSchema() });
const updateTabSchema = z.object({ id: idSchema(), ...tabFields });

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
  tabId: idSchema(),
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
    run: async (_input, { userId }) => ({ tabs: await getRepositories().expenseTabs.list(userId) }),
  }),
  defineTool({
    name: "get_expense_tab_expenses",
    title: "Get expense tab expenses",
    description: "Expenses in a tab with total, count and average. Filters default to all time.",
    schema: tabExpensesSchema,
    shape: { tabId: idSchema(), filters: flatFilters.optional() },
    annotations: READ,
    notFound: "Expense tab not found.",
    run: ({ tabId, filters }, { userId }) => getExpenseTabLedgerForUser(userId, tabId, filters),
  }),
  defineTool({
    name: "create_expense_tab",
    title: "Create expense tab",
    description: "Save a tab of categories and/or subtypes (at least one).",
    schema: expenseTabSchema,
    shape: tabFields,
    annotations: CREATE,
    run: async (input, { userId }) => ({ tab: await getRepositories().expenseTabs.create(userId, input) }),
  }),
  defineTool({
    name: "update_expense_tab",
    title: "Update expense tab",
    description: "Replace a tab's name, categories and subtypes.",
    schema: updateTabSchema,
    annotations: UPDATE,
    notFound: "Expense tab not found.",
    run: async ({ id, ...input }, { userId }) => {
      const tab = await getRepositories().expenseTabs.update(userId, id, expenseTabSchema.parse(input));
      return tab && { tab };
    },
  }),
  defineTool({
    name: "delete_expense_tab",
    title: "Delete expense tab",
    description: "Permanently delete a saved tab. Its expenses are kept.",
    schema: idInput,
    annotations: DELETE,
    notFound: "Expense tab not found.",
    run: async ({ id }, { userId }) => (await getRepositories().expenseTabs.delete(userId, id)) && { deleted: true, id },
  }),
];
