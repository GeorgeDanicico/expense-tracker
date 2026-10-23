import { mcpTokenChangeAttempts, TOO_MANY_MCP_TOKEN_CHANGES } from "@/lib/http/rate-limit";
import { HttpError, noContent, notFound, parseId, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { MCP_TOKEN_NOT_FOUND } from "@/lib/validation/mcp";

/**
 * Revokes one of the caller's tokens; it stops working on the next request. 204; 404 when it isn't
 * the caller's or is already revoked; 429 past 30 token changes an hour.
 */
export const DELETE = withUser(async (_request, user, context: RouteContext<"/api/account/mcp/tokens/[id]">) => {
  if (mcpTokenChangeAttempts.isLimited(user.id)) throw new HttpError(429, TOO_MANY_MCP_TOKEN_CHANGES);
  mcpTokenChangeAttempts.recordFailure(user.id);

  const id = parseId((await context.params).id, "Invalid token id.");
  if (!(await getRepositories().mcpTokens.revoke(id))) notFound(MCP_TOKEN_NOT_FOUND);
  return noContent();
}, { failure: "Unable to revoke the token. Please try again." });
