import "server-only";

import type { AuthSession } from "@/lib/auth/service";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient, createTokenClient, runWithSupabaseClient } from "@/lib/supabase/server";

/**
 * [p1-spike] The least Supabase OAuth 2.1 server code for the spike in docs/mcp-access-plan.md (P1).
 * Not for merging: M3 replaces it with `McpAuthorizationServer`, `OAuthConsent` and
 * `AuthService.verifyAppToken` / `sessionForAppToken`.
 */

export type SpikeConsentRequest =
  | {
      kind: "needs_consent";
      authorizationId: string;
      clientName: string;
      clientUri: string;
      redirectUri: string;
      scopes: string[];
      userEmail: string;
    }
  | { kind: "already_approved"; redirectUrl: string };

/** The authorization server MCP clients are sent to: the project's Supabase Auth issuer. */
export function getAuthIssuer(): string {
  return `${getSupabaseConfig().url.replace(/\/+$/, "")}/auth/v1`;
}

function decodeJwtPart(part: string | undefined): Record<string, unknown> | null {
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Logs the parts of an access token the spike questions need. Never logs the token itself. */
function logTokenShape(token: string) {
  const [headerPart, payloadPart] = token.split(".");
  const header = decodeJwtPart(headerPart);
  const payload = decodeJwtPart(payloadPart);
  console.log("[p1-spike] access token header", { alg: header?.alg, kid: header?.kid, typ: header?.typ });
  console.log("[p1-spike] access token claims", {
    iss: payload?.iss,
    aud: payload?.aud,
    sub: payload?.sub,
    role: payload?.role,
    client_id: payload?.client_id,
    scope: payload?.scope,
    session_id: payload?.session_id,
    amr: payload?.amr,
    iat: payload?.iat,
    exp: payload?.exp,
    expiresIn: typeof payload?.exp === "number" ? `${Math.round(payload.exp - Date.now() / 1000)}s` : undefined,
  });
}

/** The consent request for the signed-in user (cookie session). Null when Supabase refuses it. */
export async function getConsentRequest(authorizationId: string): Promise<SpikeConsentRequest | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    console.log("[p1-spike] getAuthorizationDetails failed", { code: error?.code, status: error?.status, message: error?.message });
    return null;
  }
  if (!("authorization_id" in data)) {
    console.log("[p1-spike] AUTO-APPROVE: getAuthorizationDetails returned a redirect_url, no consent shown", {
      redirectHost: safeHost(data.redirect_url),
    });
    return { kind: "already_approved", redirectUrl: data.redirect_url };
  }
  console.log("[p1-spike] authorization details", {
    clientId: data.client.id,
    clientName: data.client.name,
    clientUri: data.client.uri,
    redirectUri: data.redirect_uri,
    scope: data.scope,
    user: data.user.email,
    otherFields: Object.keys(data).filter(
      (key) => !["authorization_id", "redirect_uri", "client", "user", "scope"].includes(key),
    ),
  });
  return {
    kind: "needs_consent",
    authorizationId: data.authorization_id,
    clientName: data.client.name,
    clientUri: data.client.uri,
    redirectUri: data.redirect_uri,
    scopes: data.scope ? data.scope.split(/\s+/).filter(Boolean) : [],
    userEmail: data.user.email,
  };
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}

/** Approves or denies as the signed-in user; the URL to send the browser back to the app. */
export async function decideConsent(authorizationId: string, allow: boolean): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = allow
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (error || !data) {
    console.log(`[p1-spike] ${allow ? "approve" : "deny"}Authorization failed`, {
      code: error?.code,
      status: error?.status,
      message: error?.message,
    });
    return null;
  }
  console.log(`[p1-spike] ${allow ? "approved" : "denied"}`, { redirectHost: safeHost(data.redirect_url) });
  return data.redirect_url;
}

/**
 * The session for an OAuth app's access token: requires a `client_id` claim and a live session at
 * Supabase (`getUser`), then runs as that user on a client carrying the token, so RLS applies.
 */
export async function sessionForAppToken(token: string): Promise<AuthSession | null> {
  logTokenShape(token);
  try {
    const client = createTokenClient(token);
    const { data: claimsData, error: claimsError } = await client.auth.getClaims(token);
    const claims = claimsData?.claims as Record<string, unknown> | undefined;
    if (claimsError || !claims?.sub) {
      console.log("[p1-spike] getClaims refused the token", { message: claimsError?.message });
      return null;
    }
    if (typeof claims.client_id !== "string") {
      console.log("[p1-spike] token has no client_id claim (a web-session JWT?), refusing");
      return null;
    }
    const { data: userData, error: userError } = await client.auth.getUser(token);
    if (userError || !userData.user) {
      console.log("[p1-spike] getUser refused the token (session ended?)", {
        code: userError?.code,
        status: userError?.status,
        message: userError?.message,
      });
      return null;
    }
    const user = userData.user;
    return {
      userId: user.id,
      email: user.email ?? "",
      run: (fn) => runWithSupabaseClient(client, fn),
      isActive: async () => true,
    };
  } catch (error) {
    console.log("[p1-spike] verifying the app token threw", { message: (error as Error).message });
    return null;
  }
}

/** [p1-spike] Q4: the signed-in user's OAuth grants. */
export async function listGrants(): Promise<{ clientId: string; clientName: string; scopes: string[]; grantedAt: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.listGrants();
  if (error || !data) {
    console.log("[p1-spike] listGrants failed", { code: error?.code, status: error?.status, message: error?.message });
    return [];
  }
  return data.map((grant) => ({
    clientId: grant.client.id,
    clientName: grant.client.name,
    scopes: grant.scopes,
    grantedAt: grant.granted_at,
  }));
}

/** [p1-spike] Q4: revokes one client's grant for the signed-in user. */
export async function revokeGrant(clientId: string): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
  console.log("[p1-spike] revokeGrant", { clientId, ok: !error, code: error?.code, message: error?.message, at: new Date().toISOString() });
  return !error;
}
