import "server-only";

import type { AuthAdmin, CreatedUser, CreateUserInput } from "@/lib/auth/admin";
import type { AuthSession } from "@/lib/auth/service";
import { DomainError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin-client";
import { createSessionClient, createThrowawayClient, sessionFromClient } from "@/lib/supabase/auth";
import { translateDatabaseError } from "@/lib/supabase/errors";

type ProviderError = { code?: string; message: string };

/** The bucket of profile pictures, one folder per user id (see `src/lib/avatars/paths.ts`). */
const AVATARS_BUCKET = "avatars";
const AVATAR_PAGE_SIZE = 100;
const MAX_AVATAR_PAGES = 10;

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
  return translateDatabaseError(error, "Unable to create the account.", {
    messages: { "23505": "That username is taken.", "23514": "That username or display name isn't valid." },
  });
}

/**
 * `AuthAdmin` on Supabase Auth's admin API and the `profiles` table.
 *
 * SECURITY: every method runs with the secret key and checks nothing about the caller. Routes must
 * check the caller's permission before calling it (F29, F30 and F32 do; M6 checks a personal token
 * before `startSessionForUser`). Passwords, one-time tokens and the key are never logged.
 */
export function createSupabaseAuthAdmin(): AuthAdmin {
  const client = createAdminClient();

  /**
   * Deletes every file in the user's folder of the `avatars` bucket (`<userId>/<uuid>.webp`). By the
   * folder, not by `profiles.avatar_path`, so a retry finds a file the profile no longer names.
   * Throws when Storage fails, so the account isn't deleted with its picture left behind.
   */
  async function deleteAvatarFiles(userId: string): Promise<void> {
    const failure = "Unable to delete the account.";
    const folder = userId.toLowerCase();
    const bucket = client.storage.from(AVATARS_BUCKET);
    // A user has one picture at a time (an old one is deleted on replace), so one page is the norm;
    // the bound only stops a Storage that keeps answering with files it doesn't delete.
    for (let page = 0; page < MAX_AVATAR_PAGES; page += 1) {
      const { data, error } = await bucket.list(folder, { limit: AVATAR_PAGE_SIZE });
      if (error) throw new Error(failure);
      if (!data || data.length === 0) return;
      const { error: removeError } = await bucket.remove(data.map((file) => `${folder}/${file.name}`));
      if (removeError) throw new Error(failure);
      if (data.length < AVATAR_PAGE_SIZE) return;
    }
    throw new Error(failure);
  }

  async function deleteUser(userId: string): Promise<void> {
    await deleteAvatarFiles(userId);
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

    async signOutEverywhere(userId) {
      const failure = "Unable to sign the account out.";
      // Supabase's admin API ends sessions by an access token of the user, not by their id. So open
      // one more session the way `startSessionForUser` does (a magic link's one-time token, no email
      // sent), then end every session with it, that one included, through the admin API.
      const { data: found, error: findError } = await client.auth.admin.getUserById(userId);
      if (findError) throw authError(findError, failure);
      const email = found.user?.email;
      if (!email) throw new Error(failure);

      const { data: link, error: linkError } = await client.auth.admin.generateLink({ type: "magiclink", email });
      const tokenHash = link?.properties?.hashed_token;
      if (linkError || !tokenHash || link.user?.id !== userId) throw new Error(failure);

      const { data, error } = await createThrowawayClient().auth.verifyOtp({ token_hash: tokenHash, type: "email" });
      const accessToken = data?.session?.access_token;
      if (error || !accessToken || data.user?.id !== userId) throw new Error(failure);

      const { error: signOutError } = await client.auth.admin.signOut(accessToken, "global");
      if (signOutError) throw new Error(failure);
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

    async startSessionForUser(user): Promise<AuthSession | null> {
      try {
        // `generateLink` only builds the magic link and returns its one-time token: unlike
        // `signInWithOtp`, it sends no email.
        const { data: link, error: linkError } = await client.auth.admin.generateLink({
          type: "magiclink",
          email: user.email,
        });
        const tokenHash = link?.properties?.hashed_token;
        if (linkError || !tokenHash) return null;
        // The email may have moved to another account since the caller looked it up.
        if (link.user?.id !== user.id) return null;

        // Redeemed at once on a client of its own, as the user. `email` is the type for a magic
        // link's token hash (Supabase deprecates `magiclink` for verifyOtp).
        const sessionClient = createSessionClient();
        const { data, error } = await sessionClient.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
        if (error || !data.user || !data.session) return null;

        const session = sessionFromClient(sessionClient, { id: data.user.id, email: data.user.email ?? user.email });
        if (data.user.id !== user.id) {
          await session.end();
          return null;
        }
        return session;
      } catch {
        return null;
      }
    },
  };
}
