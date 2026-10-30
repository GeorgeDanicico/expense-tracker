import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import AiFeaturesSettingsPage from "@/app/(app)/settings/ai/page";
import { ledgerSystem } from "@/components/ui/theme";
import { setAiEnabled } from "@/hooks/use-ai-settings";
import { AI_SETTINGS_API_KEY, type AiSettingsResponse } from "@/lib/api/keys";
import { AI_PROVIDER_POLICIES } from "@/lib/ai/provider-policy";

import { AI_BLOCK_MESSAGE, AI_SWITCH_LABEL, AiSwitchCard, aiSwitchState } from "./ai-switch-card";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/settings/ai" }));

const adultOff: AiSettingsResponse = { enabled: false, blockReason: null, provider: "openai" };

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>);
}

/** Whether the switch's checkbox is disabled, and whether it is checked. */
function switchInput(html: string) {
  const input = html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
  if (!input) throw new Error("No switch rendered");
  return { disabled: / disabled=""/.test(input), checked: / checked=""/.test(input) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the switch", () => {
  it("is labelled, off and usable for an adult", () => {
    const html = render(<AiSwitchCard settings={adultOff} onChange={() => {}} />);
    expect(html).toContain(AI_SWITCH_LABEL);
    expect(switchInput(html)).toEqual({ disabled: false, checked: false });
    expect(html).not.toContain(AI_BLOCK_MESSAGE);
  });

  it("shows when it is on", () => {
    expect(switchInput(render(<AiSwitchCard settings={{ ...adultOff, enabled: true }} onChange={() => {}} />)).checked).toBe(true);
  });

  it("is disabled for a kid without the permission, saying a parent can turn it on", () => {
    const settings: AiSettingsResponse = { ...adultOff, blockReason: "not_permitted" };
    expect(aiSwitchState(settings)).toEqual({ disabled: true, reason: "not_permitted" });
    const html = render(<AiSwitchCard settings={settings} onChange={() => {}} />);
    expect(switchInput(html)).toEqual({ disabled: true, checked: false });
    expect(html).toContain(AI_BLOCK_MESSAGE);
  });

  it("is usable for a kid whose parent turned the permission on", () => {
    expect(aiSwitchState({ enabled: false, blockReason: null })).toEqual({ disabled: false, reason: null });
  });
});

describe("the privacy text", () => {
  it("says what is sent and what isn't, and that a header can carry a name and address", () => {
    const html = render(<AiSwitchCard settings={adultOff} onChange={() => {}} />);
    expect(html).toContain("the text of the statement, with account and card numbers hidden");
    expect(html).toContain("the file itself, your name or email, and your other expenses");
    expect(html).toContain("name and address");
  });

  it("names the provider and its data policy", () => {
    const html = render(<AiSwitchCard settings={adultOff} onChange={() => {}} />);
    expect(html).toContain("Who receives it:</strong> OpenAI.");
    expect(html).toContain("isn&#x27;t used to train its models");
    expect(html).toContain("up to 30 days");
    expect(AI_PROVIDER_POLICIES.openai?.source).toMatch(/^https:\/\/developers\.openai\.com\//);
  });

  it("says nothing is sent when no provider is set up", () => {
    const html = render(<AiSwitchCard settings={{ ...adultOff, provider: null }} onChange={() => {}} />);
    expect(html).toContain("no AI provider is set up on this server, so nothing is sent");
    expect(html).not.toContain("OpenAI");
  });
});

describe("the page", () => {
  it("renders the card from the SWR cache", () => {
    const html = render(
      <SWRConfig value={{ fallback: { [AI_SETTINGS_API_KEY]: adultOff }, fetcher: () => new Promise(() => {}) }}>
        <AiFeaturesSettingsPage />
      </SWRConfig>,
    );
    expect(html).toContain(AI_SWITCH_LABEL);
  });
});

describe("setAiEnabled", () => {
  it("PATCHes { enabled } to /api/account/ai and answers the new settings", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ...adultOff, enabled: true }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await setAiEnabled(true)).toMatchObject({ enabled: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/account/ai");
    expect(init).toMatchObject({ method: "PATCH", body: JSON.stringify({ enabled: true }) });
  });

  it("surfaces a kid's 403 message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: "A parent needs to turn on AI features for you." }), { status: 403, headers: { "content-type": "application/json" } }),
      ),
    );
    await expect(setAiEnabled(true)).rejects.toThrow("A parent needs to turn on AI features for you.");
  });
});
