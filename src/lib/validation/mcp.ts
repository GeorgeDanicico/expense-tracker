import { z } from "zod";

import { MCP_TOKEN_EXPIRIES } from "@/lib/mcp/token-expiry";

const EXPIRY_MESSAGE = "Choose an expiry: 1 month, 3 months, 6 months or never.";
const NAME_MESSAGE = "Give the token a name of 1 to 40 characters.";

const expiry = z.enum(MCP_TOKEN_EXPIRIES, EXPIRY_MESSAGE);

/** The body of `PATCH /api/account/mcp`. */
export const mcpSwitchSchema = z.object({
  enabled: z.boolean("Say whether AI assistants may use your account."),
});

/** The body of `POST /api/account/mcp/tokens`: a trimmed name of 1 to 40 characters, as the table requires. */
export const createMcpTokenSchema = z.object({
  name: z.string(NAME_MESSAGE).trim().min(1, NAME_MESSAGE).max(40, NAME_MESSAGE),
  expiry,
});

/** The body of `POST /api/account/mcp/tokens/[id]/regenerate`. */
export const regenerateMcpTokenSchema = z.object({ expiry });

/** What every token route answers for a token that isn't the caller's, or is revoked. */
export const MCP_TOKEN_NOT_FOUND = "Token not found.";
/** What the disconnect route answers for an app the caller hasn't connected. */
export const MCP_APP_NOT_FOUND = "That app isn't connected to your account.";

// OAuth client ids are URL-safe. Anything else is refused before it reaches the provider.
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Whether `value` looks like an OAuth client id. */
export function isOAuthClientId(value: string) {
  return CLIENT_ID_PATTERN.test(value);
}
