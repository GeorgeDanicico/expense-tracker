import "server-only";

import { spikeAuthIssuer } from "@/lib/auth";

/**
 * [p1-spike] The protected-resource metadata (RFC 9728) and the 401 challenge for `/api/mcp`.
 * M6 replaces this with `McpAuthorizationServer`.
 */

/** The app's public origin: the request's own origin in development, `SITE_URL` in production. */
export function mcpOrigin(request: Request): string {
  const requestOrigin = new URL(request.url).origin;
  if (process.env.NODE_ENV !== "production") return requestOrigin;
  try {
    return process.env.SITE_URL ? new URL(process.env.SITE_URL).origin : requestOrigin;
  } catch {
    return requestOrigin;
  }
}

export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource/api/mcp`;
}

export function bearerChallenge(origin: string): string {
  return `Bearer resource_metadata="${resourceMetadataUrl(origin)}"`;
}

export function protectedResourceMetadata(origin: string) {
  // Spike knob: leave P1_SPIKE_SCOPES unset to see what Claude Code asks for on its own, or set it
  // (space-separated, e.g. "email offline_access") to try a scopes_supported list.
  const scopes = process.env.P1_SPIKE_SCOPES?.split(/\s+/).filter(Boolean);
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [spikeAuthIssuer()],
    bearer_methods_supported: ["header"],
    ...(scopes?.length ? { scopes_supported: scopes } : {}),
  };
}
