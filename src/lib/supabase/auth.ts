import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  AppTokenUser,
  AuthenticatedUser,
  AuthFailure,
  AuthResult,
  AuthService,
  AuthSession,
  EmailLink,
  OAuthProvider,
  OAuthUrlResult,
  SignUpResult,
} from "@/lib/auth/service";
import type { Database } from "@/lib/database.types";
import { hasMcpTokenPrefix } from "@/lib/mcp/tokens";
import { getSupabaseConfig } from "@/lib/supabase/config";
import {
  createAppTokenClient,
  createClient,
  getBearerToken,
  getScopedAppToken,
  runWithSupabaseClient,
} from "@/lib/supabase/server";

type ProviderError = { message: string; code?: string; status?: number };

/**
 * Supabase Auth's error codes the user can act on, with what to tell them. Its own messages are terse
 * ("email rate limit exceeded") and name limits the user doesn't know about.
 */
const KNOWN_FAILURES: Record<string, Omit<AuthFailure, "ok">> = {
  over_email_send_rate_limit: {
    kind: "rate_limited",
    reason: "We've sent too many emails in a short time. Please wait up to an hour, then try again.",
  },
  over_request_rate_limit: {
    kind: "rate_limited",
    reason: "Too many attempts in a short time. Please wait a few minutes, then try again.",
  },
  email_not_confirmed: {
    kind: "email_not_confirmed",
    reason: "Confirm your email first: open the link we sent you, then sign in.",
  },
  email_exists: { reason: "Another account already uses this email address." },
  user_already_exists: { reason: "Another account already uses this email address." },
  same_password: { reason: "Choose a password that's different from your current one." },
  email_address_invalid: { reason: "Enter a valid email address." },
  signup_disabled: { reason: "New accounts can't be created right now." },
};

/** The failure for a Supabase Auth error: a known code's message, any other 429 as a rate limit, else the provider's message. */
export function authFailure(error: ProviderError): AuthFailure {
  const known = error.code === undefined ? undefined : KNOWN_FAILURES[error.code];
  if (known) return { ok: false, ...known };
  if (error.status === 429) return { ok: false, ...KNOWN_FAILURES.over_request_rate_limit };
  return { ok: false, reason: error.message };
}

function result(error: ProviderError | null): AuthResult {
  return error ? authFailure(error) : { ok: true };
}

/** A JWT's claims, decoded without checking the signature. Null when it isn't a JWT. */
function unverifiedClaims(token: string): Record<string, unknown> | null {
  try {
    const claims: unknown = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * A client of its own for one server-side session: the publishable key, never stored, refreshing
 * itself. `AuthAdmin.startSessionForUser` signs in on one of these.
 */
export function createSessionClient(): SupabaseClient<Database> {
  const { url, publishableKey } = getSupabaseConfig();
  return createSupabaseClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
}

/**
 * The `AuthSession` for a client from `createSessionClient` that has just signed in as `user`.
 * `AuthAdmin.startSessionForUser` returns one.
 */
export function sessionFromClient(client: SupabaseClient<Database>, user: AuthenticatedUser): AuthSession {
  return {
    userId: user.id,
    email: user.email,
    run: (fn) => runWithSupabaseClient(client, fn),
    async isActive() {
      try {
        const { data: current, error } = await client.auth.getSession();
        return !error && Boolean(current.session);
      } catch {
        return false;
      }
    },
    async end() {
      // `local` ends this session only; the default (`global`) would sign the user out everywhere.
      try {
        await client.auth.signOut({ scope: "local" });
      } catch {
        // Nothing to do: the session expires on its own.
      }
    },
  };
}

/**
 * `AuthService` on Supabase Auth, using the request's client: the scoped MCP client, the
 * `Authorization: Bearer` token's client, or the cookie session (see `createClient`).
 */
export const supabaseAuth: AuthService = {
  /**
   * A bearer request is decided by its token alone: an invalid, expired or empty token gives
   * null (a 401), even when the request also carries a valid cookie session.
   *
   * An OAuth app's token (a JWT with a `client_id` claim) gives null too, so the REST API refuses
   * it: an app is allowed MCP, not the whole API. Only inside `sessionForAppToken(...).run`, whose
   * scoped client carries that token and no session, is it the caller.
   *
   * A personal MCP token (`sl_mcp_…`) gives null without reaching the provider: it isn't a JWT, and
   * it's for `/api/mcp` only.
   */
  async getCurrentUser(): Promise<AuthenticatedUser | null> {
    const appToken = getScopedAppToken();
    const token = appToken ?? (await getBearerToken());
    if (token === "" || (token !== null && hasMcpTokenPrefix(token))) return null;

    const supabase = await createClient();
    const { data, error } = token === null ? await supabase.auth.getClaims() : await supabase.auth.getClaims(token);

    if (error || !data?.claims?.sub) {
      return null;
    }
    if (appToken === null && data.claims.client_id !== undefined) {
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
    if (error) return authFailure(error);
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

  async verifyAppToken(token): Promise<AppTokenUser | null> {
    try {
      const client = createAppTokenClient(token);
      const { data, error } = await client.auth.getClaims(token);
      const claims = data?.claims;
      if (error || !claims?.sub) return null;
      // A web session's JWT has no `client_id`: it isn't an app's token.
      if (typeof claims.client_id !== "string" || claims.client_id === "") return null;

      // Asks Supabase Auth whether the token's session is still live, on every call. Disconnecting
      // an app deletes its sessions, so this refuses its token at once. `getClaims` can't see that
      // once the project signs with an asymmetric key: it then checks the signature locally and
      // accepts a revoked token until it expires.
      const { data: userData, error: userError } = await client.auth.getUser(token);
      const user = userData?.user;
      if (userError || !user || user.id !== claims.sub) return null;

      return { userId: user.id, email: user.email ?? "", clientId: claims.client_id };
    } catch {
      return null;
    }
  },

  sessionForAppToken(token): AuthSession {
    // The caller verified the token with `verifyAppToken`, so reading its claims unchecked is safe
    // here. The database checks the signature again on every query the session runs.
    const claims = unverifiedClaims(token);
    const userId = typeof claims?.sub === "string" ? claims.sub : "";
    const client = createAppTokenClient(token);
    return {
      userId,
      email: typeof claims?.email === "string" ? claims.email : "",
      run: (fn) => runWithSupabaseClient(client, fn),
      async isActive() {
        return (await supabaseAuth.verifyAppToken(token))?.userId === userId;
      },
      // A no-op: the token's session belongs to the app, and ending it would disconnect the app.
      // The app refreshes or drops its own token; disconnecting is the user's choice in Settings.
      async end() {},
    };
  },
};
