import { getOAuthConsent } from "@/lib/auth";
import type { OAuthDecisionResponse } from "@/lib/api/keys";
import { json, notFound, withUser } from "@/lib/http/route";
import { AUTHORIZATION_NOT_FOUND, isAuthorizationId } from "@/lib/validation/oauth";

/**
 * Denies the app, answering the URL that sends the browser back to it with `access_denied`. Works
 * whatever the caller's access, so a refused user can still send the app away. 404 for a request that
 * doesn't exist, has expired or is someone else's.
 */
export const POST = withUser(async (_request, _user, context: RouteContext<"/api/oauth/authorizations/[id]/deny">) => {
  const { id } = await context.params;
  if (!isAuthorizationId(id)) notFound(AUTHORIZATION_NOT_FOUND);
  const { redirectUrl } = await getOAuthConsent().deny(id);
  return json({ redirectUrl } satisfies OAuthDecisionResponse);
}, { failure: "Unable to deny the app. Please try again." });
