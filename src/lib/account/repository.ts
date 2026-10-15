import type { AuthenticatedUser } from "@/lib/auth";

/** Account settings storage. Get it from `getRepositories()`; never import an implementation. */
export interface AccountRepository {
  /** The user's display currency, or the default currency when they have not chosen one. */
  getCurrency(userId: string): Promise<string>;
  /** Saves the user's display currency, creating their account settings on the first save. */
  updateCurrency(user: AuthenticatedUser, currency: string): Promise<void>;
}
