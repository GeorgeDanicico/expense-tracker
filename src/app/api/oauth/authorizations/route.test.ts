import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth";
import { FakeAuth } from "@/test/fakes/auth";
import { FakeOAuthConsent } from "@/test/fakes/oauth-consent";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs, testUser } from "@/test/route";

let auth: FakeAuth;
let consent: FakeOAuthConsent;

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), getOAuthConsent: () => consent }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET } from "@/app/api/oauth/authorizations/[id]/route";
import { POST as APPROVE } from "@/app/api/oauth/authorizations/[id]/approve/route";
import { POST as DENY } from "@/app/api/oauth/authorizations/[id]/deny/route";

const otherUser: AuthenticatedUser = { id: "20000000-0000-4000-8000-000000000002", email: "other@example.test" };
const NOT_FOUND = { status: 404, body: { error: "That authorization request doesn't exist or has expired." } };

let repositories: FakeRepositories;

/** Signs in as `user` for both the route wrapper and the consent fake. */
function signIn(user: AuthenticatedUser = testUser) {
  signedInAs(user);
  auth.currentUser = user;
  repositories.mcpTokens.caller = { userId: user.id };
}

function allowMcp(userId = testUser.id, kid: { mcp: boolean } | null = null, email = "owner@example.test") {
  repositories.mcpTokens.users.set(userId, { email, enabled: true, kid });
}

function details(id: string) {
  return callRoute(GET, { url: `/api/oauth/authorizations/${id}`, params: { id } });
}

function approve(id: string) {
  return callRoute(APPROVE, { method: "POST", url: `/api/oauth/authorizations/${id}/approve`, params: { id } });
}

function deny(id: string) {
  return callRoute(DENY, { method: "POST", url: `/api/oauth/authorizations/${id}/deny`, params: { id } });
}

beforeEach(() => {
  repositories = resetFakeRepositories();
  auth = new FakeAuth();
  consent = new FakeOAuthConsent(auth);
  signIn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/oauth/authorizations/[id]", () => {
  it("answers 401 when signed out", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
    const id = consent.addRequest(testUser.id);
    expect(await details(id)).toMatchObject({ status: 401 });
  });

  it("shows the app, the redirect and the caller's email while their access is ok", async () => {
    allowMcp();
    const id = consent.addRequest(testUser.id, {
      app: { name: "Claude Code (ledger)", uri: "https://claude.ai" },
      redirectUri: "http://localhost:4567/callback",
    });

    const response = await details(id);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.body).toEqual({
      kind: "consent",
      email: testUser.email,
      app: { clientId: "client-1", name: "Claude Code (ledger)", uri: "https://claude.ai", logoUri: null },
      redirectUri: "http://localhost:4567/callback",
      scopes: ["email"],
    });
  });

  it("answers 404 for another user's authorization id, without checking access", async () => {
    allowMcp();
    const id = consent.addRequest(otherUser.id);

    expect(await details(id)).toMatchObject(NOT_FOUND);
    expect(repositories.mcpTokens.calls).toEqual([]);
  });

  it("answers 404 for an unknown id, and for one that isn't URL-safe without asking the provider", async () => {
    expect(await details("authorization-404")).toMatchObject(NOT_FOUND);

    consent.fail("getRequest", new Error("should not be called"));
    expect(await details("..%2F..%2Fadmin")).toMatchObject(NOT_FOUND);
    expect(await details("a/b")).toMatchObject(NOT_FOUND);
  });

  it.each<[string, () => void]>([
    ["mcp_off", () => {}],
    ["not_permitted", () => allowMcp(testUser.id, { mcp: false })],
    ["email_required", () => allowMcp(testUser.id, { mcp: true }, "teo@kids.ifam.invalid")],
  ])("answers why when access is %s", async (reason, setUp) => {
    setUp();
    const id = consent.addRequest(testUser.id);

    const response = await details(id);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ kind: "refused", reason, email: testUser.email, app: { name: "Claude Code (simple-ledger)" } });
  });

  it("follows an already approved request only while access is ok", async () => {
    allowMcp();
    const id = consent.addRequest(testUser.id, { alreadyApproved: true });

    const response = await details(id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ kind: "approved", redirectUrl: expect.stringMatching(/^http:\/\/localhost:4567\/callback\?code=/) });
  });

  it("never sends the code of an already approved request to a caller whose access isn't ok", async () => {
    const id = consent.addRequest(testUser.id, { alreadyApproved: true });

    const response = await details(id);

    expect(response.body).toEqual({ kind: "refused", reason: "mcp_off", email: testUser.email, app: null });
    expect(JSON.stringify(response.body)).not.toContain("code=");
  });

  it("answers 500 with a generic message when the provider fails", async () => {
    allowMcp();
    const id = consent.addRequest(testUser.id);
    consent.fail("getRequest", new Error("provider said something secret"));

    expect(await details(id)).toMatchObject({ status: 500, body: { error: "Unable to load the authorization request." } });
  });
});

describe("POST /api/oauth/authorizations/[id]/approve", () => {
  it("approves the caller's request and answers the URL back to the app, with a code", async () => {
    allowMcp();
    const id = consent.addRequest(testUser.id);

    const response = await approve(id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ redirectUrl: expect.stringMatching(/^http:\/\/localhost:4567\/callback\?code=/) });
    expect(consent.requests.has(id)).toBe(false);
    expect(consent.grants).toHaveLength(1);
  });

  it("checks access again and answers 403 with the reason, leaving the request unanswered", async () => {
    const id = consent.addRequest(testUser.id);

    const response = await approve(id);

    expect(response).toMatchObject({
      status: 403,
      body: { error: "MCP is turned off for this account. Turn it on in Settings → AI assistants." },
    });
    expect(consent.requests.has(id)).toBe(true);
    expect(consent.grants).toEqual([]);
  });

  it("answers 403 for a kid whose parent hasn't turned AI assistants on", async () => {
    allowMcp(testUser.id, { mcp: false });
    const id = consent.addRequest(testUser.id);

    expect(await approve(id)).toMatchObject({ status: 403, body: { error: "A parent needs to turn on AI assistants for you." } });
  });

  it("answers 404 for another user's authorization id and approves nothing", async () => {
    allowMcp();
    const id = consent.addRequest(otherUser.id);

    expect(await approve(id)).toMatchObject(NOT_FOUND);
    expect(consent.requests.has(id)).toBe(true);
    expect(consent.grants).toEqual([]);
  });

  it("answers 401 when signed out", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
    expect(await approve(consent.addRequest(testUser.id))).toMatchObject({ status: 401 });
  });
});

describe("POST /api/oauth/authorizations/[id]/deny", () => {
  it("denies the caller's request and answers the URL back to the app, with access_denied", async () => {
    allowMcp();
    const id = consent.addRequest(testUser.id);

    const response = await deny(id);

    expect(response).toMatchObject({ status: 200, body: { redirectUrl: "http://localhost:4567/callback?error=access_denied" } });
    expect(consent.grants).toEqual([]);
  });

  it("works while access isn't ok, so a refused user can send the app away", async () => {
    const id = consent.addRequest(testUser.id);

    expect(await deny(id)).toMatchObject({ status: 200, body: { redirectUrl: "http://localhost:4567/callback?error=access_denied" } });
  });

  it("answers 404 for another user's authorization id", async () => {
    const id = consent.addRequest(otherUser.id);

    expect(await deny(id)).toMatchObject(NOT_FOUND);
    expect(consent.requests.has(id)).toBe(true);
  });
});
