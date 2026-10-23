import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAppTokenClient: vi.fn(),
  createClient: vi.fn(),
  createSupabaseClient: vi.fn(),
  getBearerToken: vi.fn(),
  getScopedAppToken: vi.fn(),
  runWithSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createAppTokenClient: mocks.createAppTokenClient,
  createClient: mocks.createClient,
  getBearerToken: mocks.getBearerToken,
  getScopedAppToken: mocks.getScopedAppToken,
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
    mocks.getScopedAppToken.mockReturnValue(null);
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

    it("refuses an OAuth app's token sent as a bearer token, so the REST API answers 401", async () => {
      mocks.getBearerToken.mockResolvedValue("app-token");
      mockAuth({ getClaims: { data: { claims: { sub: "user-2", email: "b@example.test", client_id: "client-1" } }, error: null } });

      expect(await supabaseAuth.getCurrentUser()).toBeNull();
    });

    it("returns the app token's user inside an app-token run, without reading the request's bearer token", async () => {
      mocks.getScopedAppToken.mockReturnValue("app-token");
      const auth = mockAuth({ getClaims: { data: { claims: { sub: "user-2", email: "b@example.test", client_id: "client-1" } }, error: null } });

      expect(await supabaseAuth.getCurrentUser()).toEqual({ id: "user-2", email: "b@example.test" });
      expect(auth.getClaims).toHaveBeenCalledExactlyOnceWith("app-token");
      expect(mocks.getBearerToken).not.toHaveBeenCalled();
    });

    it("returns null inside an app-token run once the token is refused", async () => {
      mocks.getScopedAppToken.mockReturnValue("app-token");
      mockAuth({ getClaims: { data: null, error: { message: "Auth session missing!" } } });

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

  it("explains the email rate limit instead of passing the provider's terse message on", async () => {
    mockAuth({
      signUp: { data: { session: null }, error: { message: "email rate limit exceeded", code: "over_email_send_rate_limit", status: 429 } },
    });

    expect(await supabaseAuth.signUp("a@example.test", "secret-1", "http://x.test")).toEqual({
      ok: false,
      kind: "rate_limited",
      reason: "We've sent too many emails in a short time. Please wait up to an hour, then try again.",
    });
  });

  it("treats any other 429 as a rate limit", async () => {
    mockAuth({ updateUser: { data: { user: null }, error: { message: "slow down", code: "something_new", status: 429 } } });

    expect(await supabaseAuth.updateEmail("a@example.test", "http://x.test")).toEqual({
      ok: false,
      kind: "rate_limited",
      reason: "Too many attempts in a short time. Please wait a few minutes, then try again.",
    });
  });

  it("marks a sign-in to an unconfirmed account", async () => {
    mockAuth({ signInWithPassword: { data: {}, error: { message: "Email not confirmed", code: "email_not_confirmed", status: 400 } } });

    expect(await supabaseAuth.signInWithPassword("a@example.test", "secret-1")).toEqual({
      ok: false,
      kind: "email_not_confirmed",
      reason: "Confirm your email first: open the link we sent you, then sign in.",
    });
  });

  it("signs out", async () => {
    mockAuth({ signOut: { error: null } });
    expect(await supabaseAuth.signOut()).toEqual({ ok: true });

    mockAuth({ signOut: { error: PROVIDER_ERROR } });
    expect(await supabaseAuth.signOut()).toEqual({ ok: false, reason: "provider says no" });
  });

  it("updates the signed-in user's password", async () => {
    const auth = mockAuth({ updateUser: { data: { user: { id: "user-1" } }, error: null } });

    expect(await supabaseAuth.updatePassword("new-secret-1")).toEqual({ ok: true });
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: "new-secret-1" });
  });

  it("passes a password update error message through", async () => {
    mockAuth({ updateUser: { data: { user: null }, error: PROVIDER_ERROR } });

    expect(await supabaseAuth.updatePassword("new-secret-1")).toEqual({ ok: false, reason: "provider says no" });
  });

  it("asks to change the signed-in user's email, with the confirmation link", async () => {
    const auth = mockAuth({ updateUser: { data: { user: { id: "user-1" } }, error: null } });

    expect(await supabaseAuth.updateEmail("a@example.test", "http://localhost/auth/confirm?next=/settings")).toEqual({ ok: true });
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith(
      { email: "a@example.test" },
      { emailRedirectTo: "http://localhost/auth/confirm?next=/settings" },
    );
  });

  it("passes an email change error message through", async () => {
    mockAuth({ updateUser: { data: { user: null }, error: PROVIDER_ERROR } });

    expect(await supabaseAuth.updateEmail("a@example.test", "http://x.test")).toEqual({ ok: false, reason: "provider says no" });
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

  describe("verifyAppToken", () => {
    const APP_CLAIMS = { sub: "user-2", email: "b@example.test", client_id: "client-1", session_id: "session-1" };

    function mockTokenClient({
      claims = { data: { claims: APP_CLAIMS }, error: null } as unknown,
      user = { data: { user: { id: "user-2", email: "b@example.test" } }, error: null } as unknown,
    } = {}) {
      const client = { auth: { getClaims: vi.fn().mockResolvedValue(claims), getUser: vi.fn().mockResolvedValue(user) } };
      mocks.createAppTokenClient.mockReturnValue(client);
      return client;
    }

    it("checks the claims, then that the session is live, on a client built from the token", async () => {
      const client = mockTokenClient();

      expect(await supabaseAuth.verifyAppToken("app-token")).toEqual({ userId: "user-2", email: "b@example.test", clientId: "client-1" });
      expect(mocks.createAppTokenClient).toHaveBeenCalledExactlyOnceWith("app-token");
      expect(client.auth.getClaims).toHaveBeenCalledExactlyOnceWith("app-token");
      expect(client.auth.getUser).toHaveBeenCalledExactlyOnceWith("app-token");
      expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it("refuses a web session's JWT, which has no client_id, without asking for the user", async () => {
      const client = mockTokenClient({ claims: { data: { claims: { sub: "user-2", email: "b@example.test" } }, error: null } });

      expect(await supabaseAuth.verifyAppToken("web-token")).toBeNull();
      expect(client.auth.getUser).not.toHaveBeenCalled();
    });

    it.each([
      ["an invalid or expired token", { data: null, error: { message: "JWT has expired" } }],
      ["no subject", { data: { claims: { client_id: "client-1" } }, error: null }],
      ["an empty client_id", { data: { claims: { ...APP_CLAIMS, client_id: "" } }, error: null }],
    ])("refuses %s", async (_, claims) => {
      mockTokenClient({ claims });

      expect(await supabaseAuth.verifyAppToken("app-token")).toBeNull();
    });

    it("refuses a token whose session has ended (the app was disconnected)", async () => {
      mockTokenClient({ user: { data: { user: null }, error: { message: "Auth session missing!", status: 403 } } });

      expect(await supabaseAuth.verifyAppToken("app-token")).toBeNull();
    });

    it("refuses a token whose user isn't its subject", async () => {
      mockTokenClient({ user: { data: { user: { id: "user-3", email: "c@example.test" } }, error: null } });

      expect(await supabaseAuth.verifyAppToken("app-token")).toBeNull();
    });

    it("uses an empty email when the user has none", async () => {
      mockTokenClient({ user: { data: { user: { id: "user-2" } }, error: null } });

      expect(await supabaseAuth.verifyAppToken("app-token")).toMatchObject({ email: "" });
    });

    it("returns null when the provider throws", async () => {
      const client = mockTokenClient();
      client.auth.getClaims.mockRejectedValue(new Error("network down"));

      expect(await supabaseAuth.verifyAppToken("app-token")).toBeNull();
    });
  });

  describe("sessionForAppToken", () => {
    const jwt = (claims: object) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
    const TOKEN = jwt({ sub: "user-2", email: "b@example.test", client_id: "client-1" });

    function mockTokenClient(user: unknown = { data: { user: { id: "user-2", email: "b@example.test" } }, error: null }) {
      const client = {
        auth: {
          getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "user-2", client_id: "client-1" } }, error: null }),
          getUser: vi.fn().mockResolvedValue(user),
        },
      };
      mocks.createAppTokenClient.mockReturnValue(client);
      return client;
    }

    it("is the token's user", () => {
      mockTokenClient();

      expect(supabaseAuth.sessionForAppToken(TOKEN)).toMatchObject({ userId: "user-2", email: "b@example.test" });
    });

    it("runs callbacks with a client built from the token in scope", () => {
      const client = mockTokenClient();
      mocks.runWithSupabaseClient.mockImplementation((_client: unknown, fn: () => unknown) => fn());

      expect(supabaseAuth.sessionForAppToken(TOKEN).run(() => "result")).toBe("result");
      expect(mocks.createAppTokenClient).toHaveBeenCalledWith(TOKEN);
      expect(mocks.runWithSupabaseClient).toHaveBeenCalledWith(client, expect.any(Function));
    });

    it("is active while the token's session is live", async () => {
      mockTokenClient();

      expect(await supabaseAuth.sessionForAppToken(TOKEN).isActive()).toBe(true);
    });

    it("is not active once the session has ended", async () => {
      mockTokenClient({ data: { user: null }, error: { message: "Auth session missing!" } });

      expect(await supabaseAuth.sessionForAppToken(TOKEN).isActive()).toBe(false);
    });

    it("has no user for a token that isn't a JWT", () => {
      mockTokenClient();

      expect(supabaseAuth.sessionForAppToken("not-a-jwt")).toMatchObject({ userId: "", email: "" });
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
