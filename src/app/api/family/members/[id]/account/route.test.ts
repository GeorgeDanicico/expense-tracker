import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETION_REFUSALS } from "@/lib/account/data-repository";
import { WRONG_CURRENT_PASSWORD } from "@/lib/account/password-change";
import { forgetLastActive } from "@/lib/family/last-active";
import { PARENT_PERMISSIONS, type FamilyData } from "@/lib/family/repository";
import { FORBIDDEN_MESSAGE } from "@/lib/http/permission";
import { resetRateLimits } from "@/lib/http/rate-limit";
import { aFamily, aFamilyMember, aKid, aParent } from "@/test/builders";
import { FakeAuth, FakeAuthAdmin } from "@/test/fakes/auth";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

let auth: FakeAuth;
let admin: FakeAuthAdmin;
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), getAuth: () => auth, getAuthAdmin: () => admin }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { DELETE } from "@/app/api/family/members/[id]/account/route";

// `DELETE /api/family/members/[id]/account` (security plan S13): a parent deletes a kid account made
// for their family. The database's rules are tested in supabase/tests/account_deletion.sql.

const PARENT_PASSWORD = "parent-password-1";
const KID_PASSWORD = "kid-password-1";
const kidMemberId = "60000000-0000-4000-8000-000000000002";
const ownKidMemberId = "60000000-0000-4000-8000-000000000004";
const secondParentMemberId = "60000000-0000-4000-8000-000000000003";

let repositories: FakeRepositories;
let kidUserId: string;

/** The creator's family with a second parent, a managed kid ("Mia") and a kid who joined with their own account. */
function family(kidUser: string): FamilyData {
  const base = aFamily();
  return {
    ...base,
    members: [
      ...base.members,
      aFamilyMember({ memberId: secondParentMemberId, userId: "10000000-0000-4000-8000-000000000003", role: "parent", permissions: PARENT_PERMISSIONS }),
      aFamilyMember({ memberId: kidMemberId, userId: kidUser, displayName: "Mia", username: "mia" }),
      aFamilyMember({ memberId: ownKidMemberId, userId: "10000000-0000-4000-8000-000000000004", displayName: "Leo", username: null }),
    ],
  };
}

beforeEach(async () => {
  resetRateLimits();
  forgetLastActive();
  repositories = resetFakeRepositories();
  auth = new FakeAuth();
  admin = new FakeAuthAdmin(auth);
  const parent = auth.addUser("parent@example.test", PARENT_PASSWORD);
  signedInAs(parent);
  auth.currentUser = parent;
  const kid = await admin.createUser({
    email: "mia@kids.ifam.invalid",
    password: KID_PASSWORD,
    username: "mia",
    displayName: "Mia",
    managedByFamily: aParent().familyId,
    mustChangePassword: false,
  });
  kidUserId = kid.id;
  repositories.family.membership = aParent();
  repositories.family.family = family(kidUserId);
  repositories.family.accountProfiles = admin.profiles;
  repositories.accountData.exports.set(kidUserId, { expenses: [{ id: "e1", description: "Comic" }] });
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function deleteKid(id: string, body: unknown) {
  return callRoute(DELETE, { method: "DELETE", body, params: { id } });
}

const valid = { currentPassword: PARENT_PASSWORD, confirmName: "Mia" };

function expectKidUntouched() {
  expect(repositories.accountData.deleted).toEqual([]);
  expect(repositories.accountData.exports.get(kidUserId)?.expenses).toHaveLength(1);
  expect(admin.deletedUserIds).toEqual([]);
  expect(auth.accounts.some((account) => account.id === kidUserId)).toBe(true);
}

describe("DELETE /api/family/members/[id]/account", () => {
  it("checks the parent's password, deletes the kid's data, then the kid's account, and answers with the family", async () => {
    const kidSession = auth.openSession({ id: kidUserId, email: "mia@kids.ifam.invalid" });

    const response = await deleteKid(kidMemberId, valid);

    expect(response).toMatchObject({ status: 200, body: { family: { family: { name: "The Smiths" } } } });
    expect(auth.verifiedEmails).toEqual(["parent@example.test"]);
    expect(repositories.accountData.deleted).toEqual([kidUserId]);
    expect(admin.deletedUserIds).toEqual([kidUserId]);
    expect(kidSession.ended).toBe(true);
    expect(await auth.signInWithPassword("mia@kids.ifam.invalid", KID_PASSWORD)).toMatchObject({ ok: false });
    // The parent stays signed in.
    expect(auth.signOutScopes).toEqual([]);
  });

  it("lets a second parent delete the kid too", async () => {
    repositories.family.membership = aParent({ isCreator: false, memberId: secondParentMemberId });

    expect((await deleteKid(kidMemberId, { ...valid, confirmName: " mia " })).status).toBe(200);
    expect(admin.deletedUserIds).toEqual([kidUserId]);
  });

  it("refuses a kid before anything runs", async () => {
    repositories.family.membership = aKid();

    expect(await deleteKid(kidMemberId, valid)).toMatchObject({ status: 403, body: { error: FORBIDDEN_MESSAGE } });
    expect(auth.verifiedEmails).toEqual([]);
    expectKidUntouched();
  });

  it("refuses a user without a family", async () => {
    repositories.family.membership = null;

    expect(await deleteKid(kidMemberId, valid)).toMatchObject({ status: 403, body: { error: FORBIDDEN_MESSAGE } });
    expectKidUntouched();
  });

  it("refuses a wrong parent password on currentPassword", async () => {
    const response = await deleteKid(kidMemberId, { ...valid, currentPassword: "wrong-password" });

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { currentPassword: [WRONG_CURRENT_PASSWORD] } } });
    expectKidUntouched();
  });

  it("refuses the wrong name", async () => {
    expect(await deleteKid(kidMemberId, { ...valid, confirmName: "Leo" })).toMatchObject({
      status: 422,
      body: { error: DELETION_REFUSALS.kidName },
    });
    expectKidUntouched();
  });

  it("asks for the name", async () => {
    expect(await deleteKid(kidMemberId, { currentPassword: PARENT_PASSWORD })).toMatchObject({
      status: 422,
      body: { fieldErrors: { confirmName: [DELETION_REFUSALS.kidName] } },
    });
    expect(auth.verifiedEmails).toEqual([]);
  });

  it.each([
    ["a kid who joined with their own account", ownKidMemberId, "Leo"],
    ["another parent", secondParentMemberId, "kid"],
  ])("refuses %s: the creator removes them instead", async (_, memberId, name) => {
    expect(await deleteKid(memberId, { ...valid, confirmName: name })).toMatchObject({
      status: 403,
      body: { error: DELETION_REFUSALS.notManagedKid },
    });
    expectKidUntouched();
  });

  it("answers 404 for a member who isn't in the family", async () => {
    expect((await deleteKid("60000000-0000-4000-8000-0000000000ff", valid)).status).toBe(404);
    expectKidUntouched();
  });

  it("answers 400 for an id that isn't one", async () => {
    expect((await deleteKid("not-an-id", valid)).status).toBe(400);
    expectKidUntouched();
  });

  it("keeps the kid in the family when the account can't be deleted, so the parent can delete again", async () => {
    admin.fail("deleteUser");

    expect((await deleteKid(kidMemberId, valid)).status).toBe(500);
    expect(repositories.accountData.deleted).toEqual([kidUserId]);
    expect(repositories.family.family?.members.some((member) => member.memberId === kidMemberId)).toBe(true);

    expect((await deleteKid(kidMemberId, valid)).status).toBe(200);
    expect(admin.deletedUserIds).toEqual([kidUserId]);
  });

  it("answers 404 while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    expect((await deleteKid(kidMemberId, valid)).status).toBe(404);
    expectKidUntouched();
  });
});
