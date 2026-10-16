import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type {
  AuthenticatedUser,
  AuthResult,
  AuthService,
  AuthSession,
  EmailLink,
  OAuthProvider,
  OAuthUrlResult,
  SignUpResult,
} from "@/lib/auth/service";
import type { Database } from "@/lib/database.types";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient, getBearerToken, runWithSupabaseClient } from "@/lib/supabase/server";

function result(error: { message: string } | null): AuthResult {
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/**
 * `AuthService` on Supabase Auth, using the request's client: the scoped MCP client, the
 * `Authorization: Bearer` token's client, or the cookie session (see `createClient`).
 * `startSession` is the exception: it signs in with its own client, which `run` scopes over its callback.
 */
export const supabaseAuth: AuthService = {
  /**
   * A bearer request is decided by its token alone: an invalid, expired or empty token gives
   * null (a 401), even when the request also carries a valid cookie session.
   */
  async getCurrentUser(): Promise<AuthenticatedUser | null> {
    const token = await getBearerToken();
    if (token === "") return null;

    const supabase = await createClient();
    const { data, error } = token === null ? await supabase.auth.getClaims() : await supabase.auth.getClaims(token);

    if (error || !data?.claims?.sub) {
      return null;
    }

    return {
      id: data.claims.sub,
      email: typeof data.claims.email === "string" ? data.claims.email : "",
    };
  },

  async signInWithPassword(email, password) {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return result(error);
  },

  async signUp(email, password, confirmationUrl): Promise<SignUpResult> {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: confirmationUrl },
    });
    if (error) return { ok: false, reason: error.message };
    return { ok: true, signedIn: Boolean(data.session) };
  },

  async signOut() {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    return result(error);
  },

  async oauthSignInUrl(provider: OAuthProvider, callbackUrl): Promise<OAuthUrlResult> {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl },
    });
    if (error || !data.url) return { ok: false, reason: error?.message ?? "No sign-in URL." };
    return { ok: true, url: data.url };
  },

  async completeEmailLink(link: EmailLink) {
    const supabase = await createClient();
    if ("code" in link) {
      return result((await supabase.auth.exchangeCodeForSession(link.code)).error);
    }
    if ("tokenHash" in link) {
      return result((await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type })).error);
    }
    return result((await supabase.auth.verifyOtp({ email: link.email, token: link.token, type: link.type })).error);
  },

  async updatePassword(password) {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    return result(error);
  },

  async updateEmail(email, confirmationUrl) {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: confirmationUrl });
    return result(error);
  },

  async startSession(email, password): Promise<AuthSession | null> {
    try {
      const { url, publishableKey } = getSupabaseConfig();
      const client = createSupabaseClient<Database>(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
      });
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.user) return null;
      return {
        userId: data.user.id,
        email: data.user.email ?? email,
        run: (fn) => runWithSupabaseClient(client, fn),
        async isActive() {
          try {
            const { data: current, error: sessionError } = await client.auth.getSession();
            return !sessionError && Boolean(current.session);
          } catch {
            return false;
          }
        },
      };
    } catch {
      return null;
    }
  },
};
