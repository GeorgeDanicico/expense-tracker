import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import { PARENT_PERMISSIONS, type FamilyData } from "@/lib/family/repository";
import { aFamily, aFamilyMember, aKid, aParent } from "@/test/builders";
import { FakeAuth, FakeAuthAdmin } from "@/test/fakes/auth";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { loggedLines } from "@/test/log-lines";
import { callRoute, signedInAs } from "@/test/route";

const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));

let auth: FakeAuth;
let admin: FakeAuthAdmin;

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), getAuth: () => auth, getAuthAdmin: () => admin }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { POST } from "@/app/api/family/members/[id]/password/route";

const kidMemberId = "60000000-0000-4000-8000-000000000002";
const secondParentId = "60000000-0000-4000-8000-000000000003";
const newPassword = "brand-new-pass-1";

let repositories: FakeRepositories;
let kidUserId: string;

/** The creator's family with a second parent and a kid. */
function familyWithKid(kidUser: string): FamilyData {
  const family = aFamily();
  return {
    ...family,
    members: [
      ...family.members,
      aFamilyMember({
        memberId: secondParentId,
        userId: "10000000-0000-4000-8000-000000000003",
        role: "parent",
        permissions: PARENT_PERMISSIONS,
      }),
      aFamilyMember({ memberId: kidMemberId, userId: kidUser }),
    ],
  };
}

function resetPassword(id: string, body: unknown) {
  return callRoute(POST, { method: "POST", body, params: { id } });
}

beforeEach(async () => {
  forgetLastActive();
  repositories = resetFakeRepositories();
  auth = new FakeAuth();
  admin = new FakeAuthAdmin(auth);
  signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
  const kid = await admin.createUser({
    email: "kid@kids.ifam.invalid",
    password: "old-password-1",
    username: "kid",
    displayName: "Kid",
    managedByFamily: aParent().familyId,
    mustChangePassword: false,
  });
  kidUserId = kid.id;
  repositories.family.membership = aParent();
  repositories.family.family = familyWithKid(kidUserId);
  repositories.family.accountProfiles = admin.profiles;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/family/members/[id]/password", () => {
  it("answers 404 without any query or password change while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await resetPassword(kidMemberId, { password: newPassword });

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
    expect(auth.accounts[0].password).toBe("old-password-1");
  });

  it("sets the kid's password, makes them choose a new one and signs them out everywhere", async () => {
    const kidSession = auth.openSession({ id: kidUserId, email: "kid@kids.ifam.invalid" });

    const response = await resetPassword(kidMemberId, { password: newPassword });

    expect(response).toMatchObject({ status: 200, body: { success: true } });
    expect(auth.accounts.find((account) => account.id === kidUserId)?.password).toBe(newPassword);
    expect(admin.profiles.get(kidUserId)?.mustChangePassword).toBe(true);
    expect(admin.signedOutUserIds).toEqual([kidUserId]);
    expect(kidSession.ended).toBe(true);
  });

  it("checks the parent first, then sets the password, then the flag, then signs the kid out (audit B12)", async () => {
    const order: string[] = [];
    vi.spyOn(repositories.family, "getMembership").mockImplementation(async () => {
      order.push("check membership");
      return repositories.family.membership;
    });
    const setPassword = admin.setPassword.bind(admin);
    vi.spyOn(admin, "setPassword").mockImplementation(async (...args) => {
      order.push("set password");
      return setPassword(...args);
    });
    const requirePasswordChange = repositories.family.requirePasswordChange.bind(repositories.family);
    vi.spyOn(repositories.family, "requirePasswordChange").mockImplementation(async (id) => {
      order.push("set flag");
      return requirePasswordChange(id);
    });
    const signOutEverywhere = admin.signOutEverywhere.bind(admin);
    vi.spyOn(admin, "signOutEverywhere").mockImplementation(async (id) => {
      order.push("sign out");
      return signOutEverywhere(id);
    });

    await resetPassword(kidMemberId, { password: newPassword });

    expect(order).toEqual(["check membership", "set password", "set flag", "sign out"]);
  });

  it("leaves the kid untouched when setting the password fails: no flag, old password, still signed in", async () => {
    admin.fail("setPassword", new Error("private auth failure"));
    const requirePasswordChange = vi.spyOn(repositories.family, "requirePasswordChange");

    const response = await resetPassword(kidMemberId, { password: newPassword });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to reset the password." } });
    expect(requirePasswordChange).not.toHaveBeenCalled();
    expect(admin.profiles.get(kidUserId)?.mustChangePassword).toBe(false);
    expect(auth.accounts.find((account) => account.id === kidUserId)?.password).toBe("old-password-1");
    expect(admin.calls).toEqual(["setPassword"]);
  });

  it("answers an error, and signs nobody out, when the flag fails after the password was set", async () => {
    vi.spyOn(repositories.family, "requirePasswordChange").mockRejectedValue(new Error("private database failure"));

    const response = await resetPassword(kidMemberId, { password: newPassword });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to reset the password." } });
    // The new password is set; the parent sees the error and resets again, which sets the flag.
    expect(auth.accounts.find((account) => account.id === kidUserId)?.password).toBe(newPassword);
    expect(admin.profiles.get(kidUserId)?.mustChangePassword).toBe(false);
    expect(admin.calls).toEqual(["setPassword"]);

    vi.mocked(repositories.family.requirePasswordChange).mockRestore();
    expect((await resetPassword(kidMemberId, { password: newPassword })).status).toBe(200);
    expect(admin.profiles.get(kidUserId)?.mustChangePassword).toBe(true);
  });

  it("still answers success when the kid can't be signed out, since the password and the flag are set", async () => {
    logged.length = 0;
    admin.fail("signOutEverywhere", new Error("private auth failure"));

    const response = await resetPassword(kidMemberId, { password: newPassword });

    expect(response).toMatchObject({ status: 200, body: { success: true } });
    expect(admin.profiles.get(kidUserId)?.mustChangePassword).toBe(true);
    expect(loggedLines(logged, "kid_sessions_signout_failed")).toEqual([
      expect.objectContaining({ level: "error", memberId: kidMemberId, error: expect.objectContaining({ message: "private auth failure" }) }),
    ]);
    expect(logged.join("")).not.toContain(newPassword);
  });

  it("never returns the password", async () => {
    const response = await resetPassword(kidMemberId, { password: newPassword });

    expect(JSON.stringify(response.body)).not.toContain(newPassword);
  });

  it("refuses to reset a parent's password with 403 and leaves it unchanged", async () => {
    const response = await resetPassword(secondParentId, { password: newPassword });

    expect(response).toMatchObject({ status: 403, body: { error: "Only a kid's password can be reset." } });
    expect(auth.accounts.every((account) => account.password !== newPassword)).toBe(true);
    expect(admin.calls).toEqual([]);
  });

  it("answers 404 for a member outside the caller's family", async () => {
    const setPassword = vi.spyOn(admin, "setPassword");

    const response = await resetPassword("60000000-0000-4000-8000-000000000099", { password: newPassword });

    expect(response).toMatchObject({ status: 404, body: { error: "That family member wasn't found." } });
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("refuses a kid with the one forbidden message and never sets a password", async () => {
    repositories.family.membership = aKid({ memberId: kidMemberId });
    const setPassword = vi.spyOn(admin, "setPassword");

    const response = await resetPassword(kidMemberId, { password: newPassword });

    expect(response).toMatchObject({ status: 403, body: { error: "You don't have access to this." } });
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("refuses a user without a family with 403", async () => {
    repositories.family.membership = null;
    repositories.family.family = null;
    const setPassword = vi.spyOn(admin, "setPassword");

    const response = await resetPassword(kidMemberId, { password: newPassword });

    expect(response.status).toBe(403);
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("rejects a short password with 422 and the field's error", async () => {
    const setPassword = vi.spyOn(admin, "setPassword");

    const response = await resetPassword(kidMemberId, { password: "short" });

    expect(response).toMatchObject({
      status: 422,
      body: {
        error: "Check the password and try again.",
        fieldErrors: { password: ["Password must contain at least 8 characters."] },
      },
    });
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("rejects a malformed member id with 400", async () => {
    const response = await resetPassword("not-a-uuid", { password: newPassword });

    expect(response).toMatchObject({ status: 400, body: { error: "Invalid member identifier." } });
  });

  it("hides an auth admin failure behind a generic message", async () => {
    admin.fail("setPassword", new Error("private auth failure"));

    const response = await resetPassword(kidMemberId, { password: newPassword });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to reset the password." } });
  });
});
