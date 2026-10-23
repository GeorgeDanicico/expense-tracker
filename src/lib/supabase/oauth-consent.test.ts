import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseConfig: () => ({ url: "https://ref.supabase.test/", publishableKey: "pk" }),
}));

import { DomainError } from "@/lib/errors";
import { supabaseOAuthConsent, supabaseOAuthIssuer } from "@/lib/supabase/oauth-consent";

const CLIENT = { id: "client-1", name: "Claude Code (simple-ledger)", uri: "", logo_uri: "" };

function mockOAuth(methods: Record<string, unknown>) {
  const oauth = Object.fromEntries(Object.entries(methods).map(([name, value]) => [name, vi.fn().mockResolvedValue(value)]));
  mocks.createClient.mockResolvedValue({ auth: { oauth } });
  return oauth;
}

describe("supabaseOAuthIssuer", () => {
  it("is the project's Supabase Auth URL", () => {
    expect(supabaseOAuthIssuer()).toBe("https://ref.supabase.test/auth/v1");
  });
});

describe("supabaseOAuthConsent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getRequest", () => {
    it("returns the app, redirect URI and scopes of a request that needs consent", async () => {
      const oauth = mockOAuth({
        getAuthorizationDetails: {
          data: {
            authorization_id: "authorization-1",
            redirect_uri: "http://localhost:4567/callback",
            client: { ...CLIENT, uri: "https://claude.test", logo_uri: "https://claude.test/logo.png" },
            user: { id: "user-1", email: "a@example.test" },
            scope: "email  profile",
          },
          error: null,
        },
      });

      expect(await supabaseOAuthConsent.getRequest("authorization-1")).toEqual({
        kind: "needs_consent",
        authorizationId: "authorization-1",
        app: { clientId: "client-1", name: "Claude Code (simple-ledger)", uri: "https://claude.test", logoUri: "https://claude.test/logo.png" },
        redirectUri: "http://localhost:4567/callback",
        scopes: ["email", "profile"],
      });
      expect(oauth.getAuthorizationDetails).toHaveBeenCalledExactlyOnceWith("authorization-1");
    });

    it("maps the empty URIs of an app that registered none to null", async () => {
      mockOAuth({
        getAuthorizationDetails: {
          data: { authorization_id: "authorization-1", redirect_uri: "http://localhost/cb", client: CLIENT, user: {}, scope: "" },
          error: null,
        },
      });

      expect(await supabaseOAuthConsent.getRequest("authorization-1")).toMatchObject({
        app: { uri: null, logoUri: null },
        scopes: [],
      });
    });

    it("passes the redirect on for an app that was already approved", async () => {
      mockOAuth({ getAuthorizationDetails: { data: { redirect_url: "http://localhost/cb?code=abc" }, error: null } });

      expect(await supabaseOAuthConsent.getRequest("authorization-1")).toEqual({
        kind: "already_approved",
        redirectUrl: "http://localhost/cb?code=abc",
      });
    });

    it.each([
      ["an error (unknown, expired or someone else's)", { data: null, error: { message: "not found", status: 404 } }],
      ["no data", { data: null, error: null }],
    ])("returns null on %s", async (_, response) => {
      mockOAuth({ getAuthorizationDetails: response });

      expect(await supabaseOAuthConsent.getRequest("authorization-1")).toBeNull();
    });
  });

  describe.each(["approve", "deny"] as const)("%s", (method) => {
    const providerMethod = method === "approve" ? "approveAuthorization" : "denyAuthorization";

    it("returns the redirect URL without redirecting", async () => {
      const oauth = mockOAuth({ [providerMethod]: { data: { redirect_url: "http://localhost/cb?x=1" }, error: null } });

      expect(await supabaseOAuthConsent[method]("authorization-1")).toEqual({ redirectUrl: "http://localhost/cb?x=1" });
      expect(oauth[providerMethod]).toHaveBeenCalledExactlyOnceWith("authorization-1", { skipBrowserRedirect: true });
    });

    it.each([400, 403, 404])("answers 404 when the provider refuses with %i", async (status) => {
      mockOAuth({ [providerMethod]: { data: null, error: { message: "nope", status } } });

      await expect(supabaseOAuthConsent[method]("authorization-1")).rejects.toEqual(
        new DomainError("That authorization request doesn't exist or has expired.", 404),
      );
    });

    it.each([
      ["a server error", { data: null, error: { message: "boom", status: 500 } }],
      ["a rate limit", { data: null, error: { message: "slow down", status: 429 } }],
      ["no redirect URL", { data: null, error: null }],
    ])("throws a generic error on %s", async (_, response) => {
      mockOAuth({ [providerMethod]: response });

      const error = await supabaseOAuthConsent[method]("authorization-1").catch((caught: unknown) => caught);
      expect(error).toEqual(new Error("Unable to answer the authorization request."));
      expect(error).not.toBeInstanceOf(DomainError);
    });
  });

  describe("listConnectedApps", () => {
    it("lists the caller's grants", async () => {
      mockOAuth({
        listGrants: {
          data: [
            { client: CLIENT, scopes: ["email"], granted_at: "2026-10-23T10:00:00Z" },
            { client: { ...CLIENT, id: "client-2", uri: "https://other.test" }, scopes: [], granted_at: "2026-10-22T10:00:00Z" },
          ],
          error: null,
        },
      });

      expect(await supabaseOAuthConsent.listConnectedApps()).toEqual([
        { clientId: "client-1", name: "Claude Code (simple-ledger)", uri: null, logoUri: null, scopes: ["email"], connectedAt: "2026-10-23T10:00:00Z" },
        { clientId: "client-2", name: "Claude Code (simple-ledger)", uri: "https://other.test", logoUri: null, scopes: [], connectedAt: "2026-10-22T10:00:00Z" },
      ]);
    });

    it("throws a generic error when the provider fails", async () => {
      mockOAuth({ listGrants: { data: null, error: { message: "boom", status: 500 } } });

      await expect(supabaseOAuthConsent.listConnectedApps()).rejects.toEqual(new Error("Unable to load the connected apps."));
    });
  });

  describe("disconnect", () => {
    it("revokes the app's grant", async () => {
      const oauth = mockOAuth({ revokeGrant: { data: {}, error: null } });

      await supabaseOAuthConsent.disconnect("client-1");
      expect(oauth.revokeGrant).toHaveBeenCalledExactlyOnceWith({ clientId: "client-1" });
    });

    it("throws a generic error when the provider fails", async () => {
      mockOAuth({ revokeGrant: { data: null, error: { message: "boom", status: 500 } } });

      await expect(supabaseOAuthConsent.disconnect("client-1")).rejects.toEqual(new Error("Unable to disconnect the app."));
    });
  });
});
