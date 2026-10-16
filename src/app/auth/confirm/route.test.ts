import { beforeEach, describe, expect, it, vi } from "vitest";

import { callRoute } from "@/test/route";
import { FakeAuth } from "@/test/fakes/auth";

let auth: FakeAuth;
vi.mock("@/lib/auth", () => ({ getAuth: () => auth, getAuthenticatedUser: vi.fn() }));

import { GET } from "@/app/auth/confirm/route";

const email = "owner@example.test";
const FAILED = "http://localhost/login?message=confirmation-failed";

async function confirm(query: string) {
  const response = await callRoute(GET, { url: `/auth/confirm?${query}` });
  expect(response.status).toBe(307);
  return response.headers.get("location");
}

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    auth = new FakeAuth();
    auth.addUser(email, "correct-horse");
  });

  it("exchanges a code and redirects to the next path", async () => {
    auth.emailLinks.set("code-1", email);

    expect(await confirm("code=code-1&next=/expenses")).toBe("http://localhost/expenses");
    expect(auth.currentUser?.email).toBe(email);
  });

  it("verifies a token hash and redirects to the next path", async () => {
    auth.emailLinks.set("hash-1", email);

    expect(await confirm("token_hash=hash-1&type=signup&next=/settings")).toBe("http://localhost/settings");
  });

  it("keeps a join link through the confirmation", async () => {
    auth.emailLinks.set("code-1", email);

    expect(await confirm(`code=code-1&next=${encodeURIComponent("/join/ABCD2345")}`)).toBe("http://localhost/join/ABCD2345");
  });

  it("redirects to the dashboard when there is no next path", async () => {
    auth.emailLinks.set("code-1", email);

    expect(await confirm("code=code-1")).toBe("http://localhost/dashboard");
  });

  it.each([
    ["an absolute URL", "https://evil.test/steal"],
    ["a protocol-relative URL", "//evil.test/steal"],
    ["a relative path", "settings"],
  ])("ignores %s as the next path", async (_, next) => {
    auth.emailLinks.set("code-1", email);

    expect(await confirm(`code=code-1&next=${encodeURIComponent(next)}`)).toBe("http://localhost/dashboard");
  });

  it("redirects to the login page when the link is invalid", async () => {
    expect(await confirm("code=unknown&next=/expenses")).toBe(FAILED);
    expect(auth.currentUser).toBeNull();
  });

  it("redirects to the login page when a token hash has no type", async () => {
    auth.emailLinks.set("hash-1", email);

    expect(await confirm("token_hash=hash-1")).toBe(FAILED);
  });

  it("redirects to the login page when the link has no token", async () => {
    expect(await confirm("next=/expenses")).toBe(FAILED);
  });
});
