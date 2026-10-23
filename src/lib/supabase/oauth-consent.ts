import "server-only";

import type { ConnectedApp, ConsentRequest, OAuthApp, OAuthConsent } from "@/lib/auth/oauth-consent";
import { DomainError } from "@/lib/errors";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

type ProviderError = { message: string; status?: number };
type ProviderClient = { id: string; name: string; uri: string; logo_uri: string };

/** The issuer of the project's OAuth server: Supabase Auth, at `<SUPABASE_URL>/auth/v1`. */
export function supabaseOAuthIssuer(): string {
  return `${getSupabaseConfig().url.replace(/\/+$/, "")}/auth/v1`;
}

function toApp(client: ProviderClient): OAuthApp {
  // Supabase sends "" for a URI the app didn't register.
  return { clientId: client.id, name: client.name, uri: client.uri || null, logoUri: client.logo_uri || null };
}

function toScopes(scope: string): string[] {
  return scope.split(/\s+/).filter(Boolean);
}

/** A failed approve or deny: a 4xx means the request is gone or isn't the caller's. */
function decisionError(error: ProviderError): Error {
  if (error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 429) {
    return new DomainError("That authorization request doesn't exist or has expired.", 404);
  }
  return new Error("Unable to answer the authorization request.");
}

/**
 * `OAuthConsent` on Supabase Auth's OAuth 2.1 server, as the request's signed-in user (the cookie
 * session). `skipBrowserRedirect` makes approve and deny return the URL instead of navigating, since
 * this runs on the server.
 */
export const supabaseOAuthConsent: OAuthConsent = {
  async getRequest(authorizationId): Promise<ConsentRequest | null> {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error || !data) return null;
    if (!("authorization_id" in data)) return { kind: "already_approved", redirectUrl: data.redirect_url };
    return {
      kind: "needs_consent",
      authorizationId: data.authorization_id,
      app: toApp(data.client),
      redirectUri: data.redirect_uri,
      scopes: toScopes(data.scope ?? ""),
    };
  },

  async approve(authorizationId) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (error) throw decisionError(error);
    if (!data?.redirect_url) throw new Error("Unable to answer the authorization request.");
    return { redirectUrl: data.redirect_url };
  },

  async deny(authorizationId) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (error) throw decisionError(error);
    if (!data?.redirect_url) throw new Error("Unable to answer the authorization request.");
    return { redirectUrl: data.redirect_url };
  },

  async listConnectedApps(): Promise<ConnectedApp[]> {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.oauth.listGrants();
    if (error || !data) throw new Error("Unable to load the connected apps.");
    return data.map((grant) => ({ ...toApp(grant.client), scopes: grant.scopes, connectedAt: grant.granted_at }));
  },

  async disconnect(clientId) {
    const supabase = await createClient();
    // Revoking the grant also deletes the app's sessions and refresh tokens for this user.
    const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
    if (error) throw new Error("Unable to disconnect the app.");
  },
};
