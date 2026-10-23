import type { CreatedMcpToken } from "@/lib/api/keys";
import { mcpTokenChangeAttempts, TOO_MANY_MCP_TOKEN_CHANGES } from "@/lib/http/rate-limit";
import { HttpError, json, parseBody, parseId, withUser } from "@/lib/http/route";
import { generateMcpToken } from "@/lib/mcp/tokens";
import { getRepositories } from "@/lib/repositories";
import { regenerateMcpTokenSchema } from "@/lib/validation/mcp";

/**
 * Swaps a new secret into one of the caller's tokens (an expired one too); the old secret stops
 * working at once. 200 `{ token, secret }`, `no-store` like every `json` response; never log the
 * body. 403 for kids, 404 when it isn't the caller's or is revoked, 422 for a bad expiry, 429 past 30
 * token changes an hour.
 */
export const POST = withUser(async (request, user, context: RouteContext<"/api/account/mcp/tokens/[id]/regenerate">) => {
  if (mcpTokenChangeAttempts.isLimited(user.id)) throw new HttpError(429, TOO_MANY_MCP_TOKEN_CHANGES);
  mcpTokenChangeAttempts.recordFailure(user.id);

  const id = parseId((await context.params).id, "Invalid token id.");
  const { expiry } = await parseBody(request, regenerateMcpTokenSchema, "Invalid token.");
  const { token: secret, prefix, hash } = generateMcpToken();
  const token = await getRepositories().mcpTokens.regenerate(id, { hash, prefix, expiry });
  return json({ token, secret } satisfies CreatedMcpToken);
}, { failure: "Unable to regenerate the token. Please try again." });
