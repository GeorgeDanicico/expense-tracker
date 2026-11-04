import type { DashboardSummary } from "@/lib/expenses/analytics";
import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";
import type { ExpenseTabFilters } from "@/lib/expenses/filters";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import type { Expense } from "@/lib/expenses/types";
import type { ExpenseInput, ExpensePatch } from "@/lib/validation/expense";

/** Calendar dates as `YYYY-MM-DD`: `start` is included, `endExclusive` is not. */
export type DateRange = { start: string; endExclusive: string };

/** What the statement reader learns from an expense the user categorised: its description and the classification they gave it. */
export type MerchantCategory = {
  description: string;
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
  expenseDate: string;
};

/** An expense's description with the classification it was given. */
export type ClassifiedDescription = Pick<MerchantCategory, "description" | "category" | "subtype">;

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
   * The user's expenses dated from `since` (`YYYY-MM-DD`) on, newest first, as description plus the
   * category and subtype they have. Expenses left in Other are left out: Other says nothing about a
   * merchant, and everything imported before the statement reader arrived is in it. The statement
   * reader groups these by normalised merchant to reuse the user's own choices.
   */
  recentCategoriesByMerchant(userId: string, since: string): Promise<MerchantCategory[]>;
  /**
   * The description, category and subtype of the user's `limit` newest expenses (by expense date,
   * then creation), newest first: what the expense form's suggestions are worked out from.
   */
  recentDescriptions(userId: string, limit: number): Promise<ClassifiedDescription[]>;
  /**
   * The user's expenses in the tab's categories or subtypes, narrowed by the filters.
   * The caller resolves the tab with the user's ownership first. A tab with no selections lists nothing.
   */
  listForTab(userId: string, tab: ExpenseTab, filters: ExpenseTabFilters): Promise<Expense[]>;
  /** How many expenses the user has, all dates: what an account currency change would relabel (audit B10). */
  count(userId: string): Promise<number>;
  /** The user's recent expenses and totals for the dashboard's current and analytics ranges. */
  getDashboard(userId: string, ranges: { current: DateRange; analytics: DateRange }): Promise<ExpenseDashboardSnapshot>;
  /** Saves a new expense owned by the user, returning it as stored. */
  create(userId: string, input: ExpenseInput): Promise<Expense>;
  /**
   * Writes only the fields the patch names, checked with `validateExpensePatch` (its ZodError for an
   * invalid field), in one atomic update: a parallel edit to another field isn't lost. A new category
   * drops a stored subtype that doesn't belong to it; a subtype that doesn't belong to the expense's
   * category is a `DomainError` 422 on `subtype`. Returns the expense as stored, or null when the
   * user owns no such expense.
   */
  update(userId: string, id: string, patch: ExpensePatch): Promise<Expense | null>;
  /** Deletes the expense, returning false when the user owns no such expense. */
  delete(userId: string, id: string): Promise<boolean>;
}
