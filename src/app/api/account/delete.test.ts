import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETION_REFUSALS } from "@/lib/account/data-repository";
import { WRONG_CURRENT_PASSWORD } from "@/lib/account/password-change";
import { forgetLastActive } from "@/lib/family/last-active";
import { ACCOUNT_DELETION_MAX_ATTEMPTS, resetRateLimits, TOO_MANY_ACCOUNT_DELETIONS } from "@/lib/http/rate-limit";
import { aKid, aParent } from "@/test/builders";
import { FakeAuth, FakeAuthAdmin } from "@/test/fakes/auth";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

let auth: FakeAuth;
let admin: FakeAuthAdmin;
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), getAuth: () => auth, getAuthAdmin: () => admin }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { DELETE } from "@/app/api/account/route";

// `DELETE /api/account` (security plan S13): the route, its order of steps and the family rules. The
// rules themselves are the database's (supabase/tests/account_deletion.sql); the fake follows them.

const PASSWORD = "my-own-password";
const EMAIL = "someone@example.test";

let repositories: FakeRepositories;
let user: ReturnType<typeof signedInAs>;

beforeEach(() => {
  resetRateLimits();
  forgetLastActive();
  auth = new FakeAuth();
  admin = new FakeAuthAdmin(auth);
  repositories = resetFakeRepositories();
  user = signedInAs(auth.addUser(EMAIL, PASSWORD));
  auth.currentUser = user;
  repositories.accountData.caller.userId = user.id;
  repositories.accountData.exports.set(user.id, { expenses: [{ id: "e1", description: "Lunch" }] });
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function deleteAccount(body: unknown) {
  return callRoute(DELETE, { method: "DELETE", url: "/api/account", body });
}

const valid = { currentPassword: PASSWORD, confirm: "delete my account" };

/** Nothing was deleted: the data, the auth user and the session are all still there. */
function expectUntouched() {
  expect(repositories.accountData.deleted).toEqual([]);
  expect(repositories.accountData.exports.get(user.id)?.expenses).toHaveLength(1);
  expect(admin.deletedUserIds).toEqual([]);
  expect(auth.accounts.some((account) => account.id === user.id)).toBe(true);
  expect(auth.signOutScopes).toEqual([]);
}

describe("DELETE /api/account", () => {
  it("deletes the data, then the auth user, then clears this browser's session, for a user with no family", async () => {
    const otherDevice = auth.openSession(user);

    const response = await deleteAccount(valid);

    expect(response.status).toBe(204);
    expect(auth.verifiedEmails).toEqual([EMAIL]);
    expect(repositories.accountData.deleted).toEqual([user.id]);
    expect(repositories.accountData.exports.has(user.id)).toBe(false);
    expect(admin.deletedUserIds).toEqual([user.id]);
    expect(auth.signOutScopes).toEqual(["local"]);
    expect(auth.currentUser).toBeNull();
    // Every other session ended with the auth user.
    expect(otherDevice.ended).toBe(true);
  });

  it("leaves an account that can't sign in again", async () => {
    await deleteAccount(valid);

    expect(await auth.signInWithPassword(EMAIL, PASSWORD)).toMatchObject({ ok: false });
  });

  it("accepts the phrase in any case, with spaces around it", async () => {
    expect((await deleteAccount({ ...valid, confirm: "  Delete My Account " })).status).toBe(204);
  });

  it.each([
    ["a family's creator", () => aParent(), 409, DELETION_REFUSALS.creator],
    ["a second parent", () => aParent({ isCreator: false }), 409, DELETION_REFUSALS.member],
    ["a kid who joined with their own account", () => aKid(), 409, DELETION_REFUSALS.member],
  ])("refuses %s with a plain message and deletes nothing", async (_, membership, status, error) => {
    repositories.family.membership = membership();

    expect(await deleteAccount(valid)).toMatchObject({ status, body: { error } });
    expectUntouched();
  });

  it("refuses a kid account a family manages: a parent deletes it from Manage family", async () => {
    repositories.family.membership = aKid();
    repositories.family.accountProfiles = new Map([[user.id, {
      username: "kid",
      displayName: "Kid",
      managedByFamily: aKid().familyId,
      mustChangePassword: false,
    }]]);

    expect(await deleteAccount(valid)).toMatchObject({ status: 403, body: { error: DELETION_REFUSALS.managed } });
    expectUntouched();
  });

  it("refuses a wrong password on currentPassword and deletes nothing", async () => {
    const response = await deleteAccount({ ...valid, currentPassword: "not-my-password" });

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { currentPassword: [WRONG_CURRENT_PASSWORD] } } });
    expectUntouched();
  });

  it.each([
    ["missing", { currentPassword: PASSWORD }],
    ["wrong", { ...valid, confirm: "delete" }],
    ["empty", { ...valid, confirm: "" }],
  ])("asks for the typed phrase when it's %s, before checking the password", async (_, body) => {
    const response = await deleteAccount(body);

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { confirm: [DELETION_REFUSALS.phrase] } } });
    expect(auth.verifiedEmails).toEqual([]);
    expectUntouched();
  });

  it("asks for the current password", async () => {
    const response = await deleteAccount({ confirm: valid.confirm });

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { currentPassword: ["Enter your current password."] } } });
    expectUntouched();
  });

  it("deletes nothing when the database refuses or fails, as it would without S13's migration", async () => {
    vi.spyOn(repositories.accountData, "deleteMyData").mockRejectedValue(new Error("Unable to delete your data. Please try again."));

    const response = await deleteAccount(valid);

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to delete your account. Please try again." } });
    expect(admin.deletedUserIds).toEqual([]);
    expect(auth.signOutScopes).toEqual([]);
  });

  it("keeps the user signed in when the auth user can't be deleted, so deleting again finishes it", async () => {
    admin.fail("deleteUser");

    const failed = await deleteAccount(valid);

    expect(failed.status).toBe(500);
    // The data is gone, but the user can still use the app to retry.
    expect(repositories.accountData.deleted).toEqual([user.id]);
    expect(auth.signOutScopes).toEqual([]);
    expect(auth.currentUser).toEqual(user);

    const retried = await deleteAccount(valid);

    expect(retried.status).toBe(204);
    expect(repositories.accountData.deleted).toEqual([user.id, user.id]);
    expect(admin.deletedUserIds).toEqual([user.id]);
  });

  it("still answers 204 when only clearing this browser's cookies fails: the account is gone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    auth.fail("signOut");

    expect((await deleteAccount(valid)).status).toBe(204);
    expect(admin.deletedUserIds).toEqual([user.id]);
  });

  it(`answers 429 past ${ACCOUNT_DELETION_MAX_ATTEMPTS} attempts an hour, wrong passwords included`, async () => {
    for (let attempt = 0; attempt < ACCOUNT_DELETION_MAX_ATTEMPTS; attempt += 1) {
      expect((await deleteAccount({ ...valid, currentPassword: `guess-${attempt}` })).status).toBe(422);
    }

    const limited = await deleteAccount(valid);

    expect(limited).toMatchObject({ status: 429, body: { error: TOO_MANY_ACCOUNT_DELETIONS } });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expectUntouched();
  });

  it("refuses an account that must change its password first", async () => {
    repositories.account.mustChangePassword.add(user.id);

    expect(await deleteAccount(valid)).toMatchObject({ status: 403, body: { code: "password_change_required" } });
    expectUntouched();
  });

  it("refuses a request from another site before reading the session", async () => {
    const response = await callRoute(DELETE, {
      method: "DELETE",
      url: "/api/account",
      body: valid,
      headers: { "sec-fetch-site": "cross-site" },
    });

    expect(response.status).toBe(403);
    expectUntouched();
  });
});
