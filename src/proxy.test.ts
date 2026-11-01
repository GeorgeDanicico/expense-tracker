import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock("@/lib/supabase/proxy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/proxy")>()),
  updateSession: mocks.updateSession,
}));

import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";

import { config, proxy } from "@/proxy";

// Next compiles the matcher with path-to-regexp; as a plain regular expression over the whole path
// it means the same thing for this pattern.
const matcher = new RegExp(`^${config.matcher[0]}$`);
const runsOn = (path: string) => matcher.test(path);

describe("the proxy's matcher", () => {
  it("refreshes the session on pages and the signed-in API", () => {
    for (const path of ["/", "/calendar", "/dashboard", "/api/calendar/events", "/api/calendar/events/abc", "/api/account"]) {
      expect(runsOn(path), path).toBe(true);
    }
  });

  it("leaves out the calendar feed, which has no session to refresh", () => {
    const token = `sl_cal_${"A".repeat(43)}`;

    expect(runsOn(`/api/calendar/feed/${token}.ics`)).toBe(false);
    expect(runsOn(`/api/calendar/feed/${token}`)).toBe(false);
  });

  it("still covers the feed-link routes, which need the session", () => {
    expect(runsOn("/api/calendar/feed-link")).toBe(true);
    expect(runsOn("/api/calendar/feed-link/")).toBe(true);
    expect(runsOn("/api/calendar/feedback")).toBe(true);
  });

  it("keeps leaving out the MCP endpoint and health", () => {
    expect(runsOn("/api/mcp")).toBe(false);
    expect(runsOn("/health")).toBe(false);
  });

  it("leaves out the CSP report endpoint, which never reads the session", () => {
    expect(runsOn("/api/csp-report")).toBe(false);
  });

  it("covers the offline page, so it carries the policy too", () => {
    expect(runsOn("/offline")).toBe(true);
  });
});

describe("the proxy's security headers", () => {
  /** The request headers Next will render with, as the proxy's response forwards them. */
  function forwardedRequestHeaders(response: Response) {
    const names = response.headers.get("x-middleware-override-headers")?.split(",") ?? [];
    return Object.fromEntries(names.map((name) => [name, response.headers.get(`x-middleware-request-${name}`)]));
  }

  beforeEach(() => {
    mocks.updateSession.mockReset();
    mocks.updateSession.mockImplementation(async (request: NextRequest, extra: Record<string, string>) => {
      const headers = new Headers(request.headers);
      for (const [key, value] of Object.entries(extra)) headers.set(key, value);
      return NextResponse.next({ request: { headers } });
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends a report-only policy with a fresh nonce, and the same nonce to Next and the layout", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const first = await proxy(new NextRequest("http://localhost/dashboard"));
    const second = await proxy(new NextRequest("http://localhost/dashboard"));

    const policy = first.headers.get("content-security-policy-report-only")!;
    expect(first.headers.get("content-security-policy")).toBeNull();
    const nonce = getScriptNonceFromHeader(policy)!;
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(getScriptNonceFromHeader(second.headers.get("content-security-policy-report-only")!)).not.toBe(nonce);
    expect(policy).not.toContain("unsafe-eval");

    const forwarded = forwardedRequestHeaders(first);
    expect(forwarded["x-nonce"]).toBe(nonce);
    expect(forwarded["content-security-policy-report-only"]).toBe(policy);
    expect(first.headers.get("reporting-endpoints")).toBe('csp-endpoint="/api/csp-report"');
  });

  it("allows eval in development only", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await proxy(new NextRequest("http://localhost/login"));
    expect(response.headers.get("content-security-policy-report-only")).toContain("'unsafe-eval'");
  });

  it("overwrites a nonce the client sent", async () => {
    const response = await proxy(new NextRequest("http://localhost/login", { headers: { "x-nonce": "chosen-by-attacker" } }));
    expect(forwardedRequestHeaders(response)["x-nonce"]).not.toBe("chosen-by-attacker");
  });

  it("sends HSTS only when SITE_URL is https", async () => {
    vi.stubEnv("SITE_URL", "https://ledger.tailnet.ts.net");
    expect((await proxy(new NextRequest("http://localhost/login"))).headers.get("strict-transport-security")).toBe("max-age=31536000");

    vi.stubEnv("SITE_URL", "http://localhost:3000");
    expect((await proxy(new NextRequest("http://localhost/login"))).headers.get("strict-transport-security")).toBeNull();

    vi.stubEnv("SITE_URL", "");
    expect((await proxy(new NextRequest("http://localhost/login"))).headers.get("strict-transport-security")).toBeNull();
  });

  it("refreshes the session on pages, with the nonce passed along", async () => {
    await proxy(new NextRequest("http://localhost/settings"));
    expect(mocks.updateSession).toHaveBeenCalledOnce();
    expect(mocks.updateSession.mock.calls[0][1]).toHaveProperty("x-nonce");
  });

  it("gives the offline page its headers without touching the session", async () => {
    const response = await proxy(new NextRequest("http://localhost/offline", { headers: { cookie: "sb-access-token=session" } }));
    expect(mocks.updateSession).not.toHaveBeenCalled();
    expect(response.headers.get("content-security-policy-report-only")).toContain("'nonce-");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
