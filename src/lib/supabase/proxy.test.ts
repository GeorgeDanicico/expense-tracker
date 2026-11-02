import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type CookieAdapter = {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options: object }[], headers: Record<string, string>): void;
};

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn(), getClaims: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseConfig: () => ({ url: "http://supabase.test", publishableKey: "publishable" }) }));

import { tracedFetch } from "@/lib/log/traced-fetch";
import { updateSession } from "@/lib/supabase/proxy";

/** The request headers the response forwards to the page, as Next reads them. */
function forwarded(response: Response) {
  const names = response.headers.get("x-middleware-override-headers")?.split(",") ?? [];
  return Object.fromEntries(names.map((name) => [name, response.headers.get(`x-middleware-request-${name}`)]));
}

describe("updateSession", () => {
  let adapter: CookieAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerClient.mockImplementation((_url: string, _key: string, options: { cookies: CookieAdapter }) => {
      adapter = options.cookies;
      return { auth: { getClaims: mocks.getClaims } };
    });
    mocks.getClaims.mockResolvedValue({ data: null });
  });

  it("builds its client with the traced fetch, like every other Supabase client", async () => {
    await updateSession(new NextRequest("http://localhost/dashboard"));
    expect(mocks.createServerClient.mock.calls[0][2].global).toEqual({ fetch: tracedFetch });
  });

  it("forwards the extra request headers (the CSP nonce) when nothing is refreshed", async () => {
    const response = await updateSession(new NextRequest("http://localhost/dashboard"), { "x-nonce": "abc" });
    expect(forwarded(response)["x-nonce"]).toBe("abc");
  });

  it("forwards them together with a refreshed session cookie", async () => {
    mocks.getClaims.mockImplementation(async () => {
      adapter.setAll([{ name: "sb-token", value: "fresh", options: { path: "/" } }], { "cache-control": "private, no-store" });
      return { data: null };
    });
    const request = new NextRequest("http://localhost/dashboard", { headers: { cookie: "sb-token=stale" } });
    const response = await updateSession(request, { "x-nonce": "abc" });

    expect(forwarded(response)["x-nonce"]).toBe("abc");
    expect(forwarded(response).cookie).toBe("sb-token=fresh");
    expect(response.cookies.get("sb-token")?.value).toBe("fresh");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
