import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getOAuthIssuer: () => "https://ref.supabase.test/auth/v1" }));

import {
  getMcpAuthorizationServer,
  mcpBearerChallenge,
  mcpProtectedResourceMetadata,
  mcpResourceOrigin,
} from "@/lib/mcp/authorization-server";

describe("getMcpAuthorizationServer", () => {
  it("is the auth provider's OAuth issuer", () => {
    expect(getMcpAuthorizationServer()).toEqual({ issuer: "https://ref.supabase.test/auth/v1" });
  });
});

describe("mcpResourceOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is SITE_URL's origin when it's set", () => {
    vi.stubEnv("SITE_URL", "https://ledger.tail1234.ts.net/some/path");

    expect(mcpResourceOrigin(new Request("http://localhost:3000/api/mcp"))).toBe("https://ledger.tail1234.ts.net");
  });

  it.each([["unset", ""], ["invalid", "not a url"]])("is the request's origin when SITE_URL is %s", (_, value) => {
    vi.stubEnv("SITE_URL", value);

    expect(mcpResourceOrigin(new Request("http://localhost:3000/api/mcp"))).toBe("http://localhost:3000");
  });
});

describe("the protected-resource file and challenge", () => {
  it("points the challenge at the file for /api/mcp", () => {
    expect(mcpBearerChallenge("https://app.test")).toBe(
      'Bearer resource_metadata="https://app.test/.well-known/oauth-protected-resource/api/mcp"',
    );
  });

  it("names /api/mcp, the issuer, header tokens and the email scope", () => {
    expect(mcpProtectedResourceMetadata("https://app.test")).toEqual({
      resource: "https://app.test/api/mcp",
      authorization_servers: ["https://ref.supabase.test/auth/v1"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["email"],
    });
  });
});
