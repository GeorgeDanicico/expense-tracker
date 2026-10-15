import { beforeEach, describe, expect, it, vi } from "vitest";

import { callRoute } from "@/test/route";
import { FakeAuth } from "@/test/fakes/auth";

let auth: FakeAuth;
vi.mock("@/lib/auth", () => ({ getAuth: () => auth, getAuthenticatedUser: vi.fn() }));

import { DELETE, POST } from "@/app/api/auth/route";

const email = "owner@example.test";
const password = "correct-horse";

function post(body: unknown) {
  return callRoute(POST, { method: "POST", url: "/api/auth", body });
}

describe("POST /api/auth", () => {
  beforeEach(() => {
    auth = new FakeAuth();
  });

  it("rejects an invalid body with 422 and field errors", async () => {
    const response = await post({ mode: "login", email: "not-an-email", password: "short" });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: "Check the highlighted details and try again.",
      fieldErrors: {
        email: ["Enter a valid email address."],
        password: ["Password must contain at least 8 characters."],
      },
    });
  });

  it("rejects a body that is not JSON with 422", async () => {
    const response = await post("not json");

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("Check the highlighted details and try again.");
  });

  it("signs in with the right password", async () => {
    const user = auth.addUser(email, password);

    const response = await post({ mode: "login", email, password });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authenticated: true });
    expect(auth.currentUser).toEqual(user);
  });

  it("answers 401 with a generic message for a wrong password", async () => {
    auth.addUser(email, password);

    const response = await post({ mode: "login", email, password: "wrong-password" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Email or password is incorrect." });
    expect(auth.currentUser).toBeNull();
  });

  it("signs up and asks to confirm the email when the provider requires it", async () => {
    const response = await post({ mode: "signup", email, password });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      authenticated: false,
      message: "Check your inbox to confirm your email, then sign in.",
    });
    expect(auth.lastConfirmationUrl).toBe("http://localhost/auth/confirm?next=%2Fdashboard");
  });

  it("signs up and signs in straight away when no confirmation is needed", async () => {
    auth = new FakeAuth({ requireEmailConfirmation: false });

    const response = await post({ mode: "signup", email, password });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authenticated: true });
  });

  it("answers 400 with the provider's message when sign-up fails", async () => {
    auth.fail("signUp", "User already registered");

    const response = await post({ mode: "signup", email, password });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "User already registered" });
  });
});

describe("DELETE /api/auth", () => {
  beforeEach(() => {
    auth = new FakeAuth();
  });

  it("signs out", async () => {
    auth.currentUser = auth.addUser(email, password);

    const response = await callRoute(DELETE, { method: "DELETE", url: "/api/auth" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(auth.currentUser).toBeNull();
  });

  it("answers 500 when signing out fails", async () => {
    auth.fail("signOut");

    const response = await callRoute(DELETE, { method: "DELETE", url: "/api/auth" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Unable to sign out. Please try again." });
  });
});
