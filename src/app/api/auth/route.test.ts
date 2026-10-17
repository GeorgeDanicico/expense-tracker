import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthAdmin } from "@/lib/auth/admin";
import { callRoute } from "@/test/route";
import { FakeAuth, FakeAuthAdmin } from "@/test/fakes/auth";

let auth: FakeAuth;
let admin: FakeAuthAdmin;
const mocks = vi.hoisted(() => ({ getAuthAdmin: vi.fn<() => AuthAdmin>() }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => auth,
  getAuthAdmin: mocks.getAuthAdmin,
  getAuthenticatedUser: vi.fn(),
}));

import { DELETE, POST } from "@/app/api/auth/route";

const email = "owner@example.test";
const password = "correct-horse";
const kidEmail = "ana@kids.ifam.invalid";
const signInFailed = { status: 401, body: { error: "Email or password is incorrect." } };

function post(body: unknown) {
  return callRoute(POST, { method: "POST", url: "/api/auth", body });
}

function addKid(username = "ana") {
  return admin.createUser({
    email: kidEmail,
    password,
    username,
    displayName: "Ana",
    managedByFamily: "family-1",
    mustChangePassword: false,
  });
}

function withoutAdmin() {
  mocks.getAuthAdmin.mockImplementation(() => {
    throw new Error("SUPABASE_SECRET_KEY is not set.");
  });
}

describe("POST /api/auth", () => {
  beforeEach(() => {
    auth = new FakeAuth();
    admin = new FakeAuthAdmin(auth);
    mocks.getAuthAdmin.mockReset();
    mocks.getAuthAdmin.mockImplementation(() => admin);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an invalid body with 422 and field errors", async () => {
    const response = await post({ mode: "signup", email: "not-an-email", password: "short" });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: "Check the highlighted details and try again.",
      fieldErrors: {
        email: ["Enter a valid email address."],
        password: ["Password must contain at least 8 characters."],
      },
    });
  });

  it("rejects a sign-in name that is neither an email nor a username with 422", async () => {
    const response = await post({ mode: "login", email: "not an email!", password: "short" });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: "Check the highlighted details and try again.",
      fieldErrors: {
        email: ["Enter a valid email address or username."],
        password: ["Password must contain at least 8 characters."],
      },
    });
  });

  it("rejects a body that is not JSON with 422", async () => {
    const response = await post("not json");

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("Check the highlighted details and try again.");
  });

  it("signs in with an email and the right password without the admin lookup", async () => {
    const user = auth.addUser(email, password);

    const response = await post({ mode: "login", email, password });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authenticated: true });
    expect(auth.currentUser).toEqual(user);
    expect(mocks.getAuthAdmin).not.toHaveBeenCalled();
  });

  it("signs in with an email when no admin access is configured", async () => {
    withoutAdmin();
    const user = auth.addUser(email, password);

    const response = await post({ mode: "login", email, password });

    expect(response.status).toBe(200);
    expect(auth.currentUser).toEqual(user);
  });

  it("answers 401 with a generic message for a wrong password", async () => {
    auth.addUser(email, password);

    const response = await post({ mode: "login", email, password: "wrong-password" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Email or password is incorrect." });
    expect(auth.currentUser).toBeNull();
  });

  it("answers 429 with the reason when the provider rate-limits sign-in", async () => {
    auth.addUser(email, password);
    auth.fail("signInWithPassword", "Too many attempts.", "rate_limited");

    const response = await post({ mode: "login", email, password });

    expect(response).toMatchObject({ status: 429, body: { error: "Too many attempts." } });
  });

  it("answers 403 asking to confirm the email for the right password on an unconfirmed account", async () => {
    await auth.signUp(email, password, "http://localhost/auth/confirm");

    const response = await post({ mode: "login", email, password });

    expect(response).toMatchObject({ status: 403, body: { error: "Email not confirmed" } });
  });

  it("signs in with a username, ignoring case and spaces", async () => {
    const kid = await addKid();

    const response = await post({ mode: "login", email: "  Ana ", password });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authenticated: true });
    expect(auth.currentUser).toEqual(kid);
  });

  it("answers 401 with the same message for a username and a wrong password", async () => {
    await addKid();

    const response = await post({ mode: "login", email: "ana", password: "wrong-password" });

    expect(response).toMatchObject(signInFailed);
    expect(auth.currentUser).toBeNull();
  });

  it("answers an unknown username exactly like a wrong password", async () => {
    auth.addUser(email, password);
    const wrongPassword = await post({ mode: "login", email, password: "wrong-password" });

    const unknownUsername = await post({ mode: "login", email: "nobody", password });

    expect(unknownUsername).toMatchObject(signInFailed);
    expect(unknownUsername.status).toBe(wrongPassword.status);
    expect(unknownUsername.body).toEqual(wrongPassword.body);
    expect([...unknownUsername.headers]).toEqual([...wrongPassword.headers]);
    expect(auth.currentUser).toBeNull();
  });

  it("answers 401 without logging when the username lookup fails", async () => {
    const logs = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];
    await addKid();
    admin.fail("findEmailByUsername", new Error("Unable to look up the username."));

    const response = await post({ mode: "login", email: "ana", password });

    expect(response).toMatchObject(signInFailed);
    expect(auth.currentUser).toBeNull();
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("answers 401 for a username when no admin access is configured", async () => {
    await addKid();
    withoutAdmin();

    const response = await post({ mode: "login", email: "ana", password });

    expect(response).toMatchObject(signInFailed);
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

  it("keeps a same-site next path in the confirmation link", async () => {
    await post({ mode: "signup", email, password, next: "/join/ABCD2345" });

    expect(auth.lastConfirmationUrl).toBe("http://localhost/auth/confirm?next=%2Fjoin%2FABCD2345");
  });

  it("ignores an external next path in the confirmation link", async () => {
    await post({ mode: "signup", email, password, next: "https://evil.test/" });

    expect(auth.lastConfirmationUrl).toBe("http://localhost/auth/confirm?next=%2Fdashboard");
  });

  it("refuses to sign up with a username", async () => {
    const response = await post({ mode: "signup", email: "ana", password });

    expect(response.status).toBe(422);
    expect(response.body.fieldErrors).toEqual({ email: ["Enter a valid email address."] });
    expect(auth.accounts).toEqual([]);
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

  it("answers 429 with the reason when the provider can't send more emails", async () => {
    auth.fail("signUp", "We've sent too many emails.", "rate_limited");

    const response = await post({ mode: "signup", email, password });

    expect(response).toMatchObject({ status: 429, body: { error: "We've sent too many emails." } });
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
