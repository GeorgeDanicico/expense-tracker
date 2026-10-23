import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeAuth, FakeAuthAdmin } from "@/test/fakes/auth";

let auth: FakeAuth;
let admin: FakeAuthAdmin;
vi.mock("@/lib/auth", () => ({ getAuth: () => auth, getAuthAdmin: () => admin }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import {
  getMcpSession,
  getMcpTokenSession,
  parseBasicCredentials,
  readMcpAuthorization,
  resetMcpAuthForTests,
} from "@/lib/mcp/auth";
import { generateMcpToken } from "@/lib/mcp/tokens";
import { resetFakeRepositories } from "@/test/fakes/repositories";

const credentials = { email: "user@example.com", password: "correct-horse" };

function request(authorization?: string) {
  return new Request("http://localhost/api/mcp", {
    headers: authorization ? { authorization } : {},
  });
}

function basic(value: string) {
  return `Basic ${Buffer.from(value).toString("base64")}`;
}

describe("parseBasicCredentials", () => {
  it("decodes valid Basic credentials, keeping colons in the password", () => {
    expect(parseBasicCredentials(request(basic("user@example.com:pass:word1")))).toEqual({
      email: "user@example.com", password: "pass:word1",
    });
  });

  it.each([
    ["a missing header", undefined],
    ["a non-Basic scheme", `Bearer ${Buffer.from("user@example.com:password1").toString("base64")}`],
    ["bad encoding", "Basic %%%"],
    ["no colon", basic("user@example.com")],
    ["an invalid email", basic("not-an-email:password1")],
    ["a short password", basic("user@example.com:short")],
  ])("rejects %s", (_, header) => {
    expect(parseBasicCredentials(request(header))).toBeNull();
  });
});

describe("readMcpAuthorization", () => {
  const personal = `sl_mcp_${"a".repeat(43)}`;

  it.each([
    ["a personal token", `Bearer ${personal}`, { kind: "personal", token: personal }],
    ["a malformed personal token", "Bearer sl_mcp_short", { kind: "personal", token: "sl_mcp_short" }],
    ["any other bearer token", "Bearer eyJ.abc.def", { kind: "app", token: "eyJ.abc.def" }],
    ["a lowercase scheme", `bearer ${personal}`, { kind: "personal", token: personal }],
    ["a Bearer with no token", "Bearer", { kind: "app", token: "" }],
    ["Basic credentials", basic("user@example.com:password1"), {
      kind: "basic", credentials: { email: "user@example.com", password: "password1" },
    }],
    ["bad Basic credentials", basic("no-colon"), { kind: "basic", credentials: null }],
    ["no header", undefined, { kind: "none" }],
    ["another scheme", "Digest abc", { kind: "none" }],
  ])("reads %s", (_, header, expected) => {
    expect(readMcpAuthorization(request(header))).toEqual(expected);
  });
});

describe("the session cache", () => {
  beforeEach(() => {
    resetMcpAuthForTests();
    auth = new FakeAuth();
    admin = new FakeAuthAdmin(auth);
  });

  it("keeps at most 20 sessions, shared by Basic and personal tokens, ending the oldest", async () => {
    const repositories = resetFakeRepositories();
    auth.addUser(credentials.email, credentials.password);
    expect(await getMcpSession(credentials, null)).toMatchObject({ status: "ok" });

    for (let index = 0; index < 20; index += 1) {
      const user = auth.addUser(`user${index}@example.test`, "password-1");
      repositories.mcpTokens.users.set(user.id, { email: user.email, enabled: true, kid: null });
      const { token, prefix, hash } = generateMcpToken();
      repositories.mcpTokens.tokens.push({
        id: `token-${index}`, userId: user.id, name: "VPS", prefix, hash, createdAt: "2026-10-01T00:00:00Z",
        regeneratedAt: null, lastUsedAt: null, expiresAt: null, revokedAt: null,
      });
      expect(await getMcpTokenSession(token, null)).toMatchObject({ status: "ok" });
    }
    await new Promise((resolve) => setTimeout(resolve));

    // The Basic session was the oldest of 21: it's ended, and the next Basic call signs in again.
    expect(auth.sessions[0].ended).toBe(true);
    expect(auth.sessions.slice(1).every((session) => !session.ended)).toBe(true);
    expect(await getMcpSession(credentials, null)).toMatchObject({ status: "ok" });
    expect(auth.sessions).toHaveLength(22);
    expect(auth.sessions[1].ended).toBe(true);
  });
});

describe("getMcpSession", () => {
  let user: { id: string; email: string };

  beforeEach(() => {
    resetMcpAuthForTests();
    auth = new FakeAuth();
    user = auth.addUser(credentials.email, credentials.password);
    vi.spyOn(auth, "startSession");
  });

  it("shares a single sign-in between concurrent first calls", async () => {
    const [first, second] = await Promise.all([
      getMcpSession(credentials, "1.1.1.1"),
      getMcpSession(credentials, "1.1.1.1"),
    ]);

    expect(first).toMatchObject({ status: "ok", session: { userId: user.id, email: user.email } });
    expect(second).toEqual(first);
    expect(auth.startSession).toHaveBeenCalledTimes(1);
  });

  it("starts the session with the Basic credentials", async () => {
    await getMcpSession(credentials, null);

    expect(auth.startSession).toHaveBeenCalledExactlyOnceWith(credentials.email, credentials.password);
  });

  it("reuses the cached session after checking it is still active", async () => {
    const first = await getMcpSession(credentials, null);
    const second = await getMcpSession(credentials, null);
    expect(second).toEqual(first);
    expect(auth.startSession).toHaveBeenCalledTimes(1);
    expect(auth.sessions[0].checks).toBe(1);
  });

  it("signs in exactly once more when the cached session cannot refresh", async () => {
    await getMcpSession(credentials, null);
    auth.sessions[0].active = false;

    expect(await getMcpSession(credentials, null)).toMatchObject({ status: "ok" });
    expect(auth.startSession).toHaveBeenCalledTimes(2);
  });

  it("returns unauthorized for bad credentials and does not cache the failure", async () => {
    const wrong = { ...credentials, password: "wrong-password" };
    expect(await getMcpSession(wrong, null)).toEqual({ status: "unauthorized" });
    expect(await getMcpSession(wrong, null)).toEqual({ status: "unauthorized" });
    expect(auth.startSession).toHaveBeenCalledTimes(2);
    expect(auth.sessions).toHaveLength(0);
  });

  it("returns unauthorized when the auth provider fails", async () => {
    auth.fail("startSession");

    expect(await getMcpSession(credentials, null)).toEqual({ status: "unauthorized" });
  });

  it("throttles repeated failures per credential without calling the auth provider", async () => {
    const wrong = { ...credentials, password: "wrong-password" };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await getMcpSession(wrong, `10.0.0.${attempt}`);
    }
    expect(await getMcpSession(wrong, "10.0.0.99")).toEqual({ status: "throttled" });
    expect(auth.startSession).toHaveBeenCalledTimes(5);
  });

  describe("after five failures from one IP", () => {
    beforeEach(async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await getMcpSession({ ...credentials, password: `wrong-password-${attempt}` }, "10.0.0.1");
      }
    });

    it("throttles that IP across different credentials without calling the auth provider", async () => {
      expect(await getMcpSession(credentials, "10.0.0.1")).toEqual({ status: "throttled" });
      expect(auth.startSession).toHaveBeenCalledTimes(5);
    });

    it("still lets another IP try", async () => {
      expect(await getMcpSession({ ...credentials, password: "wrong-password" }, "10.0.0.2")).toEqual({
        status: "unauthorized",
      });
    });
  });
});
