import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/lib/database.types";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), headers: vi.fn(), createServerClient: vi.fn(), createSupabaseClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: mocks.headers }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createSupabaseClient }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseConfig: () => ({ url: "http://supabase.test", publishableKey: "publishable" }) }));

import { createAppTokenClient, createClient, getBearerToken, getScopedAppToken, runWithSupabaseClient } from "@/lib/supabase/server";

const cookieClient = { kind: "cookie" };
const tokenClient = { kind: "token" };
const scoped = { kind: "scoped" } as unknown as SupabaseClient<Database>;

function withAuthorization(value: string | null) {
  mocks.headers.mockResolvedValue(new Headers(value === null ? {} : { authorization: value }));
}

describe("createClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withAuthorization(null);
    mocks.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });
    mocks.createServerClient.mockReturnValue(cookieClient);
    mocks.createSupabaseClient.mockReturnValue(tokenClient);
  });

  it("returns the cookie client outside a scope", async () => {
    expect(await createClient()).toBe(cookieClient);
    expect(mocks.cookies).toHaveBeenCalledOnce();
    expect(mocks.createServerClient).toHaveBeenCalledWith("http://supabase.test", "publishable", expect.any(Object));
    expect(mocks.createSupabaseClient).not.toHaveBeenCalled();
  });

  it("returns the scoped client inside runWithSupabaseClient, across awaits", async () => {
    const clients = await runWithSupabaseClient(scoped, async () => {
      const first = await createClient();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return [first, await createClient()];
    });
    expect(clients).toEqual([scoped, scoped]);
    expect(clients[0]).toBe(scoped);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("falls back to the cookie client after the scope ends", async () => {
    await runWithSupabaseClient(scoped, () => createClient());
    expect(await createClient()).toBe(cookieClient);
  });

  it("returns a non-persistent client carrying the bearer token, without reading cookies", async () => {
    withAuthorization("Bearer token-1");

    expect(await createClient()).toBe(tokenClient);
    expect(mocks.createSupabaseClient).toHaveBeenCalledExactlyOnceWith("http://supabase.test", "publishable", {
      global: { headers: { Authorization: "Bearer token-1" } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("builds a token client, never the cookie client, for a bearer header without a token", async () => {
    withAuthorization("Bearer");

    expect(await createClient()).toBe(tokenClient);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("keeps the scoped client ahead of a bearer token, without reading the headers", async () => {
    withAuthorization("Bearer token-1");

    expect(await runWithSupabaseClient(scoped, () => createClient())).toBe(scoped);
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.createSupabaseClient).not.toHaveBeenCalled();
  });

  it("uses the cookie client for a non-bearer Authorization header", async () => {
    withAuthorization("Basic dXNlcjpwYXNz");

    expect(await createClient()).toBe(cookieClient);
    expect(mocks.createSupabaseClient).not.toHaveBeenCalled();
  });
});

describe("getBearerToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["no Authorization header", null, null],
    ["a Basic header", "Basic dXNlcjpwYXNz", null],
    ["a scheme that only starts with Bearer", "Bearerish token-1", null],
    ["a bearer token", "Bearer token-1", "token-1"],
    ["a lowercase scheme and extra spaces", "bearer   token-1  ", "token-1"],
    ["a bearer without a token", "Bearer", ""],
    ["a bearer with only spaces", "Bearer   ", ""],
    ["a bearer with two tokens", "Bearer token-1 token-2", ""],
  ])("reads %s", async (_, header, expected) => {
    withAuthorization(header);

    expect(await getBearerToken()).toBe(expected);
  });

  it("is null inside runWithSupabaseClient, without reading the headers", async () => {
    withAuthorization("Bearer token-1");

    expect(await runWithSupabaseClient(scoped, () => getBearerToken())).toBeNull();
    expect(mocks.headers).not.toHaveBeenCalled();
  });
});

describe("app-token clients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseClient.mockImplementation(() => ({ kind: "app-token" }));
  });

  it("builds a non-persistent client carrying the app token", () => {
    createAppTokenClient("app-token");

    expect(mocks.createSupabaseClient).toHaveBeenCalledExactlyOnceWith("http://supabase.test", "publishable", {
      global: { headers: { Authorization: "Bearer app-token" } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it("gives the app token only inside a run scoped to that client", () => {
    const client = createAppTokenClient("app-token");

    expect(getScopedAppToken()).toBeNull();
    expect(runWithSupabaseClient(client, () => getScopedAppToken())).toBe("app-token");
    expect(runWithSupabaseClient(scoped, () => getScopedAppToken())).toBeNull();
  });

  it("never marks the REST path's bearer client as an app-token client", async () => {
    withAuthorization("Bearer app-token");
    const restClient = await createClient();

    expect(runWithSupabaseClient(restClient, () => getScopedAppToken())).toBeNull();
  });
});
