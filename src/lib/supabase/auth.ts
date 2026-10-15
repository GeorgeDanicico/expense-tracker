import "server-only";

import type {
  AuthenticatedUser,
  AuthResult,
  AuthService,
  EmailLink,
  OAuthProvider,
  OAuthUrlResult,
  SignUpResult,
} from "@/lib/auth/service";
import { createClient } from "@/lib/supabase/server";

function result(error: { message: string } | null): AuthResult {
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/** `AuthService` on Supabase Auth, using the request's client (cookie session, or the scoped MCP client). */
export const supabaseAuth: AuthService = {
  async getCurrentUser(): Promise<AuthenticatedUser | null> {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();

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
};
