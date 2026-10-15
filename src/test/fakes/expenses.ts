import type { DashboardSummary } from "@/lib/expenses/analytics";
import { expenseTabDateBounds, matchesExpenseSearch, type ExpenseTabFilters } from "@/lib/expenses/filters";
import type { DateRange, ExpenseRepository } from "@/lib/expenses/repository";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import type { Expense } from "@/lib/expenses/types";
import { getMonthRange } from "@/lib/calendar";
import { applyExpensePatch, type ExpenseInput, type ExpensePatch } from "@/lib/validation/expense";

const inRange = (expense: Expense, { start, endExclusive }: Partial<DateRange>) =>
  (!start || expense.expenseDate >= start) && (!endExclusive || expense.expenseDate < endExclusive);

/** The expense as the table stores it: empty notes become null. */
const stored = (id: string, input: ExpenseInput): Expense => ({ id, ...input, notes: input.notes || null });

function sumBy<K>(expenses: Expense[], key: (expense: Expense) => K) {
  const totals = new Map<K, number>();
  for (const expense of expenses) totals.set(key(expense), (totals.get(key(expense)) ?? 0) + expense.amount);
  return [...totals];
}

/**
 * In-memory `ExpenseRepository`. Seed `expenses` directly, keyed by owner and in creation order:
 * `repositories.expenses.expenses.set(user.id, [anExpense()])`. Another user's expense counts as missing.
 * Lists sort newest first by date, then by creation (later in the array is newer).
 */
export class FakeExpenseRepository implements ExpenseRepository {
  readonly expenses = new Map<string, Expense[]>();

  async listMonth(userId: string, month: string) {
    return this.newestFirst(userId).filter((expense) => inRange(expense, getMonthRange(month)));
  }

  async listForTab(userId: string, tab: ExpenseTab, filters: ExpenseTabFilters) {
    const search = filters.search.toLowerCase();
    return this.newestFirst(userId).filter((expense) =>
      (tab.categoryKeys.includes(expense.category) || (expense.subtype !== null && tab.subtypeKeys.includes(expense.subtype)))
      && inRange(expense, expenseTabDateBounds(filters))
      && (!filters.category || expense.category === filters.category)
      && (filters.subtype === "all" || expense.subtype === (filters.subtype === "none" ? null : filters.subtype))
      && (!search || matchesExpenseSearch(expense, search)));
  }

  /** Computes the summary the way `get_expense_dashboard` does. */
  async getDashboard(userId: string, ranges: { current: DateRange; analytics: DateRange }) {
    const current = this.newestFirst(userId).filter((expense) => inRange(expense, ranges.current));
    const analytics = this.newestFirst(userId).filter((expense) => inRange(expense, ranges.analytics));
    const summary: DashboardSummary = {
      currentTotal: current.reduce((sum, expense) => sum + expense.amount, 0),
      currentCount: current.length,
      currentLargest: Math.max(0, ...current.map((expense) => expense.amount)),
      analyticsTotal: analytics.reduce((sum, expense) => sum + expense.amount, 0),
      analyticsCount: analytics.length,
      categoryTotals: sumBy(analytics, (expense) => expense.category)
        .map(([category, total]) => ({ category, total }))
        .sort((a, b) => b.total - a.total),
      monthlyTotals: sumBy(analytics, (expense) => expense.expenseDate.slice(0, 7))
        .map(([key, total]) => ({ key, total }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    };
    return { currentExpenses: current.slice(0, 5), summary };
  }

  async create(userId: string, input: ExpenseInput) {
    const expense = stored(crypto.randomUUID(), input);
    this.expenses.set(userId, [...this.owned(userId), expense]);
    return expense;
  }

  async update(userId: string, id: string, patch: ExpensePatch) {
    const existing = this.owned(userId).find((expense) => expense.id === id);
    if (!existing) return null;
    const expense = stored(id, applyExpensePatch(existing, patch));
    this.expenses.set(userId, this.owned(userId).map((other) => (other.id === id ? expense : other)));
    return expense;
  }

  async delete(userId: string, id: string) {
    const owned = this.owned(userId);
    if (!owned.some((expense) => expense.id === id)) return false;
    this.expenses.set(userId, owned.filter((expense) => expense.id !== id));
    return true;
  }

  private owned(userId: string) {
    return this.expenses.get(userId) ?? [];
  }

  private newestFirst(userId: string) {
    return this.owned(userId).toReversed().sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
  }
}
