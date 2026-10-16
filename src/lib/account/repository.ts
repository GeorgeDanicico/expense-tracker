import type { AuthenticatedUser } from "@/lib/auth";

/** Account settings storage. Get it from `getRepositories()`; never import an implementation. */
export interface AccountRepository {
  /** The user's display currency, or the default currency when they have not chosen one. */
  getCurrency(userId: string): Promise<string>;
  /** Saves the user's display currency, creating their account settings on the first save. */
  updateCurrency(user: AuthenticatedUser, currency: string): Promise<void>;
  /** Whether the user must choose a new password before using the app; `false` when they have no account settings. */
  getMustChangePassword(userId: string): Promise<boolean>;
  /** Clears the signed-in caller's own "must change password" flag. Does nothing when it isn't set. */
  completePasswordChange(): Promise<void>;
}
