import { getOAuthConsent } from "@/lib/auth";
import type { OAuthDecisionResponse } from "@/lib/api/keys";
import { DomainError } from "@/lib/errors";
import { json, notFound, withUser } from "@/lib/http/route";
import { MCP_REFUSALS } from "@/lib/mcp/refusals";
import { getRepositories } from "@/lib/repositories";
import { AUTHORIZATION_NOT_FOUND, isAuthorizationId } from "@/lib/validation/oauth";

/**
 * Allows the app, answering the URL that sends the browser back to it with a one-time code. Checks
 * the caller's access again first (it may have changed since the page loaded): 403 with the reason
 * when they can't use AI assistants. 404 for a request that doesn't exist, has expired or is someone
 * else's.
 */
export const POST = withUser(async (_request, _user, context: RouteContext<"/api/oauth/authorizations/[id]/approve">) => {
  const { id } = await context.params;
  if (!isAuthorizationId(id)) notFound(AUTHORIZATION_NOT_FOUND);
  const access = await getRepositories().mcpTokens.access();
  if (access.status !== "ok") throw new DomainError(MCP_REFUSALS[access.status], 403);

  const { redirectUrl } = await getOAuthConsent().approve(id);
  return json({ redirectUrl } satisfies OAuthDecisionResponse);
}, { failure: "Unable to allow the app. Please try again." });
