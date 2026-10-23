import type { CreatedMcpToken } from "@/lib/api/keys";
import { mcpTokenChangeAttempts, TOO_MANY_MCP_TOKEN_CHANGES } from "@/lib/http/rate-limit";
import { HttpError, json, parseBody, withUser } from "@/lib/http/route";
import { generateMcpToken } from "@/lib/mcp/tokens";
import { getRepositories } from "@/lib/repositories";
import { createMcpTokenSchema } from "@/lib/validation/mcp";

/**
 * Creates a personal token: 201 `{ token, secret }`, the only time the secret is ever sent (every
 * `json` response is `no-store`). Only the hash and display prefix reach the database. Never log the
 * body. 403 for kids, 409 at 10 live tokens, 422 for a bad name or expiry, 429 past 30 token changes
 * an hour.
 */
export const POST = withUser(async (request, user) => {
  if (mcpTokenChangeAttempts.isLimited(user.id)) throw new HttpError(429, TOO_MANY_MCP_TOKEN_CHANGES);
  mcpTokenChangeAttempts.recordFailure(user.id);

  const { name, expiry } = await parseBody(request, createMcpTokenSchema, "Invalid token.");
  const { token: secret, prefix, hash } = generateMcpToken();
  const token = await getRepositories().mcpTokens.create({ name, hash, prefix, expiry });
  return json({ token, secret } satisfies CreatedMcpToken, 201);
}, { failure: "Unable to create the token. Please try again." });
