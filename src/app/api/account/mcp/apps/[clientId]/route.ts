import { getOAuthConsent } from "@/lib/auth";
import { noContent, notFound, withUser } from "@/lib/http/route";
import { isOAuthClientId, MCP_APP_NOT_FOUND } from "@/lib/validation/mcp";

/**
 * Disconnects one app: ends every session and refresh token it holds for the caller, so its next
 * request is refused. Other registrations with the same name have their own client ids and stay.
 * 204; 404 for a client id the caller hasn't connected (someone else's, or none at all).
 */
export const DELETE = withUser(async (_request, _user, context: RouteContext<"/api/account/mcp/apps/[clientId]">) => {
  const { clientId } = await context.params;
  if (!isOAuthClientId(clientId)) notFound(MCP_APP_NOT_FOUND);

  const consent = getOAuthConsent();
  const apps = await consent.listConnectedApps();
  if (!apps.some((app) => app.clientId === clientId)) notFound(MCP_APP_NOT_FOUND);
  await consent.disconnect(clientId);
  return noContent();
}, { failure: "Unable to disconnect the app. Please try again." });
