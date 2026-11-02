import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthAdmin } from "@/lib/auth/admin";
import { UNKNOWN_USERNAME_EMAIL } from "@/lib/family/kid-account";
import {
  resetRateLimits,
  SIGN_IN_IP_MAX_FAILURES,
  SIGN_IN_NAME_MAX_FAILURES,
  SIGN_IN_WINDOW_MS,
  SIGN_UP_MAX_ATTEMPTS,
  SIGN_UP_WINDOW_MS,
} from "@/lib/http/rate-limit";
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

function post(body: unknown, ip?: string) {
  return callRoute(POST, { method: "POST", url: "/api/auth", body, headers: ip ? { "X-Forwarded-For": ip } : {} });
}

const tooManySignIns = { status: 429, body: { error: "Too many sign-in attempts. Try again in a few minutes." } };

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
    resetRateLimits();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
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
    // Every response has its own request id; every other header must be the same.
    const withoutRequestId = (headers: Headers) => [...headers].filter(([name]) => name !== "x-request-id");
    expect(withoutRequestId(unknownUsername.headers)).toEqual(withoutRequestId(wrongPassword.headers));
    expect(auth.currentUser).toBeNull();
  });

  it("signs an unknown username in against the dummy address, as a real username goes through sign-in", async () => {
    await addKid();
    const signIn = vi.spyOn(auth, "signInWithPassword");

    await post({ mode: "login", email: "ana", password: "wrong-password" });
    const unknown = await post({ mode: "login", email: "nobody", password });

    expect(unknown).toMatchObject(signInFailed);
    expect(signIn.mock.calls).toEqual([
      [kidEmail, "wrong-password"],
      [UNKNOWN_USERNAME_EMAIL, password],
    ]);
  });

  it("signs in against the dummy address when the username lookup fails", async () => {
    await addKid();
    admin.fail("findEmailByUsername", new Error("Unable to look up the username."));
    const signIn = vi.spyOn(auth, "signInWithPassword");

    const response = await post({ mode: "login", email: "ana", password });

    expect(response).toMatchObject(signInFailed);
    expect(signIn).toHaveBeenCalledWith(UNKNOWN_USERNAME_EMAIL, password);
  });

  it("never keeps a session for the dummy address, even if an account had it", async () => {
    auth.addUser(UNKNOWN_USERNAME_EMAIL, password);

    const response = await post({ mode: "login", email: "nobody", password });

    expect(response).toMatchObject(signInFailed);
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

  it("refuses to sign up with a generated kid address, the dummy sign-in address included", async () => {
    for (const address of ["ana@kids.ifam.invalid", "Ana@KIDS.ifam.invalid", UNKNOWN_USERNAME_EMAIL]) {
      const response = await post({ mode: "signup", email: address, password });

      expect(response.status).toBe(422);
      expect(response.body.fieldErrors).toEqual({ email: ["Enter a valid email address."] });
    }
    expect(auth.accounts).toEqual([]);
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

describe("POST /api/auth rate limits", () => {
  const ip = "203.0.113.7";

  beforeEach(() => {
    auth = new FakeAuth();
    admin = new FakeAuthAdmin(auth);
    mocks.getAuthAdmin.mockReset();
    mocks.getAuthAdmin.mockImplementation(() => admin);
    resetRateLimits();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function failSignIns(name: string, times: number, ipFor: (attempt: number) => string | undefined = () => ip) {
    for (let attempt = 0; attempt < times; attempt += 1) {
      expect(await post({ mode: "login", email: name, password: "wrong-password" }, ipFor(attempt))).toMatchObject(signInFailed);
    }
  }

  it("answers the sixth wrong password for one name with 429 and Retry-After, before asking the provider", async () => {
    auth.addUser(email, password);
    await failSignIns(email, SIGN_IN_NAME_MAX_FAILURES);
    const signIn = vi.spyOn(auth, "signInWithPassword");

    const limited = await post({ mode: "login", email, password }, ip);

    expect(limited).toMatchObject(tooManySignIns);
    expect(limited.headers.get("retry-after")).toBe(String(SIGN_IN_WINDOW_MS / 1000));
    expect(limited.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(signIn).not.toHaveBeenCalled();
    expect(auth.currentUser).toBeNull();
  });

  it("still lets a different name sign in from the same IP", async () => {
    auth.addUser(email, password);
    const other = auth.addUser("other@example.test", password);
    await failSignIns(email, SIGN_IN_NAME_MAX_FAILURES);

    const response = await post({ mode: "login", email: "other@example.test", password }, ip);

    expect(response).toMatchObject({ status: 200, body: { authenticated: true } });
    expect(auth.currentUser).toEqual(other);
  });

  it("counts an email whatever its case, so changing the case doesn't reset the limit", async () => {
    auth.addUser(email, password);
    await failSignIns("Owner@Example.test", SIGN_IN_NAME_MAX_FAILURES);

    expect(await post({ mode: "login", email: "OWNER@EXAMPLE.TEST", password: "wrong-password" }, ip)).toMatchObject(tooManySignIns);
  });

  it("counts a username however it's typed, without asking for its email once limited", async () => {
    await addKid();
    await failSignIns(" Ana ", SIGN_IN_NAME_MAX_FAILURES);
    const lookup = vi.spyOn(admin, "findEmailByUsername");

    expect(await post({ mode: "login", email: "ANA", password }, ip)).toMatchObject(tooManySignIns);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("counts unknown usernames too", async () => {
    await failSignIns("nobody", SIGN_IN_NAME_MAX_FAILURES);

    expect(await post({ mode: "login", email: "nobody", password }, ip)).toMatchObject(tooManySignIns);
  });

  it("keeps limiting a name when each guess claims a new IP", async () => {
    auth.addUser(email, password);
    await failSignIns(email, SIGN_IN_NAME_MAX_FAILURES, (attempt) => `198.51.100.${attempt}`);

    expect(await post({ mode: "login", email, password }, "198.51.100.99")).toMatchObject(tooManySignIns);
  });

  it("limits names even when the request carries no IP", async () => {
    auth.addUser(email, password);
    await failSignIns(email, SIGN_IN_NAME_MAX_FAILURES, () => undefined);

    expect(await post({ mode: "login", email, password })).toMatchObject(tooManySignIns);
  });

  it("answers 429 to any name from an IP with 20 failures, while other IPs still sign in", async () => {
    const user = auth.addUser(email, password);
    for (let attempt = 0; attempt < SIGN_IN_IP_MAX_FAILURES; attempt += 1) {
      // A new name each time, so only the IP limit can be reached.
      expect(await post({ mode: "login", email: `guess${attempt}`, password }, ip)).toMatchObject(signInFailed);
    }

    const limited = await post({ mode: "login", email, password }, ip);
    expect(limited).toMatchObject(tooManySignIns);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    expect(await post({ mode: "login", email, password }, "203.0.113.8")).toMatchObject({ status: 200 });
    expect(auth.currentUser).toEqual(user);
  });

  it("uses the last X-Forwarded-For hop, so a made-up first hop doesn't reset the IP limit", async () => {
    auth.addUser(email, password);
    for (let attempt = 0; attempt < SIGN_IN_IP_MAX_FAILURES; attempt += 1) {
      await post({ mode: "login", email: `guess${attempt}`, password }, `198.51.100.${attempt}, ${ip}`);
    }

    expect(await post({ mode: "login", email, password }, `198.51.100.99, ${ip}`)).toMatchObject(tooManySignIns);
  });

  it("doesn't count successful sign-ins", async () => {
    auth.addUser(email, password);
    for (let attempt = 0; attempt < SIGN_IN_NAME_MAX_FAILURES * 2; attempt += 1) {
      expect((await post({ mode: "login", email, password }, ip)).status).toBe(200);
    }
    await failSignIns(email, SIGN_IN_NAME_MAX_FAILURES - 1);

    expect((await post({ mode: "login", email, password }, ip)).status).toBe(200);
  });

  it("doesn't count the provider's own rate limit or an unconfirmed email", async () => {
    await auth.signUp(email, password, "http://localhost/auth/confirm");
    for (let attempt = 0; attempt < SIGN_IN_NAME_MAX_FAILURES; attempt += 1) {
      auth.fail("signInWithPassword", "Too many attempts.", "rate_limited");
      expect((await post({ mode: "login", email, password }, ip)).status).toBe(429);
      expect((await post({ mode: "login", email, password }, ip)).status).toBe(403);
    }

    expect((await post({ mode: "login", email, password: "wrong-password" }, ip)).status).toBe(401);
  });

  it("lets a name try again once its oldest failure is 15 minutes old", async () => {
    auth.addUser(email, password);
    await failSignIns(email, SIGN_IN_NAME_MAX_FAILURES);

    vi.setSystemTime(new Date(Date.now() + SIGN_IN_WINDOW_MS - 1_000));
    const limited = await post({ mode: "login", email, password }, ip);
    expect(limited).toMatchObject(tooManySignIns);
    expect(limited.headers.get("retry-after")).toBe("1");

    vi.setSystemTime(new Date(Date.now() + 1_000));
    expect((await post({ mode: "login", email, password }, ip)).status).toBe(200);
  });

  it("answers the 11th sign-up from one IP in an hour with 429 and Retry-After, without asking the provider", async () => {
    for (let attempt = 0; attempt < SIGN_UP_MAX_ATTEMPTS; attempt += 1) {
      // Failed sign-ups count too.
      expect((await post({ mode: "signup", email, password }, ip)).status).toBe(attempt === 0 ? 200 : 400);
    }
    const signUp = vi.spyOn(auth, "signUp");

    const limited = await post({ mode: "signup", email: "new@example.test", password }, ip);

    expect(limited).toMatchObject({ status: 429, body: { error: "Too many sign-ups from this network. Try again in an hour." } });
    expect(limited.headers.get("retry-after")).toBe(String(SIGN_UP_WINDOW_MS / 1000));
    expect(signUp).not.toHaveBeenCalled();

    expect((await post({ mode: "signup", email: "new@example.test", password }, "203.0.113.8")).status).toBe(200);
    vi.setSystemTime(new Date(Date.now() + SIGN_UP_WINDOW_MS));
    expect((await post({ mode: "signup", email: "later@example.test", password }, ip)).status).toBe(200);
  });

  it("doesn't count a sign-up the body check refuses", async () => {
    for (let attempt = 0; attempt < SIGN_UP_MAX_ATTEMPTS; attempt += 1) {
      expect((await post({ mode: "signup", email: "not-an-email", password }, ip)).status).toBe(422);
    }

    expect((await post({ mode: "signup", email, password }, ip)).status).toBe(200);
  });

  it("doesn't let sign-ups use up the sign-in limits", async () => {
    auth.addUser(email, password);
    for (let attempt = 0; attempt < SIGN_UP_MAX_ATTEMPTS; attempt += 1) await post({ mode: "signup", email, password }, ip);

    expect((await post({ mode: "login", email, password }, ip)).status).toBe(200);
  });
});

describe("DELETE /api/auth", () => {
  beforeEach(() => {
    auth = new FakeAuth();
  });

  it("signs this browser out only", async () => {
    auth.currentUser = auth.addUser(email, password);

    const response = await callRoute(DELETE, { method: "DELETE", url: "/api/auth" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(auth.currentUser).toBeNull();
    expect(auth.signOutScopes).toEqual(["local"]);
  });

  it("signs out everywhere with ?scope=global", async () => {
    auth.currentUser = auth.addUser(email, password);

    const response = await callRoute(DELETE, { method: "DELETE", url: "/api/auth?scope=global" });

    expect(response).toMatchObject({ status: 200, body: { success: true } });
    expect(auth.currentUser).toBeNull();
    expect(auth.signOutScopes).toEqual(["global"]);
  });

  it.each(["others", "local", "everywhere", ""])("refuses ?scope=%s with 422 without signing out", async (scope) => {
    auth.currentUser = auth.addUser(email, password);

    const response = await callRoute(DELETE, { method: "DELETE", url: `/api/auth?scope=${scope}` });

    expect(response).toMatchObject({ status: 422, body: { error: "Unknown sign-out scope." } });
    expect(auth.signOutScopes).toEqual([]);
    expect(auth.currentUser).not.toBeNull();
  });

  it("lets an account that must change its password sign out: the route doesn't check the flag", async () => {
    auth.currentUser = auth.addUser(email, password);

    expect((await callRoute(DELETE, { method: "DELETE", url: "/api/auth" })).status).toBe(200);
  });

  it("answers 500 when signing out fails", async () => {
    auth.fail("signOut");

    const response = await callRoute(DELETE, { method: "DELETE", url: "/api/auth" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Unable to sign out. Please try again." });
  });
});

// The request guard (security plan S5): /api/auth doesn't use withUser, so it runs the guard itself.
describe("the request guard on /api/auth", () => {
  const login = { mode: "login", email, password };
  const refused = { status: 403, body: { error: "This request didn't come from the app, so it was refused." } };

  beforeEach(() => {
    auth = new FakeAuth();
    admin = new FakeAuthAdmin(auth);
    mocks.getAuthAdmin.mockImplementation(() => admin);
    resetRateLimits();
    auth.addUser(email, password);
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["Sec-Fetch-Site: cross-site", { "Sec-Fetch-Site": "cross-site" }],
    ["a foreign Origin", { Origin: "https://evil.example" }],
  ])("refuses a sign-in with %s (login CSRF) before asking the provider", async (_name, headers) => {
    const signIn = vi.spyOn(auth, "signInWithPassword");

    expect(await callRoute(POST, { method: "POST", url: "/api/auth", body: login, headers })).toMatchObject(refused);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("refuses a sign-out from another site", async () => {
    auth.currentUser = auth.addUser("other@example.test", password);

    expect(await callRoute(DELETE, { method: "DELETE", url: "/api/auth", headers: { "Sec-Fetch-Site": "cross-site" } })).toMatchObject(refused);
    expect(auth.currentUser).not.toBeNull();
  });

  it("refuses a text/plain body with 415", async () => {
    const response = await callRoute(POST, {
      method: "POST", url: "/api/auth", body: login, headers: { "Content-Type": "text/plain" },
    });

    expect(response).toMatchObject({ status: 415, body: { error: "Send the request body as JSON (Content-Type: application/json)." } });
  });

  it("refuses a body over 64 KB with 413", async () => {
    const response = await callRoute(POST, { method: "POST", url: "/api/auth", body: { ...login, padding: "x".repeat(65 * 1024) } });

    expect(response).toMatchObject({ status: 413, body: { error: "The request is too large." } });
  });

  it("signs in from the app's own page", async () => {
    const headers = { "Sec-Fetch-Site": "same-origin", Origin: "http://localhost" };

    expect(await callRoute(POST, { method: "POST", url: "/api/auth", body: login, headers })).toMatchObject({
      status: 200,
      body: { authenticated: true },
    });
  });
});
