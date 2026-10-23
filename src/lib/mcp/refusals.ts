import type { McpTokenCheck } from "@/lib/mcp/token-repository";

/** Why a user who is signed in, or holds a valid token, still can't use MCP. */
export type McpRefusal = Exclude<McpTokenCheck["status"], "ok" | "unknown" | "revoked" | "expired">;

/**
 * The "Refusals" table in docs/mcp-access-plan.md: what `/api/mcp` answers with a 403, and what the
 * consent page shows. Pure, so the browser can use it too.
 */
export const MCP_REFUSALS: Record<McpRefusal, string> = {
  mcp_off: "MCP is turned off for this account. Turn it on in Settings → AI assistants.",
  not_permitted: "A parent needs to turn on AI assistants for you.",
  email_required: "Add and confirm an email address in Settings to use AI assistants.",
  kid_token: "Kids connect AI assistants through the app's sign-in page, not with tokens.",
};
