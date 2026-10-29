import type { DashboardSummary } from "@/lib/expenses/analytics";
import type { ExpenseTabFilters } from "@/lib/expenses/filters";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import type { Expense } from "@/lib/expenses/types";
import type { ExpenseInput, ExpensePatch } from "@/lib/validation/expense";

/** Calendar dates as `YYYY-MM-DD`: `start` is included, `endExclusive` is not. */
export type DateRange = { start: string; endExclusive: string };

/** What the dashboard reads from storage; `src/lib/expenses/service.ts` turns it into `DashboardData`. */
export type ExpenseDashboardSnapshot = {
  /** The newest five expenses in the current range. */
  currentExpenses: Expense[];
  /** Totals for the current range and the analytics range. */
  summary: DashboardSummary;
};

/**
 * Expenses, each owned by one user. Get it from `getRepositories()`; never import an implementation.
 * Every method acts only on `userId`'s own expenses: another user's expense counts as missing.
 * Lists are newest first: by expense date, then creation time, then id.
 */
export interface ExpenseRepository {
  /** The user's expenses dated in `month` (`YYYY-MM`; an invalid month means the current one). */
  listMonth(userId: string, month: string): Promise<Expense[]>;
  /** The user's expenses dated from `range.start` up to, not including, `range.endExclusive`. */
  listRange(userId: string, range: DateRange): Promise<Expense[]>;
  /**
   * The user's expenses in the tab's categories or subtypes, narrowed by the filters.
   * The caller resolves the tab with the user's ownership first. A tab with no selections lists nothing.
   */
  listForTab(userId: string, tab: ExpenseTab, filters: ExpenseTabFilters): Promise<Expense[]>;
  /** The user's recent expenses and totals for the dashboard's current and analytics ranges. */
  getDashboard(userId: string, ranges: { current: DateRange; analytics: DateRange }): Promise<ExpenseDashboardSnapshot>;
  /** Saves a new expense owned by the user, returning it as stored. */
  create(userId: string, input: ExpenseInput): Promise<Expense>;
  /**
   * Applies the patch with `applyExpensePatch`, throwing its ZodError for an invalid result.
   * Returns the expense as stored, or null when the user owns no such expense.
   */
  update(userId: string, id: string, patch: ExpensePatch): Promise<Expense | null>;
  /** Deletes the expense, returning false when the user owns no such expense. */
  delete(userId: string, id: string): Promise<boolean>;
}
