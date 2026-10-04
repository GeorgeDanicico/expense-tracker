import { z } from "zod";

import {
  createExpenseForUser,
  deleteExpenseForUser,
  getDashboardDataForUser,
  getMonthlyExpensesForUser,
  updateExpenseForUser,
} from "@/lib/data/expenses";
import { EXPENSE_CATEGORIES, EXPENSE_SUBTYPES } from "@/lib/expenses/categories";
import { summarizeExpenses } from "@/lib/expenses/summary";
import { CREATE, defineTool, DELETE, READ, UPDATE } from "@/lib/mcp/define-tool";
import { parseAnalyticsFilters } from "@/lib/utils/analytics";
import { getApplicationCurrentMonth, getApplicationToday, isValidDate, isValidMonth } from "@/lib/utils/dates";
import { expenseSchema } from "@/lib/validation/expense";

const fields = expenseSchema.shape;
const idSchema = z.object({ id: z.uuid() });

const spendingSummarySchema = z.object({
  period: z.enum(["3m", "6m", "1y", "2y", "custom"]).default("3m"),
  granularity: z.enum(["month", "day"]).default("month"),
  date: z.string().optional().describe("custom only: YYYY-MM for month, YYYY-MM-DD for day"),
}).superRefine((value, context) => {
  if (value.period !== "custom" || value.date === undefined) return;
  const valid = value.granularity === "day" ? isValidDate(value.date) : isValidMonth(value.date);
  if (!valid) context.addIssue({ code: "custom", path: ["date"], message: "Use YYYY-MM for months or YYYY-MM-DD for days." });
});

const addExpenseSchema = z.preprocess(
  (value) => value && typeof value === "object" && !("expenseDate" in value && value.expenseDate !== undefined)
    ? { ...value, expenseDate: getApplicationToday() }
    : value,
  expenseSchema,
);

const updateExpenseSchema = z.object({
  id: z.uuid(),
  description: fields.description.optional(),
  amount: fields.amount.optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  subtype: z.enum(EXPENSE_SUBTYPES).nullable().optional(),
  expenseDate: fields.expenseDate.optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).refine((value) => Object.entries(value).some(([key, field]) => key !== "id" && field !== undefined), "Provide at least one change.");

export const expenseTools = [
  defineTool({
    name: "list_expenses",
    title: "List expenses",
    description: "Expenses for one month (default: current month) with total, count and average.",
    schema: z.object({ month: z.string().refine(isValidMonth, "Use YYYY-MM.").optional() }),
    annotations: READ,
    run: async ({ month = getApplicationCurrentMonth() }, { userId }) => {
      const expenses = await getMonthlyExpensesForUser(userId, month);
      return { month, expenses, ...summarizeExpenses(expenses) };
    },
  }),
  defineTool({
    name: "get_spending_summary",
    title: "Get spending summary",
    description: "Current-month totals and recent expenses, plus category and monthly totals for a period.",
    schema: spendingSummarySchema,
    shape: spendingSummarySchema.shape,
    annotations: READ,
    run: ({ period, granularity, date }, { userId }) => getDashboardDataForUser(
      userId,
      parseAnalyticsFilters(new URLSearchParams({ period, granularity, ...(date && { date }) })),
    ),
  }),
  defineTool({
    name: "add_expense",
    title: "Add expense",
    description: "Record an expense. expenseDate defaults to today; subtype must belong to the category.",
    schema: addExpenseSchema,
    shape: { ...fields, expenseDate: fields.expenseDate.optional() },
    annotations: CREATE,
    run: async (input, { userId }) => ({ expense: await createExpenseForUser(userId, input) }),
  }),
  defineTool({
    name: "update_expense",
    title: "Update expense",
    description: "Change fields of an expense. Changing the category clears a subtype that no longer fits.",
    schema: updateExpenseSchema,
    shape: updateExpenseSchema.shape,
    annotations: UPDATE,
    notFound: "Expense not found.",
    run: async ({ id, ...patch }, { userId }) => {
      const expense = await updateExpenseForUser(userId, id, patch);
      return expense && { expense };
    },
  }),
  defineTool({
    name: "delete_expense",
    title: "Delete expense",
    description: "Permanently delete an expense.",
    schema: idSchema,
    annotations: DELETE,
    notFound: "Expense not found.",
    run: async ({ id }, { userId }) => (await deleteExpenseForUser(userId, id)) && { deleted: true, id },
  }),
];
