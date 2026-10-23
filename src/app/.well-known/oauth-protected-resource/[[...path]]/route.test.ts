import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getOAuthIssuer: () => "https://ref.supabase.test/auth/v1" }));

import { GET } from "@/app/.well-known/oauth-protected-resource/[[...path]]/route";

function get(path?: string[]) {
  const url = `http://localhost:3000/.well-known/oauth-protected-resource${path ? `/${path.join("/")}` : ""}`;
  return GET(new Request(url), { params: Promise.resolve({ path }) });
}

const metadata = {
  resource: "https://ledger.example.test/api/mcp",
  authorization_servers: ["https://ref.supabase.test/auth/v1"],
  bearer_methods_supported: ["header"],
  scopes_supported: ["email"],
};

describe("GET /.well-known/oauth-protected-resource", () => {
  beforeEach(() => vi.stubEnv("SITE_URL", "https://ledger.example.test"));
  afterEach(() => vi.unstubAllEnvs());

  it.each([["the bare path", undefined], ["the /api/mcp path", ["api", "mcp"]]])("serves the file at %s", async (_, path) => {
    const response = await get(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual(metadata);
  });

  it("names the request's origin when SITE_URL isn't set", async () => {
    vi.stubEnv("SITE_URL", "");

    expect((await (await get()).json()).resource).toBe("http://localhost:3000/api/mcp");
  });

  it.each([[["api"]], [["api", "expenses"]], [["api", "mcp", "extra"]]])("answers 404 for %j", async (path) => {
    expect((await get(path)).status).toBe(404);
  });
});
