import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth";
import { MCP_TOKEN_CHANGE_MAX_ATTEMPTS, resetRateLimits } from "@/lib/http/rate-limit";
import { hashMcpToken } from "@/lib/mcp/tokens";
import { FakeAuth } from "@/test/fakes/auth";
import type { FakeMcpUser } from "@/test/fakes/mcp-tokens";
import { FakeOAuthConsent } from "@/test/fakes/oauth-consent";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs, testUser } from "@/test/route";

let auth: FakeAuth;
let consent: FakeOAuthConsent;

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), getOAuthConsent: () => consent }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET, PATCH } from "@/app/api/account/mcp/route";
import { GET as GET_APPS } from "@/app/api/account/mcp/apps/route";
import { DELETE as DISCONNECT } from "@/app/api/account/mcp/apps/[clientId]/route";
import { POST as CREATE } from "@/app/api/account/mcp/tokens/route";
import { DELETE as REVOKE } from "@/app/api/account/mcp/tokens/[id]/route";
import { POST as REGENERATE } from "@/app/api/account/mcp/tokens/[id]/regenerate/route";

const otherUser: AuthenticatedUser = { id: "20000000-0000-4000-8000-000000000002", email: "other@example.test" };
const MISSING_ID = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";
const SECRET = /^sl_mcp_[A-Za-z0-9_-]{43}$/;

const NOT_PERMITTED = "A parent needs to turn on AI assistants for you.";
const EMAIL_REQUIRED = "Add and confirm an email address in Settings to use AI assistants.";
const KID_TOKENS = "Kids connect AI assistants through the app's sign-in page, not with tokens.";
const TOKEN_NOT_FOUND = { status: 404, body: { error: "Token not found." } };
const APP_NOT_FOUND = { status: 404, body: { error: "That app isn't connected to your account." } };

let repositories: FakeRepositories;

/** Signs in as `user` for the route wrapper, the consent fake and the token repository. */
function signIn(user: AuthenticatedUser = testUser) {
  signedInAs(user);
  auth.currentUser = user;
  repositories.mcpTokens.caller = { userId: user.id };
}

/** The caller's MCP state: their switch, and for a kid their `mcp` permission (and email). */
function setUser(state: Partial<FakeMcpUser>, userId = testUser.id) {
  repositories.mcpTokens.users.set(userId, { email: "owner@example.test", enabled: false, kid: null, ...state });
}

const roles = {
  "a user with no family": { kid: null },
  "a parent": { kid: null },
  "a kid with the permission off": { kid: { mcp: false }, email: "teo@example.test" },
  "a kid with the permission on and no real email": { kid: { mcp: true }, email: "teo@kids.ifam.invalid" },
  "a kid with the permission on and a real email": { kid: { mcp: true }, email: "teo@example.test" },
} satisfies Record<string, Partial<FakeMcpUser>>;

const settings = () => callRoute(GET, { url: "/api/account/mcp" });
const setSwitch = (body: unknown) => callRoute(PATCH, { method: "PATCH", url: "/api/account/mcp", body });
const create = (body: unknown = { name: "VPS", expiry: "3m" }) =>
  callRoute(CREATE, { method: "POST", url: "/api/account/mcp/tokens", body });
const regenerate = (id: string, body: unknown = { expiry: "1m" }) =>
  callRoute(REGENERATE, { method: "POST", url: `/api/account/mcp/tokens/${id}/regenerate`, body, params: { id } });
const revoke = (id: string) => callRoute(REVOKE, { method: "DELETE", url: `/api/account/mcp/tokens/${id}`, params: { id } });
const disconnect = (clientId: string) =>
  callRoute(DISCONNECT, { method: "DELETE", url: `/api/account/mcp/apps/${clientId}`, params: { clientId } });

/** A token of `userId`'s, created as them; returns its id. */
async function seedToken(userId = testUser.id, name = "Seed") {
  const previous = repositories.mcpTokens.caller;
  repositories.mcpTokens.caller = { userId };
  const hash = hashMcpToken(`sl_mcp_${name.padEnd(43, "x")}`);
  const token = await repositories.mcpTokens.create({ name, hash, prefix: "sl_mcp_Seed00", expiry: "3m" });
  repositories.mcpTokens.caller = previous;
  return token.id;
}

beforeEach(() => {
  resetRateLimits();
  repositories = resetFakeRepositories();
  auth = new FakeAuth();
  consent = new FakeOAuthConsent(auth);
  signIn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/account/mcp", () => {
  it("answers 401 when signed out", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
    expect(await settings()).toMatchObject({ status: 401 });
  });

  it("shows an adult's switch, access, tokens and connected apps, no-store", async () => {
    setUser({ enabled: true });
    await seedToken();
    await seedToken(otherUser.id, "Theirs");
    consent.addGrant(testUser.id, { clientId: "client-a" }, "2026-10-01T00:00:00.000Z");
    consent.addGrant(testUser.id, { clientId: "client-b" }, "2026-10-20T00:00:00.000Z");
    consent.addGrant(otherUser.id, { clientId: "client-c" });

    const response = await settings();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.body).toMatchObject({
      enabled: true,
      access: { status: "ok", personalTokens: true, blockReason: null },
      tokens: [{ name: "Seed", prefix: "sl_mcp_Seed00" }],
      // The same app twice, once per registration, each with its own client id and date.
      apps: [
        { clientId: "client-a", name: "Claude Code (simple-ledger)", connectedAt: "2026-10-01T00:00:00.000Z" },
        { clientId: "client-b", name: "Claude Code (simple-ledger)", connectedAt: "2026-10-20T00:00:00.000Z" },
      ],
    });
  });

  it("never includes a secret or a hash in the token list", async () => {
    setUser({ enabled: true });
    const created = await create();
    const response = await settings();

    expect(Object.keys(response.body.tokens[0]).sort()).toEqual(
      ["createdAt", "expiresAt", "id", "lastUsedAt", "name", "prefix", "regeneratedAt"],
    );
    expect(JSON.stringify(response.body)).not.toContain(created.body.secret);
    expect(JSON.stringify(response.body)).not.toContain(hashMcpToken(created.body.secret));
  });

  it.each([
    ["a user with no family", roles["a user with no family"], { enabled: false, access: { status: "mcp_off", personalTokens: true, blockReason: null }, tokens: [] }],
    ["a parent", roles["a parent"], { enabled: false, access: { status: "mcp_off", personalTokens: true, blockReason: null }, tokens: [] }],
    ["a kid with the permission off", roles["a kid with the permission off"], { enabled: false, access: { status: "mcp_off", personalTokens: false, blockReason: "not_permitted" }, tokens: null }],
    [
      "a kid with the permission on and no real email",
      roles["a kid with the permission on and no real email"],
      { enabled: false, access: { status: "mcp_off", personalTokens: false, blockReason: "email_required" }, tokens: null },
    ],
    [
      "a kid with the permission on and a real email",
      roles["a kid with the permission on and a real email"],
      { enabled: false, access: { status: "mcp_off", personalTokens: false, blockReason: null }, tokens: null },
    ],
  ])("shows %s with the switch off", async (_role, state, expected) => {
    setUser(state);
    const response = await settings();
    expect(response).toMatchObject({ status: 200, body: { ...expected, apps: [] } });
  });

  it("reports the switch on but the access blocked for a kid whose permission was turned off since", async () => {
    setUser({ enabled: true, kid: { mcp: false } });

    expect((await settings()).body).toMatchObject({
      enabled: true,
      access: { status: "not_permitted", personalTokens: false, blockReason: "not_permitted" },
      tokens: null,
    });
  });

  it("answers 500 with a generic message when the apps can't be loaded", async () => {
    consent.fail("listConnectedApps", new Error("provider said something secret"));
    expect(await settings()).toMatchObject({ status: 500, body: { error: "Unable to load your AI assistant settings." } });
  });
});

describe("PATCH /api/account/mcp", () => {
  it.each([["a user with no family"], ["a parent"], ["a kid with the permission on and a real email"]] as const)(
    "lets %s turn the switch on and off, answering the settings",
    async (role) => {
      setUser(roles[role]);

      const on = await setSwitch({ enabled: true });
      expect(on).toMatchObject({ status: 200, body: { enabled: true, access: { status: "ok" }, apps: [] } });
      expect(on.headers.get("cache-control")).toContain("no-store");

      expect(await setSwitch({ enabled: false })).toMatchObject({ status: 200, body: { enabled: false, access: { status: "mcp_off" } } });
    },
  );

  it.each([
    ["a kid with the permission off", NOT_PERMITTED],
    ["a kid with the permission on and no real email", EMAIL_REQUIRED],
  ] as const)("answers 403 with the reason when %s turns it on", async (role, reason) => {
    setUser(roles[role]);

    expect(await setSwitch({ enabled: true })).toMatchObject({ status: 403, body: { error: reason } });
    expect(repositories.mcpTokens.users.get(testUser.id)?.enabled).toBe(false);
  });

  it("always lets a blocked kid turn it off", async () => {
    setUser({ ...roles["a kid with the permission off"], enabled: true });
    expect(await setSwitch({ enabled: false })).toMatchObject({ status: 200, body: { enabled: false } });
  });

  it.each([[{}], [{ enabled: "yes" }], ["not json"], [null]])("answers 422 for %j", async (body) => {
    expect(await setSwitch(body)).toMatchObject({ status: 422 });
    expect(repositories.mcpTokens.calls).toEqual([]);
  });
});

describe("POST /api/account/mcp/tokens", () => {
  it("creates a token and answers 201 { token, secret }, no-store, storing only the hash", async () => {
    setUser({ enabled: true });

    const response = await create({ name: "  VPS  ", expiry: "never" });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.body).toEqual({
      token: {
        id: expect.any(String),
        name: "VPS",
        prefix: response.body.secret.slice(0, 13),
        createdAt: expect.any(String),
        regeneratedAt: null,
        lastUsedAt: null,
        expiresAt: null,
      },
      secret: expect.stringMatching(SECRET),
    });
    const [stored] = repositories.mcpTokens.tokens;
    expect(stored.hash).toBe(hashMcpToken(response.body.secret));
    expect(await repositories.mcpTokens.check(hashMcpToken(response.body.secret))).toMatchObject({ status: "ok" });
  });

  it("works while the switch is off, so tokens can be set up first", async () => {
    expect(await create()).toMatchObject({ status: 201 });
  });

  it.each([
    ["a kid with the permission off"],
    ["a kid with the permission on and no real email"],
    ["a kid with the permission on and a real email"],
  ] as const)("answers 403 for %s, even with the switch on", async (role) => {
    setUser({ ...roles[role], enabled: role === "a kid with the permission on and a real email" });

    expect(await create()).toMatchObject({ status: 403, body: { error: KID_TOKENS } });
    expect(repositories.mcpTokens.tokens).toEqual([]);
  });

  it("answers 409 at 10 live tokens", async () => {
    for (let index = 0; index < 10; index++) await seedToken(testUser.id, `Token ${index}`);

    expect(await create()).toMatchObject({
      status: 409,
      body: { error: "You can have at most 10 personal tokens. Revoke one to create another." },
    });
  });

  it.each([
    [{ name: "", expiry: "3m" }],
    [{ name: "   ", expiry: "3m" }],
    [{ name: "x".repeat(41), expiry: "3m" }],
    [{ name: "VPS", expiry: "12m" }],
    [{ name: "VPS" }],
    [{ expiry: "3m" }],
    ["not json"],
  ])("answers 422 for %j without creating anything", async (body) => {
    expect(await create(body)).toMatchObject({ status: 422 });
    expect(repositories.mcpTokens.tokens).toEqual([]);
  });

  it(`answers 429 after ${MCP_TOKEN_CHANGE_MAX_ATTEMPTS} token changes, counting creates, regenerates and revokes`, async () => {
    const id = await seedToken();
    for (let index = 0; index < MCP_TOKEN_CHANGE_MAX_ATTEMPTS / 3; index++) {
      await create({ name: "", expiry: "3m" });
      await regenerate(id);
      await revoke(MISSING_ID);
    }

    expect(await create()).toMatchObject({ status: 429, body: { error: "You've changed your tokens a lot recently. Try again in an hour." } });
    expect(await regenerate(id)).toMatchObject({ status: 429 });
    expect(await revoke(id)).toMatchObject({ status: 429 });

    // Per user: someone else is unaffected.
    signIn(otherUser);
    expect(await create()).toMatchObject({ status: 201 });
  });
});

describe("POST /api/account/mcp/tokens/[id]/regenerate", () => {
  it("swaps in a new secret, answering 200 { token, secret }, no-store; the old one stops working", async () => {
    const first = await create();
    const oldSecret: string = first.body.secret;

    const response = await regenerate(first.body.token.id, { expiry: "6m" });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.body).toMatchObject({
      token: { id: first.body.token.id, name: "VPS", regeneratedAt: expect.any(String), expiresAt: expect.any(String) },
      secret: expect.stringMatching(SECRET),
    });
    expect(response.body.secret).not.toBe(oldSecret);
    expect(await repositories.mcpTokens.check(hashMcpToken(oldSecret))).toEqual({ status: "unknown" });
  });

  it("answers 404 for another user's token and changes nothing", async () => {
    const id = await seedToken(otherUser.id);
    const before = structuredClone(repositories.mcpTokens.tokens);

    expect(await regenerate(id)).toMatchObject(TOKEN_NOT_FOUND);
    expect(repositories.mcpTokens.tokens).toEqual(before);
  });

  it("answers 404 for a revoked or unknown token", async () => {
    const id = await seedToken();
    await revoke(id);

    expect(await regenerate(id)).toMatchObject(TOKEN_NOT_FOUND);
    expect(await regenerate(MISSING_ID)).toMatchObject(TOKEN_NOT_FOUND);
  });

  it("answers 403 for a kid", async () => {
    setUser({ ...roles["a kid with the permission on and a real email"], enabled: true });
    expect(await regenerate(MISSING_ID)).toMatchObject({ status: 403, body: { error: KID_TOKENS } });
  });

  it("answers 400 for an id that isn't a UUID, and 422 for a bad expiry", async () => {
    expect(await regenerate("not-a-uuid")).toMatchObject({ status: 400 });
    expect(await regenerate(await seedToken(), { expiry: "forever" })).toMatchObject({ status: 422 });
  });
});

describe("DELETE /api/account/mcp/tokens/[id]", () => {
  it("revokes the caller's token: 204, gone from the list, refused next time", async () => {
    setUser({ enabled: true });
    const created = await create();

    expect(await revoke(created.body.token.id)).toMatchObject({ status: 204, body: null });
    expect((await settings()).body.tokens).toEqual([]);
    expect(await repositories.mcpTokens.check(hashMcpToken(created.body.secret))).toEqual({ status: "revoked" });
  });

  it("answers 404 when it is already revoked", async () => {
    const id = await seedToken();
    await revoke(id);
    expect(await revoke(id)).toMatchObject(TOKEN_NOT_FOUND);
  });

  it("answers 404 for another user's token and leaves it live", async () => {
    const id = await seedToken(otherUser.id);

    expect(await revoke(id)).toMatchObject(TOKEN_NOT_FOUND);
    expect(repositories.mcpTokens.tokens[0].revokedAt).toBeNull();
  });

  it("answers 400 for an id that isn't a UUID", async () => {
    expect(await revoke("1;drop")).toMatchObject({ status: 400 });
  });
});

describe("/api/account/mcp/apps", () => {
  it("lists only the caller's connected apps", async () => {
    consent.addGrant(testUser.id, { clientId: "client-a" });
    consent.addGrant(otherUser.id, { clientId: "client-b" });

    const response = await callRoute(GET_APPS, { url: "/api/account/mcp/apps" });

    expect(response).toMatchObject({ status: 200, body: { apps: [{ clientId: "client-a" }] } });
    expect(response.body.apps).toHaveLength(1);
  });

  it("disconnects one registration by its client id, leaving others with the same name", async () => {
    consent.addGrant(testUser.id, { clientId: "client-old" });
    consent.addGrant(testUser.id, { clientId: "client-new" });

    expect(await disconnect("client-old")).toMatchObject({ status: 204, body: null });
    expect(consent.grants.map((grant) => grant.clientId)).toEqual(["client-new"]);
  });

  it("works for a blocked kid, so they can still clear their apps", async () => {
    setUser(roles["a kid with the permission off"]);
    consent.addGrant(testUser.id, { clientId: "client-a" });

    expect(await disconnect("client-a")).toMatchObject({ status: 204 });
  });

  it("answers 404 for another user's app id and disconnects nothing", async () => {
    consent.addGrant(otherUser.id, { clientId: "client-theirs" });

    expect(await disconnect("client-theirs")).toMatchObject(APP_NOT_FOUND);
    expect(consent.grants).toHaveLength(1);
  });

  it("answers 404 for a client id that isn't URL-safe, without asking the provider", async () => {
    consent.fail("listConnectedApps", new Error("should not be called"));
    expect(await disconnect("..%2Fadmin")).toMatchObject(APP_NOT_FOUND);
    expect(await disconnect("a/b")).toMatchObject(APP_NOT_FOUND);
  });

  it("answers 500 with a generic message when the provider fails", async () => {
    consent.addGrant(testUser.id, { clientId: "client-a" });
    consent.fail("disconnect", new Error("provider said something secret"));

    expect(await disconnect("client-a")).toMatchObject({ status: 500, body: { error: "Unable to disconnect the app. Please try again." } });
  });
});
