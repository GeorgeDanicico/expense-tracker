import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AuthAdmin, CreatedUser, CreateUserInput } from "@/lib/auth/admin";
import type { Database } from "@/lib/database.types";
import { DomainError } from "@/lib/errors";
import { getSupabaseAdminConfig } from "@/lib/supabase/config";

type AdminClient = SupabaseClient<Database>;
type ProviderError = { code?: string; message: string };

/**
 * SECURITY: a client with the secret key. It bypasses RLS and every grant meant for signed-in
 * users, so it is created only here, only on the server, and only when an `AuthAdmin` method is
 * about to run. It never stores, refreshes or reads a session: it acts as the service, not as a user.
 */
function createAdminClient(): AdminClient {
  const { url, secretKey } = getSupabaseAdminConfig();
  return createSupabaseClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** An auth API error as a domain error, keeping the provider's details private unless they are meant for users. */
function authError(error: ProviderError, fallback: string): Error {
  switch (error.code) {
    case "email_exists":
    case "user_already_exists":
      return new DomainError("An account with that email already exists.", 409);
    case "weak_password":
      return new DomainError(error.message, 422);
    case "user_not_found":
      return new DomainError("That account doesn't exist.", 404);
    default:
      return new Error(fallback);
  }
}

/** A failed profile write. The raw Postgres messages name constraints, so these get messages of their own. */
function profileError(error: ProviderError): Error {
  if (error.code === "23505") return new DomainError("That username is taken.", 409);
  if (error.code === "23514") return new DomainError("That username or display name isn't valid.", 422);
  return new Error("Unable to create the account.");
}

/**
 * `AuthAdmin` on Supabase Auth's admin API and the `profiles` table.
 *
 * SECURITY: every method runs with the secret key and checks nothing about the caller. Routes must
 * check the caller's permission before calling it (F29, F30 and F32 do). Passwords and the key are
 * never logged.
 */
export function createSupabaseAuthAdmin(): AuthAdmin {
  const client = createAdminClient();

  async function deleteUser(userId: string): Promise<void> {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) throw authError(error, "Unable to delete the account.");
  }

  return {
    async createUser(input: CreateUserInput): Promise<CreatedUser> {
      // `email_confirm` marks the address confirmed, so no confirmation email is sent.
      // Kid-account state goes in `profiles`, not in the provider's user metadata.
      const { data, error } = await client.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
      });
      if (error) throw authError(error, "Unable to create the account.");
      if (!data.user) throw new Error("Unable to create the account.");

      const user: CreatedUser = { id: data.user.id, email: data.user.email ?? input.email };

      // The signup trigger may already have inserted the row, so upsert on the id. Signed-in
      // users can't write these columns (F04 and F13 triggers); the secret key can.
      const { error: writeError } = await client.from("profiles").upsert(
        {
          id: user.id,
          email: user.email,
          username: input.username,
          display_name: input.displayName,
          managed_by_family: input.managedByFamily,
          must_change_password: input.mustChangePassword,
        },
        { onConflict: "id" },
      );

      if (writeError) {
        // Don't leave an account without its profile behind.
        try {
          await deleteUser(user.id);
        } catch {
          console.error(`AuthAdmin: could not delete account ${user.id} after its profile write failed.`);
        }
        throw profileError(writeError);
      }

      return user;
    },

    deleteUser,

    async setPassword(userId, password) {
      const { error } = await client.auth.admin.updateUserById(userId, { password });
      if (error) throw authError(error, "Unable to change the password.");
    },

    async findEmailByUsername(username) {
      // Usernames are stored lowercase.
      const { data: profile, error } = await client
        .from("profiles")
        .select("id")
        .eq("username", username.trim().toLowerCase())
        .maybeSingle();
      if (error) throw new Error("Unable to look up the username.");
      if (!profile) return null;

      // The auth user's email is the one sign-in checks; the profile's copy can be out of date.
      const { data, error: userError } = await client.auth.admin.getUserById(profile.id);
      if (userError) {
        if (userError.code === "user_not_found") return null;
        throw new Error("Unable to look up the username.");
      }
      return data.user?.email || null;
    },
  };
}
