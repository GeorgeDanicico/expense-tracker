import type { ExpenseTabRepository } from "@/lib/expenses/tab-repository";
import type { ExpenseTab, ExpenseTabInput } from "@/lib/expenses/tabs";

/**
 * In-memory `ExpenseTabRepository`. Seed `tabs` directly, keyed by owner:
 * `repositories.expenseTabs.tabs.set(user.id, [aTab()])`. Another user's tab counts as missing.
 */
export class FakeExpenseTabRepository implements ExpenseTabRepository {
  readonly tabs = new Map<string, ExpenseTab[]>();

  async list(userId: string) {
    return this.owned(userId).toSorted((a, b) =>
      a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt));
  }

  async get(userId: string, id: string) {
    return this.owned(userId).find((tab) => tab.id === id) ?? null;
  }

  async create(userId: string, input: ExpenseTabInput) {
    const now = new Date().toISOString();
    const tab: ExpenseTab = { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now };
    this.tabs.set(userId, [...this.owned(userId), tab]);
    return tab;
  }

  async update(userId: string, id: string, input: ExpenseTabInput) {
    const existing = await this.get(userId, id);
    if (!existing) return null;
    const tab: ExpenseTab = { ...existing, ...input, updatedAt: new Date().toISOString() };
    this.tabs.set(userId, this.owned(userId).map((other) => (other.id === id ? tab : other)));
    return tab;
  }

  async delete(userId: string, id: string) {
    if (!(await this.get(userId, id))) return false;
    this.tabs.set(userId, this.owned(userId).filter((tab) => tab.id !== id));
    return true;
  }

  private owned(userId: string) {
    return this.tabs.get(userId) ?? [];
  }
}
