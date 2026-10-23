import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import { apiFormError } from "@/hooks/use-api-form";
import { ApiError } from "@/lib/api/client";
import { oauthAuthorizationApiKey, type OAuthAuthorizationResponse } from "@/lib/api/keys";
import { BRAND } from "@/lib/brand";

import {
  answerAuthorization,
  consentLoginPath,
  consentScreenState,
  OAuthConsentScreen,
} from "./consent-screen";
import {
  CONSENT_CAPABILITIES,
  ConsentExpired,
  ConsentRefusedCard,
  ConsentRequestCard,
  redirectHost,
  refusalHelp,
  type ConsentDetails,
  type RefusedDetails,
} from "./consent-views";

// Component tests render static markup (no DOM), so the page's behaviour is tested through the pure
// state function and the request helper it calls, plus static renders of each state.

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

const ID = "auth_ABC-123";

const consentDetails: ConsentDetails = {
  kind: "consent",
  email: "ana@example.com",
  app: { clientId: "client-1", name: "Claude Code (simple-ledger)", uri: null, logoUri: null },
  redirectUri: "http://localhost:4567/callback",
  scopes: ["email"],
};

const refusedDetails: RefusedDetails = {
  kind: "refused",
  email: "ana@example.com",
  reason: "mcp_off",
  app: consentDetails.app,
};

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>);
}

/** The whole screen, with the details request already answered with `data`. */
function renderScreen(data?: OAuthAuthorizationResponse, authorizationId: string | null = ID) {
  return render(
    <SWRConfig value={{ fallback: data ? { [oauthAuthorizationApiKey(ID)]: data } : {}, fetcher: () => new Promise(() => {}) }}>
      <OAuthConsentScreen authorizationId={authorizationId} />
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

describe("consentScreenState", () => {
  it("is loading until the details arrive", () => {
    expect(consentScreenState({ authorizationId: ID })).toEqual({ view: "loading" });
  });

  it("is signed out on a 401, which sends the browser to sign in and back", () => {
    expect(consentScreenState({ authorizationId: ID, error: new ApiError("Unauthorized", 401) })).toEqual({ view: "signed_out" });
    expect(consentLoginPath(ID)).toBe("/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dauth_ABC-123");
  });

  it("is expired on a 404, or without a usable authorization id", () => {
    expect(consentScreenState({ authorizationId: ID, error: new ApiError("Gone", 404) })).toEqual({ view: "expired" });
    expect(consentScreenState({ authorizationId: null })).toEqual({ view: "expired" });
    expect(consentScreenState({ authorizationId: "../x" })).toEqual({ view: "expired" });
  });

  it("offers a retry for anything else", () => {
    expect(consentScreenState({ authorizationId: ID, error: new ApiError("Down", 503) })).toEqual({ view: "error" });
  });

  it("follows an already approved request (the API only sends it while access is ok)", () => {
    const data: OAuthAuthorizationResponse = { kind: "approved", redirectUrl: "http://localhost:4567/callback?code=c" };
    expect(consentScreenState({ authorizationId: ID, data })).toEqual({ view: "approved", redirectUrl: data.redirectUrl });
  });

  it("asks for consent, or shows the refusal", () => {
    expect(consentScreenState({ authorizationId: ID, data: consentDetails })).toEqual({ view: "consent", details: consentDetails });
    expect(consentScreenState({ authorizationId: ID, data: refusedDetails })).toEqual({ view: "refused", details: refusedDetails });
  });
});

describe("answerAuthorization", () => {
  it("POSTs Allow to the approve route and resolves to the URL back to the app", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ redirectUrl: "http://localhost:4567/callback?code=c" })));

    await expect(answerAuthorization(ID, "approve")).resolves.toBe("http://localhost:4567/callback?code=c");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/oauth/authorizations/auth_ABC-123/approve");
    expect(init?.method).toBe("POST");
  });

  it("POSTs Deny (and Back to the app) to the deny route", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ redirectUrl: "http://localhost:4567/callback?error=access_denied" })));

    await expect(answerAuthorization(ID, "deny")).resolves.toBe("http://localhost:4567/callback?error=access_denied");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/oauth/authorizations/auth_ABC-123/deny");
  });

  it("surfaces a refusal at approve as the server's message", async () => {
    stubFetch(new Response(JSON.stringify({ error: "A parent needs to turn on AI assistants for you." }), { status: 403 }));

    const caught = await answerAuthorization(ID, "approve").catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ApiError);
    expect(apiFormError(caught, "fallback").error).toBe("A parent needs to turn on AI assistants for you.");
  });
});

describe("redirectHost", () => {
  it("is the host and port the app sends the browser back to", () => {
    expect(redirectHost("http://localhost:4567/callback")).toBe("localhost:4567");
    expect(redirectHost("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
  });

  it("falls back to the raw value when it isn't a URL with a host", () => {
    expect(redirectHost("not a url")).toBe("not a url");
    expect(redirectHost("com.example.app:/callback")).toBe("com.example.app:/callback");
  });
});

describe("ConsentRequestCard", () => {
  const html = render(<ConsentRequestCard details={consentDetails} pending={null} error="" onDecide={() => {}} />);

  it("names the app and the account, and who is signed in", () => {
    expect(html).toContain(`Claude Code (simple-ledger) wants to use your ${BRAND.name} account`);
    expect(html).toMatch(/<h1[^>]*>Claude Code \(simple-ledger\) wants/);
    expect(html).toContain("ana@example.com");
  });

  it("shows the redirect host prominently, and the app's address", () => {
    expect(html).toContain("It will send you back to");
    expect(html).toContain(">localhost:4567<");
    expect(html).toContain("App address");
    expect(html).toContain("Not given");
    expect(render(<ConsentRequestCard details={{ ...consentDetails, app: { ...consentDetails.app, uri: "https://claude.ai" } }} pending={null} error="" onDecide={() => {}} />)).toContain(">https://claude.ai<");
  });

  it("says what the app can do and warns about apps you didn't start", () => {
    expect(html).toContain(CONSENT_CAPABILITIES);
    expect(html).toContain("Only allow apps you started connecting yourself.");
  });

  it("offers Allow and Deny, both disabled while a decision is in flight", () => {
    expect(html).toMatch(/<button[^>]*>Deny<\/button>/);
    expect(html).toMatch(/<button[^>]*>Allow<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled/);

    const pending = render(<ConsentRequestCard details={consentDetails} pending="approve" error="" onDecide={() => {}} />);
    expect(pending.match(/<button[^>]*disabled/g)).toHaveLength(2);
  });

  it("shows a failed decision's message", () => {
    const failed = render(<ConsentRequestCard details={consentDetails} pending={null} error="A parent needs to turn on AI assistants for you." onDecide={() => {}} />);
    expect(failed).toContain("A parent needs to turn on AI assistants for you.");
  });
});

describe("ConsentRefusedCard", () => {
  it.each([
    ["mcp_off", "MCP is turned off for this account. Turn it on in Settings → AI assistants.", "/settings/mcp"],
    ["not_permitted", "A parent needs to turn on AI assistants for you.", null],
    ["email_required", "Add and confirm an email address in Settings to use AI assistants.", "/settings"],
  ] as const)("explains %s, with a Settings link only where the user can fix it", (reason, message, href) => {
    const html = render(<ConsentRefusedCard details={{ ...refusedDetails, reason }} pending={null} error="" onBack={() => {}} />);

    expect(html).toContain("Claude Code (simple-ledger) can&#x27;t use your account");
    expect(html).toContain(message);
    expect(refusalHelp(reason).link?.href ?? null).toBe(href);
    if (href) expect(html).toContain(`href="${href}"`);
    else expect(html).not.toContain('href="/settings');
  });

  it("has a single button, Back to the app, and no Allow", () => {
    const html = render(<ConsentRefusedCard details={refusedDetails} pending={null} error="" onBack={() => {}} />);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*>Back to the app<\/button>/);
    expect(html).not.toContain("Allow");
  });

  it("speaks of AI assistants when an already approved request sent no app details", () => {
    const html = render(<ConsentRefusedCard details={{ ...refusedDetails, app: null }} pending={null} error="" onBack={() => {}} />);
    expect(html).toContain("AI assistants can&#x27;t use your account");
  });
});

describe("ConsentExpired", () => {
  it("says the request is gone and links back to the app", () => {
    const html = render(<ConsentExpired />);
    expect(html).toContain("This request has expired");
    expect(html).toContain('href="/dashboard"');
  });
});

describe("OAuthConsentScreen", () => {
  it("shows a loading state while it checks the request (and while a signed-out visitor is sent to sign in)", () => {
    const html = renderScreen();
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Checking the request…");
  });

  it("asks for consent", () => {
    const html = renderScreen(consentDetails);
    expect(html).toContain("wants to use your");
    expect(html).toMatch(/<button[^>]*>Allow<\/button>/);
  });

  it("shows the refusal with Back to the app", () => {
    const html = renderScreen(refusedDetails);
    expect(html).toContain("MCP is turned off for this account.");
    expect(html).toMatch(/<button[^>]*>Back to the app<\/button>/);
  });

  it("shows only a loading state for an already approved request, on its way back to the app", () => {
    const html = renderScreen({ kind: "approved", redirectUrl: "http://localhost:4567/callback?code=c" });
    expect(html).toContain("Returning you to the app…");
    expect(html).not.toContain("code=c");
  });

  it("shows the expired state without an authorization id", () => {
    expect(renderScreen(undefined, null)).toContain("This request has expired");
  });
});
