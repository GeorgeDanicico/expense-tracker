import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createSupabaseClient: vi.fn(),
  getBearerToken: vi.fn(),
  runWithSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  getBearerToken: mocks.getBearerToken,
  runWithSupabaseClient: mocks.runWithSupabaseClient,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createSupabaseClient }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseConfig: () => ({ url: "http://supabase.test", publishableKey: "pk" }),
}));

import { supabaseAuth } from "@/lib/supabase/auth";

const PROVIDER_ERROR = { message: "provider says no" };

function mockAuth(methods: Record<string, unknown>) {
  const auth = Object.fromEntries(Object.entries(methods).map(([name, value]) => [name, vi.fn().mockResolvedValue(value)]));
  mocks.createClient.mockResolvedValue({ auth });
  return auth;
}

describe("supabaseAuth", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getBearerToken.mockResolvedValue(null);
  });

  describe("getCurrentUser", () => {
    it("returns the user from the session claims", async () => {
      const auth = mockAuth({ getClaims: { data: { claims: { sub: "user-1", email: "a@example.test" } }, error: null } });

      expect(await supabaseAuth.getCurrentUser()).toEqual({ id: "user-1", email: "a@example.test" });
      expect(auth.getClaims).toHaveBeenCalledWith();
    });

    it("validates a bearer token with the request's client", async () => {
      mocks.getBearerToken.mockResolvedValue("token-1");
      const auth = mockAuth({ getClaims: { data: { claims: { sub: "user-2", email: "b@example.test" } }, error: null } });

      expect(await supabaseAuth.getCurrentUser()).toEqual({ id: "user-2", email: "b@example.test" });
      expect(auth.getClaims).toHaveBeenCalledExactlyOnceWith("token-1");
    });

    it("returns null for an expired or invalid bearer token", async () => {
      mocks.getBearerToken.mockResolvedValue("expired-token");
      mockAuth({ getClaims: { data: null, error: { message: "JWT has expired" } } });

      expect(await supabaseAuth.getCurrentUser()).toBeNull();
    });

    it("returns null for a bearer header without a token, without asking the provider", async () => {
      mocks.getBearerToken.mockResolvedValue("");

      expect(await supabaseAuth.getCurrentUser()).toBeNull();
      expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it("uses an empty email when the claims have none", async () => {
      mockAuth({ getClaims: { data: { claims: { sub: "user-1" } }, error: null } });

      expect(await supabaseAuth.getCurrentUser()).toEqual({ id: "user-1", email: "" });
    });

    it.each([
      ["an error", { data: null, error: PROVIDER_ERROR }],
      ["no claims", { data: null, error: null }],
      ["no subject", { data: { claims: {} }, error: null }],
    ])("returns null on %s", async (_, response) => {
      mockAuth({ getClaims: response });

      expect(await supabaseAuth.getCurrentUser()).toBeNull();
    });
  });

  it("signs in with a password", async () => {
    const auth = mockAuth({ signInWithPassword: { data: {}, error: null } });

    expect(await supabaseAuth.signInWithPassword("a@example.test", "secret-1")).toEqual({ ok: true });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@example.test", password: "secret-1" });
  });

  it("reports a failed password sign-in", async () => {
    mockAuth({ signInWithPassword: { data: {}, error: PROVIDER_ERROR } });

    expect(await supabaseAuth.signInWithPassword("a@example.test", "secret-1")).toEqual({ ok: false, reason: "provider says no" });
  });

  it("signs up with the confirmation URL and reports whether a session started", async () => {
    const auth = mockAuth({ signUp: { data: { session: null }, error: null } });

    expect(await supabaseAuth.signUp("a@example.test", "secret-1", "http://localhost/auth/confirm")).toEqual({ ok: true, signedIn: false });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "a@example.test",
      password: "secret-1",
      options: { emailRedirectTo: "http://localhost/auth/confirm" },
    });

    mockAuth({ signUp: { data: { session: { access_token: "token" } }, error: null } });
    expect(await supabaseAuth.signUp("a@example.test", "secret-1", "http://localhost/auth/confirm")).toEqual({ ok: true, signedIn: true });
  });

  it("passes the sign-up error message through", async () => {
    mockAuth({ signUp: { data: { session: null }, error: PROVIDER_ERROR } });

    expect(await supabaseAuth.signUp("a@example.test", "secret-1", "http://x.test")).toEqual({ ok: false, reason: "provider says no" });
  });

  it("signs out", async () => {
    mockAuth({ signOut: { error: null } });
    expect(await supabaseAuth.signOut()).toEqual({ ok: true });

    mockAuth({ signOut: { error: PROVIDER_ERROR } });
    expect(await supabaseAuth.signOut()).toEqual({ ok: false, reason: "provider says no" });
  });

  it("returns the OAuth URL for the provider", async () => {
    const auth = mockAuth({ signInWithOAuth: { data: { url: "https://accounts.google.test/o" }, error: null } });

    expect(await supabaseAuth.oauthSignInUrl("google", "http://localhost/auth/confirm")).toEqual({ ok: true, url: "https://accounts.google.test/o" });
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "http://localhost/auth/confirm" } });
  });

  it.each([
    ["an error", { data: { url: null }, error: PROVIDER_ERROR }],
    ["no URL", { data: { url: null }, error: null }],
  ])("fails the OAuth URL on %s", async (_, response) => {
    mockAuth({ signInWithOAuth: response });

    expect((await supabaseAuth.oauthSignInUrl("google", "http://localhost/auth/confirm")).ok).toBe(false);
  });

  describe("completeEmailLink", () => {
    it("exchanges a code for a session", async () => {
      const auth = mockAuth({ exchangeCodeForSession: { data: {}, error: null } });

      expect(await supabaseAuth.completeEmailLink({ code: "code-1" })).toEqual({ ok: true });
      expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("code-1");
    });

    it("verifies a token hash", async () => {
      const auth = mockAuth({ verifyOtp: { data: {}, error: null } });

      expect(await supabaseAuth.completeEmailLink({ tokenHash: "hash-1", type: "recovery" })).toEqual({ ok: true });
      expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "hash-1", type: "recovery" });
    });

    it("verifies an email with a 6-digit code", async () => {
      const auth = mockAuth({ verifyOtp: { data: {}, error: null } });

      expect(await supabaseAuth.completeEmailLink({ email: "a@example.test", token: "123456", type: "email" })).toEqual({ ok: true });
      expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "a@example.test", token: "123456", type: "email" });
    });

    it("reports a failed verification", async () => {
      mockAuth({ verifyOtp: { data: {}, error: PROVIDER_ERROR } });

      expect(await supabaseAuth.completeEmailLink({ tokenHash: "hash-1", type: "signup" })).toEqual({ ok: false, reason: "provider says no" });
    });
  });

  describe("startSession", () => {
    const USER = { id: "user-1", email: "a@example.test" };

    function mockSessionClient({
      signIn = { data: { user: USER }, error: null } as unknown,
      session = { data: { session: { access_token: "token" } }, error: null } as unknown,
    } = {}) {
      const client = {
        auth: { signInWithPassword: vi.fn().mockResolvedValue(signIn), getSession: vi.fn().mockResolvedValue(session) },
      };
      mocks.createSupabaseClient.mockReturnValue(client);
      return client;
    }

    it("signs in with its own non-persistent, auto-refreshing client", async () => {
      const client = mockSessionClient();

      expect(await supabaseAuth.startSession("a@example.test", "secret-1")).toMatchObject({ userId: "user-1", email: "a@example.test" });
      expect(mocks.createSupabaseClient).toHaveBeenCalledExactlyOnceWith("http://supabase.test", "pk", {
        auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
      });
      expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@example.test", password: "secret-1" });
      expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it("uses the given email when the user has none", async () => {
      mockSessionClient({ signIn: { data: { user: { id: "user-1" } }, error: null } });

      expect(await supabaseAuth.startSession("a@example.test", "secret-1")).toMatchObject({ email: "a@example.test" });
    });

    it.each([
      ["an error", { data: { user: null }, error: PROVIDER_ERROR }],
      ["no user", { data: { user: null }, error: null }],
    ])("returns null on %s", async (_, signIn) => {
      mockSessionClient({ signIn });

      expect(await supabaseAuth.startSession("a@example.test", "secret-1")).toBeNull();
    });

    it("returns null when the provider throws", async () => {
      mocks.createSupabaseClient.mockImplementation(() => {
        throw new Error("network down");
      });

      expect(await supabaseAuth.startSession("a@example.test", "secret-1")).toBeNull();
    });

    it("runs callbacks with the session's client in scope", async () => {
      const client = mockSessionClient();
      mocks.runWithSupabaseClient.mockImplementation((_client: unknown, fn: () => unknown) => fn());
      const session = await supabaseAuth.startSession("a@example.test", "secret-1");

      expect(session?.run(() => "result")).toBe("result");
      expect(mocks.runWithSupabaseClient).toHaveBeenCalledWith(client, expect.any(Function));
    });

    it("is active while the client still has a session", async () => {
      mockSessionClient();
      const session = await supabaseAuth.startSession("a@example.test", "secret-1");

      expect(await session?.isActive()).toBe(true);
    });

    it.each([
      ["no session", { data: { session: null }, error: null }],
      ["a refresh error", { data: { session: null }, error: { message: "Refresh failed" } }],
    ])("is not active with %s", async (_, response) => {
      mockSessionClient({ session: response });
      const session = await supabaseAuth.startSession("a@example.test", "secret-1");

      expect(await session?.isActive()).toBe(false);
    });

    it("is not active when the session check throws", async () => {
      const client = mockSessionClient();
      const session = await supabaseAuth.startSession("a@example.test", "secret-1");
      client.auth.getSession.mockRejectedValue(new Error("network down"));

      expect(await session?.isActive()).toBe(false);
    });
  });
});
