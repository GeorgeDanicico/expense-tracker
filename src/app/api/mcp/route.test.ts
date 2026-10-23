import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeAuth, FakeAuthAdmin } from "@/test/fakes/auth";

const ISSUER = "https://ref.supabase.test/auth/v1";
let auth: FakeAuth;
let admin: FakeAuthAdmin | null;
vi.mock("@/lib/auth", () => ({
  getAuth: () => auth,
  // Like the real one, it throws when SUPABASE_SECRET_KEY isn't set.
  getAuthAdmin: () => {
    if (!admin) throw new Error("SUPABASE_SECRET_KEY is not set.");
    return admin;
  },
  getOAuthIssuer: () => ISSUER,
}));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { DELETE, GET, POST } from "@/app/api/mcp/route";
import type { AuthenticatedUser } from "@/lib/auth";
import { resetMcpAuthForTests } from "@/lib/mcp/auth";
import { generateMcpToken } from "@/lib/mcp/tokens";
import { anExpense } from "@/test/builders";
import type { FakeMcpToken, FakeMcpUser } from "@/test/fakes/mcp-tokens";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

const PASSWORD = "correct-horse";
const BEARER_CHALLENGE = 'Bearer resource_metadata="https://expenses.example.com/.well-known/oauth-protected-resource/api/mcp"';
const MESSAGES = {
  mcp_off: "MCP is turned off for this account. Turn it on in Settings → AI assistants.",
  not_permitted: "A parent needs to turn on AI assistants for you.",
  email_required: "Add and confirm an email address in Settings to use AI assistants.",
  kid_token: "Kids connect AI assistants through the app's sign-in page, not with tokens.",
};

let repositories: FakeRepositories;
let userA: AuthenticatedUser;
let userB: AuthenticatedUser;

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "1.0.0" } },
};
const listExpenses = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: { name: "list_expenses", arguments: { month: "2026-10" } },
};

function rpc(body: unknown, headers: Record<string, string> = {}, method = "POST") {
  return new Request("http://localhost/api/mcp", {
    method,
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
      ...headers,
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const basic = (email: string, password = PASSWORD) => ({
  Authorization: `Basic ${Buffer.from(`${email}:${password}`).toString("base64")}`,
});

function sseMessages(text: string) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line.length > 6)
    .map((line) => JSON.parse(line.slice(6)));
}

/** Calls list_expenses and returns the ids of the expenses it lists. */
async function listedExpenseIds(headers: Record<string, string>) {
  const response = await POST(rpc(listExpenses, headers));
  expect(response.status).toBe(200);
  const [message] = sseMessages(await response.text());
  return (message.result.structuredContent.expenses as { id: string }[]).map((expense) => expense.id);
}

/** Sets a user's MCP state as the token repository sees it; the switch is on unless said otherwise. */
function setMcpUser(user: AuthenticatedUser, state: Partial<FakeMcpUser> = {}) {
  repositories.mcpTokens.users.set(user.id, { email: user.email, enabled: true, kid: null, ...state });
}

/** A live personal token for `user`, stored as the database would store it. */
function personalToken(user: AuthenticatedUser, overrides: Partial<FakeMcpToken> = {}) {
  const { token, prefix, hash } = generateMcpToken();
  const stored: FakeMcpToken = {
    id: randomUUID(),
    userId: user.id,
    name: "VPS",
    prefix,
    hash,
    createdAt: new Date().toISOString(),
    regeneratedAt: null,
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
  repositories.mcpTokens.tokens.push(stored);
  return { token, stored };
}

describe("/api/mcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SITE_URL", "https://expenses.example.com");
    resetMcpAuthForTests();
    repositories = resetFakeRepositories();
    auth = new FakeAuth();
    admin = new FakeAuthAdmin(auth);
    userA = auth.addUser("a@example.test", PASSWORD);
    userB = auth.addUser("b@example.test", PASSWORD);
    setMcpUser(userA);
    setMcpUser(userB);
    repositories.expenses.expenses.set(userA.id, [anExpense({ id: "expense-a", expenseDate: "2026-10-04" })]);
    repositories.expenses.expenses.set(userB.id, [anExpense({ id: "expense-b", expenseDate: "2026-10-05" })]);

    // The fake answers `access()` for its `caller`; make that whoever is signed in when it's called.
    const access = repositories.mcpTokens.access.bind(repositories.mcpTokens);
    vi.spyOn(repositories.mcpTokens, "access").mockImplementation(async () => {
      repositories.mcpTokens.caller = { userId: (await auth.getCurrentUser())?.id ?? "nobody" };
      return access();
    });
    vi.spyOn(repositories.mcpTokens, "check");
    vi.spyOn(admin, "startSessionForUser");
    vi.spyOn(auth, "verifyAppToken");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("with no credentials", () => {
    it("answers 401 with only the Bearer challenge", async () => {
      const response = await POST(rpc(initialize));

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(BEARER_CHALLENGE);
      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });

    it("points the challenge at the request's origin when SITE_URL isn't set", async () => {
      vi.stubEnv("SITE_URL", "");
      const response = await POST(rpc(initialize));

      expect(response.headers.get("www-authenticate")).toContain(
        'resource_metadata="http://localhost/.well-known/oauth-protected-resource/api/mcp"',
      );
    });
  });

  describe("with a personal token", () => {
    it("lists its owner's expenses, and only theirs", async () => {
      const a = personalToken(userA);
      const b = personalToken(userB);

      expect(await listedExpenseIds(bearer(a.token))).toEqual(["expense-a"]);
      expect(await listedExpenseIds(bearer(b.token))).toEqual(["expense-b"]);
    });

    it("reuses the token's session on the next call", async () => {
      const { token } = personalToken(userA);
      await listedExpenseIds(bearer(token));
      await listedExpenseIds(bearer(token));

      expect(admin?.startSessionForUser).toHaveBeenCalledExactlyOnceWith({ id: userA.id, email: userA.email });
      expect(repositories.mcpTokens.check).toHaveBeenCalledTimes(2);
    });

    it("opens a single session for two concurrent first calls", async () => {
      const { token } = personalToken(userA);
      const responses = await Promise.all([POST(rpc(listExpenses, bearer(token))), POST(rpc(listExpenses, bearer(token)))]);

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(admin?.startSessionForUser).toHaveBeenCalledTimes(1);
      expect(auth.sessions).toHaveLength(1);
    });

    it("refuses the next call once the token is revoked, and ends its cached session", async () => {
      const { token, stored } = personalToken(userA);
      await listedExpenseIds(bearer(token));
      stored.revokedAt = new Date().toISOString();

      const response = await POST(rpc(listExpenses, bearer(token)));

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(BEARER_CHALLENGE);
      expect(auth.sessions[0].ended).toBe(true);
    });

    it("ends the cached session when the switch is turned off, and opens a new one once it's back on", async () => {
      const { token } = personalToken(userA);
      await listedExpenseIds(bearer(token));
      setMcpUser(userA, { enabled: false });

      const response = await POST(rpc(listExpenses, bearer(token)));
      expect(response.status).toBe(403);
      expect(auth.sessions[0].ended).toBe(true);

      setMcpUser(userA);
      expect(await listedExpenseIds(bearer(token))).toEqual(["expense-a"]);
      expect(admin?.startSessionForUser).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["an unknown token", () => generateMcpToken().token],
      ["a revoked token", () => personalToken(userA, { revokedAt: "2026-10-01T00:00:00Z" }).token],
      ["an expired token", () => personalToken(userA, { expiresAt: "2026-01-01T00:00:00Z" }).token],
      ["a malformed token", () => "sl_mcp_too-short"],
    ])("answers 401 with the Bearer challenge for %s", async (_, token) => {
      const response = await POST(rpc(initialize, bearer(token())));

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(BEARER_CHALLENGE);
      expect(admin?.startSessionForUser).not.toHaveBeenCalled();
    });

    it("doesn't look a malformed token up", async () => {
      await POST(rpc(initialize, bearer("sl_mcp_too-short")));

      expect(repositories.mcpTokens.check).not.toHaveBeenCalled();
    });

    it("answers 403 when the owner's switch is off", async () => {
      setMcpUser(userA, { enabled: false });
      const response = await POST(rpc(initialize, bearer(personalToken(userA).token)));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: MESSAGES.mcp_off });
    });

    it("answers 403 for a kid's token", async () => {
      const { token } = personalToken(userA);
      setMcpUser(userA, { kid: { mcp: true } });
      const response = await POST(rpc(initialize, bearer(token)));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: MESSAGES.kid_token });
    });

    it("answers 429 to the sixth bad token from one IP, without looking it up", async () => {
      const ip = { "X-Forwarded-For": "203.0.113.7" };
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await POST(rpc(initialize, { ...bearer(generateMcpToken().token), ...ip }))).status).toBe(401);
      }

      const response = await POST(rpc(initialize, { ...bearer(personalToken(userA).token), ...ip }));

      expect(response.status).toBe(429);
      expect(repositories.mcpTokens.check).toHaveBeenCalledTimes(5);
      expect((await POST(rpc(initialize, { ...bearer(personalToken(userA).token), "X-Forwarded-For": "203.0.113.8" }))).status).toBe(200);
    });

    it("answers 429 to repeated bad tokens with one prefix, from any IP", async () => {
      const prefix = generateMcpToken().token.slice(0, 13);
      const guess = () => `${prefix}${generateMcpToken().token.slice(13)}`;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await POST(rpc(initialize, { ...bearer(guess()), "X-Forwarded-For": `10.0.0.${attempt}` }));
      }

      expect((await POST(rpc(initialize, { ...bearer(guess()), "X-Forwarded-For": "10.0.0.99" }))).status).toBe(429);
    });

    it("doesn't count access refusals toward the throttle", async () => {
      setMcpUser(userA, { enabled: false });
      const { token } = personalToken(userA);
      const ip = { "X-Forwarded-For": "203.0.113.7" };
      for (let attempt = 0; attempt < 6; attempt += 1) {
        expect((await POST(rpc(initialize, { ...bearer(token), ...ip }))).status).toBe(403);
      }
    });

    it("answers 503, without counting a failure, when no session can be opened", async () => {
      const { token } = personalToken(userA);
      admin?.fail("startSessionForUser");

      const response = await POST(rpc(initialize, bearer(token)));

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("30");
      // Not cached: the next call opens one.
      expect((await POST(rpc(initialize, bearer(token)))).status).toBe(200);
    });

    it("answers 503 when the secret key is missing", async () => {
      const { token } = personalToken(userA);
      admin = null;

      expect((await POST(rpc(initialize, bearer(token)))).status).toBe(503);
    });

    it("answers 503 when the token can't be checked", async () => {
      vi.mocked(repositories.mcpTokens.check).mockRejectedValueOnce(new Error("Unable to check the personal token."));

      expect((await POST(rpc(initialize, bearer(personalToken(userA).token)))).status).toBe(503);
    });
  });

  describe("with an OAuth app's token", () => {
    it("lists its user's expenses, and only theirs", async () => {
      const a = auth.issueAppToken(userA, "claude-code");
      const b = auth.issueAppToken(userB, "claude-code");

      expect(await listedExpenseIds(bearer(a))).toEqual(["expense-a"]);
      expect(await listedExpenseIds(bearer(b))).toEqual(["expense-b"]);
    });

    it("verifies the token and checks access as its user on every call", async () => {
      const token = auth.issueAppToken(userA, "claude-code");
      await listedExpenseIds(bearer(token));
      await listedExpenseIds(bearer(token));

      expect(auth.verifyAppToken).toHaveBeenCalledTimes(2);
      expect(repositories.mcpTokens.access).toHaveBeenCalledTimes(2);
      expect(repositories.mcpTokens.caller).toEqual({ userId: userA.id });
      expect(repositories.mcpTokens.check).not.toHaveBeenCalled();
    });

    it("refuses the next call once the app is disconnected", async () => {
      const token = auth.issueAppToken(userA, "claude-code");
      await listedExpenseIds(bearer(token));
      auth.revokeAppTokens(userA.id, "claude-code");

      const response = await POST(rpc(listExpenses, bearer(token)));

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(BEARER_CHALLENGE);
    });

    it.each([["an unknown token", "not-a-token"], ["an empty Bearer", ""]])("answers 401 for %s", async (_, token) => {
      const response = await POST(rpc(initialize, { Authorization: `Bearer ${token}`.trim() }));

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(BEARER_CHALLENGE);
    });

    it.each([
      ["the switch is off", { enabled: false }, MESSAGES.mcp_off],
      ["a kid lacks the permission", { kid: { mcp: false } }, MESSAGES.not_permitted],
      ["a kid has no real email", { kid: { mcp: true }, email: "kid@kids.ifam.invalid" }, MESSAGES.email_required],
    ])("answers 403 when %s", async (_, state, message) => {
      setMcpUser(userA, state);
      const response = await POST(rpc(initialize, bearer(auth.issueAppToken(userA, "claude-code"))));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: message });
    });

    it("lets a kid with the permission and a real email in", async () => {
      setMcpUser(userA, { kid: { mcp: true } });

      expect(await listedExpenseIds(bearer(auth.issueAppToken(userA, "claude-code")))).toEqual(["expense-a"]);
    });
  });

  describe("with Basic credentials", () => {
    it("answers 401 with only the Bearer challenge, even for the right password", async () => {
      const response = await POST(rpc(initialize, basic(userA.email)));

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(BEARER_CHALLENGE);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
      expect(auth.sessions).toHaveLength(0);
    });
  });

  describe("transport", () => {
    const signedIn = () => bearer(personalToken(userA).token);

    it("returns 403 for a foreign Origin before checking credentials", async () => {
      const response = await POST(rpc(initialize, { ...signedIn(), Origin: "https://evil.example" }));

      expect(response.status).toBe(403);
      expect(auth.sessions).toHaveLength(0);
    });

    it("allows the configured site Origin", async () => {
      expect((await POST(rpc(initialize, { ...signedIn(), Origin: "https://expenses.example.com" }))).status).toBe(200);
    });

    it("allows only localhost origins when SITE_URL is not configured", async () => {
      vi.stubEnv("SITE_URL", "");
      expect((await POST(rpc(initialize, { ...signedIn(), Origin: "http://localhost:3000" }))).status).toBe(200);
      expect((await POST(rpc(initialize, { ...signedIn(), Origin: "https://expenses.example.com" }))).status).toBe(403);
    });

    it("answers initialize over the streaming transport with private cache headers", async () => {
      const response = await POST(rpc(initialize, signedIn()));

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      const [message] = sseMessages(await response.text());
      expect(message).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } });
    });

    it("rejects GET and DELETE with 405 in stateless mode", async () => {
      for (const handler of [GET, DELETE]) {
        const response = await handler(rpc(undefined, signedIn(), handler === GET ? "GET" : "DELETE"));
        expect(response.status).toBe(405);
        expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      }
    });
  });
});
