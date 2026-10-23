import "server-only";

import { getOAuthIssuer } from "@/lib/auth";

/** The OAuth authorization server MCP clients are sent to. */
export function getMcpAuthorizationServer(): { issuer: string } {
  return { issuer: getOAuthIssuer() };
}
