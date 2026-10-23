/**
 * How long a personal MCP token lasts. Free of `node:crypto` (unlike `@/lib/mcp/tokens`), so the
 * settings page can use the choices and their labels in the browser.
 */

/** The database accepts exactly these four. */
export const MCP_TOKEN_EXPIRIES = ["1m", "3m", "6m", "never"] as const;
export type McpTokenExpiry = (typeof MCP_TOKEN_EXPIRIES)[number];
export const DEFAULT_MCP_TOKEN_EXPIRY: McpTokenExpiry = "3m";
export const MCP_TOKEN_EXPIRY_LABELS: Record<McpTokenExpiry, string> = {
  "1m": "1 month",
  "3m": "3 months",
  "6m": "6 months",
  never: "Never",
};
