import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => mocks);
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseConfig: () => ({ url: "http://supabase.test", publishableKey: "pk" }),
}));

import { getMcpSession, parseBasicCredentials, resetMcpAuthForTests } from "@/lib/mcp/auth";

const credentials = { email: "user@example.com", password: "correct-horse" };
const user = { id: "10000000-0000-4000-8000-000000000041", email: credentials.email };

function request(authorization?: string) {
  return new Request("http://localhost/api/mcp", {
    headers: authorization ? { authorization } : {},
  });
}

function basic(value: string) {
  return `Basic ${Buffer.from(value).toString("base64")}`;
}

function mockClients({ signInError = null as unknown, sessionValid = true } = {}) {
  const auth = {
    signInWithPassword: vi.fn().mockResolvedValue(
      signInError ? { data: { user: null }, error: signInError } : { data: { user }, error: null },
    ),
    getSession: vi.fn().mockResolvedValue(
      sessionValid
        ? { data: { session: { access_token: "token" } }, error: null }
        : { data: { session: null }, error: { message: "Refresh failed" } },
    ),
  };
  mocks.createClient.mockImplementation(() => ({ auth }));
  return auth;
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

describe("getMcpSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetMcpAuthForTests();
  });

  it("shares a single sign-in between concurrent first calls", async () => {
    const auth = mockClients();
    const [first, second] = await Promise.all([
      getMcpSession(credentials, "1.1.1.1"),
      getMcpSession(credentials, "1.1.1.1"),
    ]);
    expect(first).toMatchObject({ status: "ok", session: { userId: user.id, email: user.email } });
    expect(second).toEqual(first);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).toHaveBeenCalledWith("http://supabase.test", "pk", {
      auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    });
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached client after checking its session", async () => {
    const auth = mockClients();
    const first = await getMcpSession(credentials, null);
    const second = await getMcpSession(credentials, null);
    expect(second).toEqual(first);
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(auth.getSession).toHaveBeenCalledTimes(1);
  });

  it("signs in exactly once more when the cached session cannot refresh", async () => {
    const auth = mockClients({ sessionValid: false });
    await getMcpSession(credentials, null);
    expect(await getMcpSession(credentials, null)).toMatchObject({ status: "ok" });
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(2);
    expect(mocks.createClient).toHaveBeenCalledTimes(2);
  });

  it("returns unauthorized for bad credentials and does not cache the failure", async () => {
    const auth = mockClients({ signInError: { message: "Invalid login credentials" } });
    expect(await getMcpSession(credentials, null)).toEqual({ status: "unauthorized" });
    expect(await getMcpSession(credentials, null)).toEqual({ status: "unauthorized" });
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(2);
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it("throttles repeated failures per credential without calling Supabase", async () => {
    mockClients({ signInError: { message: "Invalid login credentials" } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await getMcpSession(credentials, `10.0.0.${attempt}`);
    }
    expect(await getMcpSession(credentials, "10.0.0.99")).toEqual({ status: "throttled" });
    expect(mocks.createClient).toHaveBeenCalledTimes(5);
  });

  it("throttles repeated failures per IP across different credentials", async () => {
    mockClients({ signInError: { message: "Invalid login credentials" } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await getMcpSession({ ...credentials, password: `wrong-password-${attempt}` }, "10.0.0.1");
    }
    expect(await getMcpSession(credentials, "10.0.0.1")).toEqual({ status: "throttled" });
    expect(mocks.createClient).toHaveBeenCalledTimes(5);
    expect(await getMcpSession(credentials, "10.0.0.2")).toEqual({ status: "unauthorized" });
  });
});
