import type { ExpenseTab, ExpenseTabInput } from "@/lib/expenses/tabs";

/**
 * Saved expense tabs, each owned by one user. Get it from `getRepositories()`; never import an
 * implementation. Every method acts only on `userId`'s own tabs: another user's tab counts as missing.
 */
export interface ExpenseTabRepository {
  /** The user's tabs, oldest first. */
  list(userId: string): Promise<ExpenseTab[]>;
  /** The user's tab with this id, or null when they own no such tab. */
  get(userId: string, id: string): Promise<ExpenseTab | null>;
  /** Saves a new tab owned by the user. */
  create(userId: string, input: ExpenseTabInput): Promise<ExpenseTab>;
  /** Replaces the tab's name and selections, or returns null when the user owns no such tab. */
  update(userId: string, id: string, input: ExpenseTabInput): Promise<ExpenseTab | null>;
  /** Deletes the tab, returning false when the user owns no such tab. Its expenses are kept. */
  delete(userId: string, id: string): Promise<boolean>;
}
