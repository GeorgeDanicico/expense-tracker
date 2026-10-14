import type { Expense } from "@/lib/expenses/types";

export function summarizeExpenses(expenses: Pick<Expense, "amount">[]) {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const count = expenses.length;
  return { total, count, average: count ? total / count : 0 };
}
