import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import { PARENT_PERMISSIONS, type FamilyData } from "@/lib/family/repository";
import { aFamily, aFamilyMember, aKid, aParent } from "@/test/builders";
import { FakeAuth, FakeAuthAdmin } from "@/test/fakes/auth";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

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

  it("sets the kid's password and makes them choose a new one", async () => {
    const response = await resetPassword(kidMemberId, { password: newPassword });

    expect(response).toMatchObject({ status: 200, body: { success: true } });
    expect(auth.accounts.find((account) => account.id === kidUserId)?.password).toBe(newPassword);
    expect(admin.profiles.get(kidUserId)?.mustChangePassword).toBe(true);
    expect(repositories.family.calls).toEqual(["touchLastActive", "requirePasswordChange"]);
  });

  it("never returns the password", async () => {
    const response = await resetPassword(kidMemberId, { password: newPassword });

    expect(JSON.stringify(response.body)).not.toContain(newPassword);
  });

  it("refuses to reset a parent's password with 403 and leaves it unchanged", async () => {
    const response = await resetPassword(secondParentId, { password: newPassword });

    expect(response).toMatchObject({ status: 403, body: { error: "Only a kid's password can be reset." } });
    expect(auth.accounts.every((account) => account.password !== newPassword)).toBe(true);
  });

  it("answers 404 for a member outside the caller's family", async () => {
    const setPassword = vi.spyOn(admin, "setPassword");

    const response = await resetPassword("60000000-0000-4000-8000-000000000099", { password: newPassword });

    expect(response).toMatchObject({ status: 404, body: { error: "That family member wasn't found." } });
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("refuses a kid with 403 and never sets a password", async () => {
    repositories.family.membership = aKid({ memberId: kidMemberId });
    const setPassword = vi.spyOn(admin, "setPassword");

    const response = await resetPassword(kidMemberId, { password: newPassword });

    expect(response).toMatchObject({ status: 403, body: { error: "Only parents can reset a kid's password." } });
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
