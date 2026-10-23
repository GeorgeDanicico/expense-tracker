import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeAuth, FakeAuthAdmin } from "@/test/fakes/auth";

let auth: FakeAuth;
let admin: FakeAuthAdmin;
vi.mock("@/lib/auth", () => ({ getAuth: () => auth, getAuthAdmin: () => admin }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { getMcpTokenSession, readMcpAuthorization, resetMcpAuthForTests } from "@/lib/mcp/auth";
import { generateMcpToken } from "@/lib/mcp/tokens";
import { type FakeRepositories, resetFakeRepositories } from "@/test/fakes/repositories";

function request(authorization?: string) {
  return new Request("http://localhost/api/mcp", {
    headers: authorization ? { authorization } : {},
  });
}

describe("readMcpAuthorization", () => {
  const personal = `sl_mcp_${"a".repeat(43)}`;

  it.each([
    ["a personal token", `Bearer ${personal}`, { kind: "personal", token: personal }],
    ["a malformed personal token", "Bearer sl_mcp_short", { kind: "personal", token: "sl_mcp_short" }],
    ["any other bearer token", "Bearer eyJ.abc.def", { kind: "app", token: "eyJ.abc.def" }],
    ["a lowercase scheme", `bearer ${personal}`, { kind: "personal", token: personal }],
    ["a Bearer with no token", "Bearer", { kind: "app", token: "" }],
    ["Basic credentials, which are no longer accepted", `Basic ${Buffer.from("user@example.com:password1").toString("base64")}`, { kind: "none" }],
    ["no header", undefined, { kind: "none" }],
    ["another scheme", "Digest abc", { kind: "none" }],
  ])("reads %s", (_, header, expected) => {
    expect(readMcpAuthorization(request(header))).toEqual(expected);
  });
});

describe("the session cache", () => {
  let repositories: FakeRepositories;

  /** A live personal token for a new user with the switch on. */
  function personalToken(index: number) {
    const user = auth.addUser(`user${index}@example.test`, "password-1");
    repositories.mcpTokens.users.set(user.id, { email: user.email, enabled: true, kid: null });
    const { token, prefix, hash } = generateMcpToken();
    repositories.mcpTokens.tokens.push({
      id: `token-${index}`, userId: user.id, name: "VPS", prefix, hash, createdAt: "2026-10-01T00:00:00Z",
      regeneratedAt: null, lastUsedAt: null, expiresAt: null, revokedAt: null,
    });
    return token;
  }

  beforeEach(() => {
    resetMcpAuthForTests();
    repositories = resetFakeRepositories();
    auth = new FakeAuth();
    admin = new FakeAuthAdmin(auth);
    vi.spyOn(admin, "startSessionForUser");
  });

  it("keeps at most 20 sessions, ending the oldest", async () => {
    const tokens = Array.from({ length: 21 }, (_, index) => personalToken(index));
    for (const token of tokens) expect(await getMcpTokenSession(token, null)).toMatchObject({ status: "ok" });
    await new Promise((resolve) => setTimeout(resolve));

    // The first token's session was the oldest of 21: it's ended, and its next call opens another.
    expect(auth.sessions[0].ended).toBe(true);
    expect(auth.sessions.slice(1).every((session) => !session.ended)).toBe(true);
    expect(await getMcpTokenSession(tokens[0], null)).toMatchObject({ status: "ok" });
    expect(auth.sessions).toHaveLength(22);
    expect(auth.sessions[1].ended).toBe(true);
  });

  it("reuses the cached session after checking it is still active", async () => {
    const token = personalToken(0);
    const first = await getMcpTokenSession(token, null);

    expect(await getMcpTokenSession(token, null)).toEqual(first);
    expect(admin.startSessionForUser).toHaveBeenCalledTimes(1);
    expect(auth.sessions[0].checks).toBe(1);
  });

  it("opens exactly one more session when the cached one cannot refresh", async () => {
    const token = personalToken(0);
    await getMcpTokenSession(token, null);
    auth.sessions[0].active = false;

    expect(await getMcpTokenSession(token, null)).toMatchObject({ status: "ok" });
    expect(admin.startSessionForUser).toHaveBeenCalledTimes(2);
  });
});
