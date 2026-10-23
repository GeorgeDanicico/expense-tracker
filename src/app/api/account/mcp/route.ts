import { getOAuthConsent } from "@/lib/auth";
import type { McpSettingsResponse } from "@/lib/api/keys";
import { json, parseBody, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { mcpSwitchSchema } from "@/lib/validation/mcp";

/**
 * The caller's AI assistant settings. `enabled` is derived from `access`: the access rule answers
 * `mcp_off` exactly when `profiles.mcp_enabled` is off, before any kid rule, so a kid who is both
 * switched off and blocked reads `mcp_off`; `access.blockReason` says why they can't turn it on.
 */
async function loadSettings(): Promise<McpSettingsResponse> {
  const { mcpTokens } = getRepositories();
  const [access, apps] = await Promise.all([mcpTokens.access(), getOAuthConsent().listConnectedApps()]);
  const tokens = access.personalTokens ? await mcpTokens.list() : null;
  return { enabled: access.status !== "mcp_off", access, tokens, apps };
}

/** The switch, the caller's access, their personal tokens (null for kids) and their connected apps. */
export const GET = withUser(async () => json(await loadSettings()), {
  failure: "Unable to load your AI assistant settings.",
});

/**
 * Turns the caller's switch on or off, answering the same shape as GET. Turning it off always works;
 * 403 with the reason for a kid who can't turn it on.
 */
export const PATCH = withUser(async (request) => {
  const { enabled } = await parseBody(request, mcpSwitchSchema, "Invalid AI assistant setting.");
  await getRepositories().mcpTokens.setEnabled(enabled);
  return json(await loadSettings());
}, { failure: "Unable to save your AI assistant setting. Please try again." });
