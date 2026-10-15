import { beforeEach, describe, expect, it, vi } from "vitest";

import { callRoute } from "@/test/route";
import { FakeAuth } from "@/test/fakes/auth";

let auth: FakeAuth;
vi.mock("@/lib/auth", () => ({ getAuth: () => auth, getAuthenticatedUser: vi.fn() }));

import { GET } from "@/app/api/auth/google/route";

describe("GET /api/auth/google", () => {
  beforeEach(() => {
    auth = new FakeAuth();
  });

  it("redirects to Google with the confirm route as the callback", async () => {
    const response = await callRoute(GET, { url: "/api/auth/google" });

    expect(response.status).toBe(307);
    expect(auth.lastOAuth).toEqual({ provider: "google", callbackUrl: "http://localhost/auth/confirm?next=%2Fdashboard" });
    expect(response.headers.get("location")).toBe(
      `https://google.auth.test/authorize?redirect_to=${encodeURIComponent("http://localhost/auth/confirm?next=%2Fdashboard")}`,
    );
  });

  it("redirects to the login page when the provider fails", async () => {
    auth.fail("oauthSignInUrl");

    const response = await callRoute(GET, { url: "/api/auth/google" });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login?message=oauth-failed");
  });
});
