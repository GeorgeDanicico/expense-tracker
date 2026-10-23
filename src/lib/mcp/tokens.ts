import { createHash, randomBytes } from "node:crypto";

/**
 * Personal MCP access tokens (docs/mcp-access-plan.md, "Personal access tokens"): `sl_mcp_` and 43
 * base64url characters (256 random bits). Only the SHA-256 hash and the 13-character display prefix
 * are ever stored; the plain token is shown to its owner once.
 */
const TOKEN_PREFIX = "sl_mcp_";
const DISPLAY_PREFIX_LENGTH = 13;
const TOKEN_PATTERN = /^sl_mcp_[A-Za-z0-9_-]{43}$/;

/** How long a new or regenerated token lasts. The database accepts exactly these four. */
export const MCP_TOKEN_EXPIRIES = ["1m", "3m", "6m", "never"] as const;
export type McpTokenExpiry = (typeof MCP_TOKEN_EXPIRIES)[number];
export const DEFAULT_MCP_TOKEN_EXPIRY: McpTokenExpiry = "3m";
export const MCP_TOKEN_EXPIRY_LABELS: Record<McpTokenExpiry, string> = {
  "1m": "1 month",
  "3m": "3 months",
  "6m": "6 months",
  never: "Never",
};

/** Lowercase hex SHA-256 of the whole token: what `mcp_tokens.token_hash` holds. */
export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A new token from the operating system's secure random generator. `token` goes to the user once;
 * `prefix` and `hash` go to the database.
 */
export function generateMcpToken(): { token: string; prefix: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, prefix: mcpTokenDisplayPrefix(token), hash: hashMcpToken(token) };
}

/**
 * Whether the value claims to be one of our tokens (`sl_mcp_…`), well-formed or not. `/api/mcp` routes
 * on this: such a bearer value is a personal token, never an OAuth access token.
 */
export function hasMcpTokenPrefix(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
}

/** The first 13 characters (`sl_mcp_Ab3xQ9`), as stored and shown in the token list. */
export function mcpTokenDisplayPrefix(token: string): string {
  return token.slice(0, DISPLAY_PREFIX_LENGTH);
}

/** The value when it has the shape of one of our tokens, else null, so a stray value never reaches the database. */
export function parseMcpToken(value: string): string | null {
  return TOKEN_PATTERN.test(value) ? value : null;
}
