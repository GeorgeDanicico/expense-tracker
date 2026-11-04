import { daysInMonth, formatMonth, shiftMonth } from "@/lib/calendar";
import type { Expense } from "@/lib/expenses/types";

const total = (expenses: readonly Pick<Expense, "amount">[]) => expenses.reduce((sum, expense) => sum + expense.amount, 0);

/**
 * How a month compares with the one before, for the Expenses screen's one-line total: "18% less than
 * October so far" for the current month (October up to the same day), "12% more than September" for a
 * past one. Null when the month before has nothing to compare with.
 */
export function monthChange(
  month: string,
  expenses: readonly Pick<Expense, "amount" | "expenseDate">[],
  previous: readonly Pick<Expense, "amount" | "expenseDate">[],
  today: string,
) {
  const previousMonth = shiftMonth(month, -1);
  const soFar = today.startsWith(`${month}-`);
  // The same days of the month before: up to today's day, or all of a shorter month.
  const lastDay = soFar ? Math.min(Number(today.slice(8)), daysInMonth(previousMonth)) : daysInMonth(previousMonth);
  const before = total(previous.filter((expense) => Number(expense.expenseDate.slice(8)) <= lastDay));
  if (before <= 0) return null;
  const percent = Math.round(((total(expenses) - before) / before) * 100);
  const name = formatMonth(previousMonth).split(" ")[0];
  const comparison = percent === 0 ? `the same as ${name}` : `${Math.abs(percent)}% ${percent > 0 ? "more" : "less"} than ${name}`;
  return soFar ? `${comparison} so far` : comparison;
}
