import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorization: "", createSupabaseClient: vi.fn(), createServerClient: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ authorization: mocks.authorization }),
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createSupabaseClient }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET } from "@/app/api/expenses/route";
import { resetFakeRepositories } from "@/test/fakes/repositories";
import { callRoute } from "@/test/route";

describe("GET /api/expenses with a personal MCP token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeRepositories();
  });

  it("answers 401 without asking the auth provider: personal tokens are for /api/mcp only", async () => {
    mocks.authorization = `Bearer sl_mcp_${"a".repeat(43)}`;

    const response = await callRoute(GET, { url: "/api/expenses?month=2026-10" });

    expect(response.status).toBe(401);
    expect(mocks.createSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});
