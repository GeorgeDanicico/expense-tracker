import { daysInMonth, formatMonthName, shiftMonth } from "@/lib/calendar";
import { summarizeExpenses } from "@/lib/expenses/summary";
import type { Expense } from "@/lib/expenses/types";

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
  const before = summarizeExpenses(previous.filter((expense) => Number(expense.expenseDate.slice(8)) <= lastDay)).total;
  if (before <= 0) return null;
  const percent = Math.round(((summarizeExpenses(expenses).total - before) / before) * 100);
  const name = formatMonthName(previousMonth);
  const comparison = percent === 0 ? `the same as ${name}` : `${Math.abs(percent)}% ${percent > 0 ? "more" : "less"} than ${name}`;
  return soFar ? `${comparison} so far` : comparison;
}
