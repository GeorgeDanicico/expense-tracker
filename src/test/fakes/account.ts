import type { AccountRepository } from "@/lib/account/repository";
import { normalizeCurrency } from "@/lib/utils/currency";

/** In-memory `AccountRepository`. Seed `currencies` directly; a user without one has the default currency. */
export class FakeAccountRepository implements AccountRepository {
  readonly currencies = new Map<string, string>();

  async getCurrency(userId: string) {
    return normalizeCurrency(this.currencies.get(userId));
  }

  async updateCurrency(user: { id: string }, currency: string) {
    this.currencies.set(user.id, currency);
  }
}
