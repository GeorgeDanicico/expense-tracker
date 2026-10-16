import type { AccountRepository } from "@/lib/account/repository";
import { normalizeCurrency } from "@/lib/utils/currency";

/**
 * In-memory `AccountRepository`. Seed `currencies` directly; a user without one has the default currency.
 * Add a user id to `mustChangePassword` to flag that user. `completePasswordChange` clears the flag of
 * `caller`, the signed-in user (`testUser` from `@/test/route` by default), like the RPC does.
 */
export class FakeAccountRepository implements AccountRepository {
  readonly currencies = new Map<string, string>();
  readonly mustChangePassword = new Set<string>();
  caller = { userId: "10000000-0000-4000-8000-000000000001" };

  async getCurrency(userId: string) {
    return normalizeCurrency(this.currencies.get(userId));
  }

  async updateCurrency(user: { id: string }, currency: string) {
    this.currencies.set(user.id, currency);
  }

  async getMustChangePassword(userId: string) {
    return this.mustChangePassword.has(userId);
  }

  async completePasswordChange() {
    this.mustChangePassword.delete(this.caller.userId);
  }
}
