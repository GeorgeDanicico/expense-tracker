import { getOAuthConsent } from "@/lib/auth";
import type { OAuthAuthorizationResponse } from "@/lib/api/keys";
import { json, notFound, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { AUTHORIZATION_NOT_FOUND, isAuthorizationId } from "@/lib/validation/oauth";

/**
 * An OAuth app's request to use the caller's account, for the consent page. While the caller can't
 * use AI assistants it answers why instead, and never the URL of a request Supabase already approved,
 * so the app doesn't get a code at all. 404 for a request that doesn't exist, has expired or is
 * someone else's.
 */
export const GET = withUser(async (_request, user, context: RouteContext<"/api/oauth/authorizations/[id]">) => {
  const { id } = await context.params;
  if (!isAuthorizationId(id)) notFound(AUTHORIZATION_NOT_FOUND);
  const request = await getOAuthConsent().getRequest(id);
  if (!request) notFound(AUTHORIZATION_NOT_FOUND);

  const access = await getRepositories().mcpTokens.access();
  let body: OAuthAuthorizationResponse;
  if (access.status !== "ok") {
    body = { kind: "refused", email: user.email, reason: access.status, app: request.kind === "needs_consent" ? request.app : null };
  } else if (request.kind === "already_approved") {
    body = { kind: "approved", redirectUrl: request.redirectUrl };
  } else {
    body = { kind: "consent", email: user.email, app: request.app, redirectUri: request.redirectUri, scopes: request.scopes };
  }
  return json(body);
}, { failure: "Unable to load the authorization request." });
