/**
 * Privileged access to the auth provider, for accounts that a parent manages (kid accounts) and for
 * acting as a user without their password (personal MCP tokens).
 * Routes reach it through `getAuthAdmin()` in `@/lib/auth`; only `src/lib/supabase/auth-admin.ts`
 * knows it is Supabase.
 *
 * SECURITY: these methods act with the server's secret key, which ignores every database rule
 * (RLS) and every per-user check. They never ask who the caller is. Callers must check the
 * caller's permission first, as F29 (create a kid), F30 (username sign-in) and F32 (reset a
 * kid's password) do.
 *
 * Failures are thrown: a `DomainError` (409 or 422 for input the provider or the database
 * refuses, 404 for an unknown user) or a plain `Error` with a generic message for anything else.
 * `startSessionForUser` is the exception: it answers null instead.
 */

import type { AuthenticatedUser, AuthSession } from "@/lib/auth/service";

export type CreateUserInput = {
  email: string;
  password: string;
  /** Lowercase sign-in name, matching `^[a-z0-9][a-z0-9._-]{2,29}$`. */
  username: string;
  /** Trimmed name (1–40 characters) shown to the rest of the family. */
  displayName: string;
  /** The family the account is created for, or null for an ordinary account. */
  managedByFamily: string | null;
  /** Whether the account must choose a new password before using the app. */
  mustChangePassword: boolean;
};

export type CreatedUser = {
  id: string;
  email: string;
};

export interface AuthAdmin {
  /**
   * Creates an account that is already confirmed (no email is sent) and writes its profile:
   * username, display name, `managedByFamily` and `mustChangePassword`. If the profile can't be
   * written, the new account is deleted again before the error is thrown.
   */
  createUser(input: CreateUserInput): Promise<CreatedUser>;
  /** Deletes the account and, through the database's cascades, everything it owns. */
  deleteUser(userId: string): Promise<void>;
  /** Sets the account's password without asking for the old one. */
  setPassword(userId: string, password: string): Promise<void>;
  /** The email of the account with this username, or null when there is none. */
  findEmailByUsername(username: string): Promise<string | null>;
  /**
   * Opens a session for this user without their password, for personal MCP tokens. It acts as the
   * user under RLS, exactly like a signed-in browser session. Null when the account doesn't exist or
   * the provider refuses. No email is sent.
   *
   * SECURITY: anyone holding the result acts as that user. Call it only after the caller has proved
   * they may act for them (a valid, live personal token for that user).
   */
  startSessionForUser(user: AuthenticatedUser): Promise<AuthSession | null>;
}
