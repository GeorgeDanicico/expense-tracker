import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: mocks.headers }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseConfig: () => ({ url: "http://supabase.test", publishableKey: "pk" }),
}));

import { authCookieOptions } from "@/lib/supabase/cookie-options";
import { updateSession } from "@/lib/supabase/proxy";
import { createClient } from "@/lib/supabase/server";

type WrittenCookie = { name: string; value: string; options: Record<string, unknown> };

afterEach(() => vi.unstubAllEnvs());

describe("authCookieOptions", () => {
  it("is httpOnly, lax and site-wide, and secure in production only", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(authCookieOptions()).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });

    vi.stubEnv("NODE_ENV", "development");
    expect(authCookieOptions()).toEqual({ httpOnly: true, secure: false, sameSite: "lax", path: "/" });
  });
});

// The real @supabase/ssr: starting Google sign-in stores the PKCE code verifier, a cookie the
// browser must carry back to /auth/confirm. No network is involved: the URL is only built.
describe("the cookies @supabase/ssr writes with these options", () => {
  async function startGoogleSignIn(setAll: (cookies: WrittenCookie[]) => void) {
    const client = createServerClient("http://supabase.test", "pk", {
      cookieOptions: authCookieOptions(),
      cookies: { getAll: () => [], setAll: (cookies) => setAll(cookies as WrittenCookie[]) },
    });
    await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: "http://localhost/auth/confirm", skipBrowserRedirect: true } });
  }

  it("marks the auth cookies httpOnly, secure in production, lax and site-wide", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const written: WrittenCookie[] = [];

    await startGoogleSignIn((cookies) => written.push(...cookies));

    expect(written.length).toBeGreaterThan(0);
    for (const cookie of written) {
      expect(cookie.name).toMatch(/^sb-/);
      expect(cookie.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    }
  });
});

describe("the server client and the proxy", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.headers.mockResolvedValue(new Headers());
  });

  it("writes the request's session cookies with the auth options", async () => {
    const set = vi.fn();
    mocks.cookies.mockResolvedValue({ getAll: () => [], set });

    const client = await createClient();
    await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: "http://localhost/auth/confirm", skipBrowserRedirect: true } });

    expect(set).toHaveBeenCalled();
    for (const [, , options] of set.mock.calls) {
      expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    }
  });

  it("lets the proxy refresh a request without a session, writing no cookie", async () => {
    const response = await updateSession(new NextRequest("http://localhost/dashboard"));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("refreshes an expired session in the proxy and writes the new cookies with the same options", async () => {
    const jwt = (claims: Record<string, unknown>) =>
      [{ alg: "HS256", typ: "JWT" }, claims].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".sig";
    const now = Math.floor(Date.now() / 1000);
    const user = { id: "10000000-0000-4000-8000-000000000001", aud: "authenticated", email: "a@example.test" };
    const fresh = {
      access_token: jwt({ sub: user.id, exp: now + 3600, iat: now, aud: "authenticated", role: "authenticated", session_id: "s1" }),
      refresh_token: "refresh-2",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      user,
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes("/auth/v1/token")) return Response.json(fresh);
      if (path.includes("/auth/v1/user")) return Response.json(user);
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const expired = {
      access_token: jwt({ sub: user.id, exp: now - 60, iat: now - 3660, aud: "authenticated", role: "authenticated", session_id: "s1" }),
      refresh_token: "refresh-1",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now - 60,
      user,
    };
    const value = `base64-${Buffer.from(JSON.stringify(expired)).toString("base64url")}`;

    try {
      const response = await updateSession(
        new NextRequest("http://localhost/dashboard", { headers: { cookie: `sb-supabase-auth-token=${value}` } }),
      );

      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("grant_type=refresh_token"))).toBe(true);
      const written = response.cookies.getAll().filter((cookie) => cookie.name.startsWith("sb-supabase-auth-token"));
      expect(written.length).toBeGreaterThan(0);
      for (const cookie of written) {
        expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
      }
      const header = response.headers.get("set-cookie") ?? "";
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/Secure/i);
      expect(header).toMatch(/SameSite=lax/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
