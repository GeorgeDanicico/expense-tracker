"use client";

import useSWR from "swr";

import { apiRequest } from "@/lib/api/client";
import {
  MCP_SETTINGS_API_KEY,
  MCP_TOKENS_API_URL,
  mcpAppApiUrl,
  mcpTokenApiUrl,
  mcpTokenRegenerateApiUrl,
  type CreatedMcpToken,
  type McpSettingsResponse,
} from "@/lib/api/keys";
import type { McpTokenExpiry } from "@/lib/mcp/token-expiry";

/**
 * The caller's AI assistant settings, shared through the `/api/account/mcp` SWR cache entry. That
 * entry never holds a token's secret: the create and regenerate requests below return it to the
 * caller only, and the page re-fetches the list afterwards.
 */
export function useMcpSettings() {
  const response = useSWR<McpSettingsResponse>(MCP_SETTINGS_API_KEY);
  return {
    get settings() {
      return response.data;
    },
    get error() {
      return response.error;
    },
    get isLoading() {
      return response.isLoading;
    },
    mutate: response.mutate,
  };
}

/** Turns the switch on or off; answers the new settings (403 with the reason for a blocked kid). */
export function setMcpEnabled(enabled: boolean) {
  return apiRequest<McpSettingsResponse>(MCP_SETTINGS_API_KEY, { method: "PATCH", body: JSON.stringify({ enabled }) });
}

/**
 * Creates a personal token. The answer is the only time its secret is ever sent: keep it in component
 * state for the show-once dialog, never in the SWR cache, storage or the URL.
 */
export function createMcpToken(input: { name: string; expiry: McpTokenExpiry }) {
  return apiRequest<CreatedMcpToken>(MCP_TOKENS_API_URL, { method: "POST", body: JSON.stringify(input) });
}

/** Swaps a new secret into a token (the old one stops working at once). Same rules as {@link createMcpToken}. */
export function regenerateMcpToken(id: string, expiry: McpTokenExpiry) {
  return apiRequest<CreatedMcpToken>(mcpTokenRegenerateApiUrl(id), { method: "POST", body: JSON.stringify({ expiry }) });
}

export function revokeMcpToken(id: string) {
  return apiRequest<void>(mcpTokenApiUrl(id), { method: "DELETE" });
}

/** Disconnects one connected app (one registration; others with the same name stay). */
export function disconnectMcpApp(clientId: string) {
  return apiRequest<void>(mcpAppApiUrl(clientId), { method: "DELETE" });
}
