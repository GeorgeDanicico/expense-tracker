import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getOAuthIssuer: () => "https://ref.supabase.test/auth/v1" }));

import { getMcpAuthorizationServer } from "@/lib/mcp/authorization-server";

describe("getMcpAuthorizationServer", () => {
  it("is the auth provider's OAuth issuer", () => {
    expect(getMcpAuthorizationServer()).toEqual({ issuer: "https://ref.supabase.test/auth/v1" });
  });
});
