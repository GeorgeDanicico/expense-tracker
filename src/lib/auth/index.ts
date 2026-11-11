import "server-only";

import type { AuthAdmin } from "@/lib/auth/admin";
import type { OAuthConsent } from "@/lib/auth/oauth-consent";
import type { AuthenticatedUser, AuthService } from "@/lib/auth/service";
import { MEMO_KEYS, oncePerRequest } from "@/lib/request-memo";
import { supabaseAuth } from "@/lib/supabase/auth";
import { createSupabaseAuthAdmin } from "@/lib/supabase/auth-admin";
import { supabaseOAuthConsent, supabaseOAuthIssuer } from "@/lib/supabase/oauth-consent";
import { createClient, runWithSupabaseClient } from "@/lib/supabase/server";

export type * from "@/lib/auth/admin";
export type * from "@/lib/auth/oauth-consent";
export type * from "@/lib/auth/service";

/** The auth provider for this request. The only place that picks the implementation. */
export function getAuth(): AuthService {
  return supabaseAuth;
}

/**
 * Admin access to the auth provider. The only place that picks the implementation.
 *
 * SECURITY: it uses the secret key, which bypasses every database rule. Check the caller's
 * permission before calling it. Throws when `SUPABASE_SECRET_KEY` isn't set, so call it inside
 * the handler that needs it, never at module level.
 */
export function getAuthAdmin(): AuthAdmin {
  return createSupabaseAuthAdmin();
}

/** The OAuth consent flow and connected apps, as the request's signed-in user. The only place that picks the implementation. */
export function getOAuthConsent(): OAuthConsent {
  return supabaseOAuthConsent;
}

/** The issuer URL of the OAuth server that app tokens come from. Read it through `getMcpAuthorizationServer()`. */
export function getOAuthIssuer(): string {
  return supabaseOAuthIssuer();
}

/**
 * The signed-in user, read once per request (`oncePerRequest`): `withUser` reads it, and the
 * repositories that check the caller themselves (avatars, the AI gate, the MCP switch) get the same
 * answer without asking Supabase Auth again.
 */
export function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  return oncePerRequest(MEMO_KEYS.user, () => getAuth().getCurrentUser());
}

/**
 * For a page or layout (a server component): runs `fn` as the request's cookie session, the way
 * `withUser` reads it for an API route, with a memo of its own so the user and the membership are
 * read once (`oncePerRequest`; outside `logRequest` there is none otherwise). It writes no request
 * line: those are for API requests (PF5).
 */
export async function asPageCaller<T>(fn: () => Promise<T>): Promise<T> {
  return runWithSupabaseClient(await createClient(), fn);
}
