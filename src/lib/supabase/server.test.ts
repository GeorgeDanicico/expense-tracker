import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/lib/database.types";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), createServerClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseConfig: () => ({ url: "http://supabase.test", publishableKey: "publishable" }) }));

import { createClient, runWithSupabaseClient } from "@/lib/supabase/server";

const cookieClient = { kind: "cookie" };
const scoped = { kind: "scoped" } as unknown as SupabaseClient<Database>;

describe("createClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });
    mocks.createServerClient.mockReturnValue(cookieClient);
  });

  it("returns the cookie client outside a scope", async () => {
    expect(await createClient()).toBe(cookieClient);
    expect(mocks.cookies).toHaveBeenCalledOnce();
    expect(mocks.createServerClient).toHaveBeenCalledWith("http://supabase.test", "publishable", expect.any(Object));
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
});
