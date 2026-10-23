import "server-only";

import { getOAuthIssuer } from "@/lib/auth";

/** Where the protected-resource file for `/api/mcp` is served, under the app's origin (RFC 9728). */
const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/api/mcp";

/** The OAuth authorization server MCP clients are sent to. */
export function getMcpAuthorizationServer(): { issuer: string } {
  return { issuer: getOAuthIssuer() };
}

/**
 * The origin MCP clients are given: `SITE_URL` when it's set (it must be exactly that address, the
 * Tailscale name in production), else the request's own origin, as in local development.
 */
export function mcpResourceOrigin(request: Request): string {
  const siteUrl = process.env.SITE_URL;
  if (siteUrl) {
    try {
      return new URL(siteUrl).origin;
    } catch {
      // Fall through to the request's origin.
    }
  }
  return new URL(request.url).origin;
}

/** The `WWW-Authenticate` challenge that points an MCP client at the protected-resource file. */
export function mcpBearerChallenge(origin: string): string {
  return `Bearer resource_metadata="${origin}${RESOURCE_METADATA_PATH}"`;
}

/**
 * The protected-resource file for `/api/mcp`. Claude Code asks for `email` only (P1 finding 1), and
 * Supabase ignores the `resource` parameter, so tokens aren't checked against `resource`.
 */
export function mcpProtectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [getMcpAuthorizationServer().issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["email"],
  };
}
