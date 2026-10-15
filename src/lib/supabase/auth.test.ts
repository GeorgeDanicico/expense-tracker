import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

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
  });

  describe("getCurrentUser", () => {
    it("returns the user from the session claims", async () => {
      mockAuth({ getClaims: { data: { claims: { sub: "user-1", email: "a@example.test" } }, error: null } });

      expect(await supabaseAuth.getCurrentUser()).toEqual({ id: "user-1", email: "a@example.test" });
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
});
