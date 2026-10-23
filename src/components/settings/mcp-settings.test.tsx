import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import AiAssistantsSettingsPage from "@/app/(app)/settings/mcp/page";
import { ledgerSystem } from "@/components/ui/theme";
import { createMcpToken, regenerateMcpToken, revokeMcpToken } from "@/hooks/use-mcp-settings";
import { MCP_SETTINGS_API_KEY, type CreatedMcpToken, type McpSettingsResponse } from "@/lib/api/keys";
import type { McpToken } from "@/lib/mcp/token-repository";

import { claudeMcpAddCommand, MCP_SERVER_NAME } from "./mcp-command";
import { McpConnectedAppsCard } from "./mcp-connected-apps";
import { MCP_SWITCH_LABEL, McpSwitchCard, mcpSwitchState } from "./mcp-switch-card";
import {
  CLOSE_BEFORE_COPY_WARNING,
  INITIAL_SECRET_DIALOG_STATE,
  McpTokenSecretContent,
  nextSecretDialogState,
} from "./mcp-token-secret-dialog";
import { CreateMcpTokenForm, McpTokensCard, NEVER_EXPIRES_WARNING, tokenExpiryStatus } from "./mcp-tokens";

// Component tests render static markup (no DOM), so behaviour is tested through the pure state
// functions and request helpers the components call, plus static renders of each state.

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/settings/mcp" }));

const NOW = Date.parse("2026-10-23T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const SECRET = `sl_mcp_${"A".repeat(43)}`;
const TOKEN_ID = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";

function token(overrides: Partial<McpToken> = {}): McpToken {
  return {
    id: TOKEN_ID,
    name: "Home server",
    prefix: "sl_mcp_Ab3xQ9",
    createdAt: "2026-10-01T08:00:00Z",
    regeneratedAt: null,
    lastUsedAt: null,
    expiresAt: new Date(NOW + 60 * DAY).toISOString(),
    ...overrides,
  };
}

const created: CreatedMcpToken = { token: token(), secret: SECRET };

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>);
}

/** Whether the switch's checkbox is disabled. */
function switchDisabled(html: string) {
  const input = html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
  if (!input) throw new Error("No switch rendered");
  return / disabled=""/.test(input);
}

function renderPage(settings: McpSettingsResponse) {
  return render(
    <SWRConfig value={{ fallback: { [MCP_SETTINGS_API_KEY]: settings }, fetcher: () => new Promise(() => {}) }}>
      <AiAssistantsSettingsPage />
    </SWRConfig>,
  );
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the switch", () => {
  it("is labelled and usable for an adult", () => {
    const html = render(<McpSwitchCard enabled={false} access={{ blockReason: null }} onChange={() => {}} />);
    expect(html).toContain(MCP_SWITCH_LABEL);
    expect(switchDisabled(html)).toBe(false);
  });

  it("is disabled for a kid without the permission, saying a parent can turn it on", () => {
    expect(mcpSwitchState(false, { blockReason: "not_permitted" })).toEqual({ disabled: true, reason: "not_permitted" });
    const html = render(<McpSwitchCard enabled={false} access={{ blockReason: "not_permitted" }} onChange={() => {}} />);
    expect(switchDisabled(html)).toBe(true);
    expect(html).toContain("A parent can turn on AI assistants for you in Manage family.");
  });

  it("is disabled for a kid without a real email, pointing to where they add one", () => {
    expect(mcpSwitchState(false, { blockReason: "email_required" })).toEqual({ disabled: true, reason: "email_required" });
    const html = render(<McpSwitchCard enabled={false} access={{ blockReason: "email_required" }} onChange={() => {}} />);
    expect(switchDisabled(html)).toBe(true);
    expect(html).toContain("Add and confirm an email address on the");
    expect(html).toContain('href="/settings"');
  });

  it("stays usable, to turn it off, for a kid whose permission was turned off while it was on", () => {
    expect(mcpSwitchState(true, { blockReason: "not_permitted" })).toEqual({ disabled: false, reason: "not_permitted" });
    const html = render(<McpSwitchCard enabled access={{ blockReason: "not_permitted" }} onChange={() => {}} />);
    expect(switchDisabled(html)).toBe(false);
    expect(html).toContain("Until then, every app is refused.");
  });

  it("is usable for a kid who passes both rules", () => {
    expect(mcpSwitchState(false, { blockReason: null })).toEqual({ disabled: false, reason: null });
  });
});

describe("the page", () => {
  const adult: McpSettingsResponse = {
    enabled: true,
    access: { status: "ok", personalTokens: true, blockReason: null },
    tokens: [],
    apps: [],
  };

  it("shows personal tokens to an adult", () => {
    const html = renderPage(adult);
    expect(html).toContain(MCP_SWITCH_LABEL);
    expect(html).toContain("Connected apps");
    expect(html).toContain("Personal access tokens");
  });

  it("hides personal tokens from a kid, who still sees connected apps and why the switch is off", () => {
    const html = renderPage({
      enabled: false,
      access: { status: "mcp_off", personalTokens: false, blockReason: "not_permitted" },
      tokens: null,
      apps: [],
    });
    expect(html).toContain("Connected apps");
    expect(html).not.toContain("Personal access tokens");
    expect(html).toContain("A parent can turn on AI assistants for you in Manage family.");
  });

  it("keeps both lists visible with a note while the switch is off", () => {
    const html = renderPage({ ...adult, enabled: false, access: { ...adult.access, status: "mcp_off" }, tokens: [token()] });
    expect(html).toContain("these apps are refused until you turn it back on");
    expect(html).toContain("these tokens are refused until you turn it back on");
    expect(html).toContain("Home server");
  });
});

describe("connected apps", () => {
  it("lists the same app twice, told apart by when each was connected", () => {
    const app = { name: "Claude Code (ifam)", uri: null, logoUri: null, scopes: ["email"] };
    const html = render(
      <McpConnectedAppsCard
        enabled
        origin="https://ledger.example"
        apps={[
          { ...app, clientId: "a", connectedAt: "2026-10-02T09:14:00Z" },
          { ...app, clientId: "b", connectedAt: "2026-10-21T18:40:00Z" },
        ]}
      />,
    );
    expect(html.match(/Claude Code \(ifam\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Connected 2 Oct 2026");
    expect(html).toContain("Connected 21 Oct 2026");
    expect(html.match(/>Disconnect</g)).toHaveLength(2);
  });

  it("explains how to connect Claude Code when there are none", () => {
    const html = render(<McpConnectedAppsCard enabled origin="https://ledger.example" apps={[]} />);
    expect(html).toContain("No connected apps");
    expect(html).toContain(`claude mcp add --transport http ${MCP_SERVER_NAME} https://ledger.example/api/mcp`);
  });
});

describe("creating a token", () => {
  it("defaults to 3 months without the warning", () => {
    const html = render(<CreateMcpTokenForm onCreated={() => {}} />);
    expect(html).toMatch(/<option value="3m" selected="">3 months<\/option>/);
    expect(html).not.toContain(NEVER_EXPIRES_WARNING);
  });

  it("warns right under the select when Never is chosen", () => {
    const html = render(<CreateMcpTokenForm onCreated={() => {}} defaultExpiry="never" />);
    expect(html).toContain(NEVER_EXPIRES_WARNING.replace(/'/g, "&#x27;"));
    expect(html.indexOf("Never</option>")).toBeLessThan(html.indexOf("We don&#x27;t recommend tokens that never expire."));
  });

  it("posts the name and expiry, and hands back the secret without caching it", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify(created), { status: 201 }));

    expect(await createMcpToken({ name: "VPS", expiry: "never" })).toEqual(created);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/mcp/tokens",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "VPS", expiry: "never" }), cache: "no-store" }),
    );
  });

  it("regenerates with the chosen expiry", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify(created)));

    await regenerateMcpToken(TOKEN_ID, "3m");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/account/mcp/tokens/${TOKEN_ID}/regenerate`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ expiry: "3m" }) }),
    );
  });
});

describe("the show-once dialog", () => {
  it("shows the token with Copy and the filled-in Claude Code command", () => {
    const html = render(<McpTokenSecretContent created={created} origin="https://ledger.example" confirmingClose={false} />);
    expect(html).toContain(`value="${SECRET}"`);
    expect(html).toContain("readOnly");
    expect(html).toContain('aria-label="Copy token"');
    expect(html).toContain(
      `claude mcp add --transport http ${MCP_SERVER_NAME} https://ledger.example/api/mcp --header &quot;Authorization: Bearer ${SECRET}&quot;`,
    );
    expect(html).not.toContain(CLOSE_BEFORE_COPY_WARNING.replace(/'/g, "&#x27;"));
  });

  it("builds the command with and without a token", () => {
    expect(claudeMcpAddCommand("https://a.example")).toBe(`claude mcp add --transport http ${MCP_SERVER_NAME} https://a.example/api/mcp`);
    expect(claudeMcpAddCommand("https://a.example", SECRET)).toBe(
      `claude mcp add --transport http ${MCP_SERVER_NAME} https://a.example/api/mcp --header "Authorization: Bearer ${SECRET}"`,
    );
  });

  it("asks before closing when nothing was copied", () => {
    const asking = nextSecretDialogState(INITIAL_SECRET_DIALOG_STATE, "close");
    expect(asking).toEqual({ copied: false, confirmingClose: true });

    const html = render(<McpTokenSecretContent created={created} origin="https://ledger.example" confirmingClose />);
    expect(html).toContain("You won&#x27;t see this token again. Close anyway?");
  });

  it("goes back to the token on Keep it open, and closes on Close anyway", () => {
    const asking = { copied: false, confirmingClose: true };
    expect(nextSecretDialogState(asking, "keep_open")).toEqual(INITIAL_SECRET_DIALOG_STATE);
    expect(nextSecretDialogState(asking, "close_anyway")).toBe("closed");
  });

  it("closes without asking once the token or the command was copied", () => {
    const copied = nextSecretDialogState(INITIAL_SECRET_DIALOG_STATE, "copied");
    expect(copied).toEqual({ copied: true, confirmingClose: false });
    expect(nextSecretDialogState(copied as typeof INITIAL_SECRET_DIALOG_STATE, "close")).toBe("closed");
  });

  it("copying while asking clears the question", () => {
    expect(nextSecretDialogState({ copied: false, confirmingClose: true }, "copied")).toEqual({ copied: true, confirmingClose: false });
  });
});

describe("the token list", () => {
  it("shows expiry tones: within a week, expired and never", () => {
    expect(tokenExpiryStatus(new Date(NOW + 12 * DAY).toISOString(), NOW)).toEqual({ label: "Expires in 12 days", tone: "neutral" });
    expect(tokenExpiryStatus(new Date(NOW + 7 * DAY).toISOString(), NOW)).toEqual({ label: "Expires in 7 days", tone: "warning" });
    expect(tokenExpiryStatus(new Date(NOW + 2 * 60 * 60 * 1000).toISOString(), NOW)).toEqual({ label: "Expires in 1 day", tone: "warning" });
    expect(tokenExpiryStatus(new Date(NOW - DAY).toISOString(), NOW)).toEqual({ label: "Expired", tone: "negative" });
    expect(tokenExpiryStatus(new Date(NOW).toISOString(), NOW)).toEqual({ label: "Expired", tone: "negative" });
    expect(tokenExpiryStatus(null, NOW)).toEqual({ label: "Never expires", tone: "warning" });
  });

  it("lists the prefix, created, last used, expiry, Regenerate and Revoke", () => {
    const html = render(
      <McpTokensCard
        enabled
        origin="https://ledger.example"
        now={NOW}
        tokens={[
          token({ id: "a", name: "Old laptop", expiresAt: "2026-09-01T08:00:00Z" }),
          token({ id: "b", name: "NAS", expiresAt: null, lastUsedAt: "2026-10-22T03:00:00Z" }),
        ]}
      />,
    );
    expect(html).toContain("sl_mcp_Ab3xQ9…");
    expect(html).toContain("Created 1 Oct 2026");
    expect(html).toContain("Last used: Never");
    expect(html).toContain("Last used: 22 Oct 2026");
    expect(html).toContain("Expired");
    expect(html).toContain("Never expires");
    expect(html).toContain('aria-label="Regenerate NAS"');
    expect(html).toContain('aria-label="Revoke NAS"');
    expect(html).not.toContain(SECRET);
  });

  it("revokes with a DELETE on that token", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));

    await revokeMcpToken(TOKEN_ID);
    expect(fetchMock).toHaveBeenCalledWith(`/api/account/mcp/tokens/${TOKEN_ID}`, expect.objectContaining({ method: "DELETE" }));
  });

  it("passes on the server's refusal when revoking fails", async () => {
    stubFetch(new Response(JSON.stringify({ error: "Token not found." }), { status: 404 }));

    await expect(revokeMcpToken(TOKEN_ID)).rejects.toThrow("Token not found.");
  });
});
