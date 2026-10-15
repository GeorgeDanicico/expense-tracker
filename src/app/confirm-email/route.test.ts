import { beforeEach, describe, expect, it, vi } from "vitest";

import { callRoute } from "@/test/route";
import { FakeAuth } from "@/test/fakes/auth";

let auth: FakeAuth;
vi.mock("@/lib/auth", () => ({ getAuth: () => auth, getAuthenticatedUser: vi.fn() }));

import { GET } from "@/app/confirm-email/route";

const email = "owner@example.test";
const FAILED = "http://localhost/login?message=confirmation-failed";

async function confirm(params: Record<string, string>) {
  const response = await callRoute(GET, { url: `/confirm-email?${new URLSearchParams(params)}` });
  expect(response.status).toBe(307);
  return response.headers.get("location");
}

describe("GET /confirm-email", () => {
  beforeEach(() => {
    auth = new FakeAuth();
    auth.addUser(email, "correct-horse");
  });

  it("verifies the 6-digit code and redirects to the dashboard", async () => {
    auth.emailLinks.set(`${email}:123456`, email);

    expect(await confirm({ email, token: "123456", type: "email" })).toBe("http://localhost/dashboard");
    expect(auth.currentUser?.email).toBe(email);
  });

  it("redirects to the login page when the code is wrong", async () => {
    expect(await confirm({ email, token: "654321", type: "email" })).toBe(FAILED);
  });

  it.each([
    ["a code that is not 6 digits", { email, token: "12345", type: "email" }],
    ["another type", { email, token: "123456", type: "signup" }],
    ["an invalid email", { email: "nope", token: "123456", type: "email" }],
  ])("redirects to the login page for %s", async (_, params) => {
    auth.emailLinks.set(`${email}:123456`, email);

    expect(await confirm(params)).toBe(FAILED);
    expect(auth.currentUser).toBeNull();
  });
});
