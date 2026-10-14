import "server-only";

import { getExpenseTabForUser } from "@/lib/data/expense-tabs";
import { getExpenseTabExpensesForUser, getMonthlyExpensesForUser } from "@/lib/data/expenses";
import type { ExpenseTabFilters } from "@/lib/expenses/filters";
import { summarizeExpenses } from "@/lib/expenses/summary";

// Use cases shared by the REST routes and the MCP tools; each transport only reshapes the result.

export async function getMonthlyLedgerForUser(userId: string, month: string) {
  const expenses = await getMonthlyExpensesForUser(userId, month);
  return { month, expenses, ...summarizeExpenses(expenses) };
}

/** Returns null when the user owns no tab with this id. */
export async function getExpenseTabLedgerForUser(userId: string, tabId: string, filters: ExpenseTabFilters) {
  const tab = await getExpenseTabForUser(userId, tabId);
  if (!tab) return null;
  const expenses = await getExpenseTabExpensesForUser(userId, tab, filters);
  return { tab, filters, expenses, ...summarizeExpenses(expenses) };
}
