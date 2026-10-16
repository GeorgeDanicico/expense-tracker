import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import { DomainError } from "@/lib/errors";
import { PARENT_PERMISSIONS, type FamilyData } from "@/lib/family/repository";
import { PERMISSION_PRESETS } from "@/lib/permissions";
import { aFamily, aFamilyMember, aKid, aParent } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { PATCH } from "@/app/api/family/members/[id]/permissions/route";

const kidId = "60000000-0000-4000-8000-000000000002";
const secondParentId = "60000000-0000-4000-8000-000000000003";
const teen = PERMISSION_PRESETS.teen;

let repositories: FakeRepositories;

/** The creator's family with a kid (default kid permissions) and a second parent. */
function familyWithKid(): FamilyData {
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
      aFamilyMember({ memberId: kidId }),
    ],
  };
}

function setPermissions(id: string, body: unknown) {
  return callRoute(PATCH, { method: "PATCH", body, params: { id } });
}

function kidPermissions() {
  return repositories.family.family?.members.find((member) => member.memberId === kidId)?.permissions;
}

beforeEach(() => {
  forgetLastActive();
  repositories = resetFakeRepositories();
  signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
  repositories.family.membership = aParent();
  repositories.family.family = familyWithKid();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PATCH /api/family/members/[id]/permissions", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await setPermissions(kidId, { permissions: teen });

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
  });

  it("replaces a kid's permissions and returns the updated family", async () => {
    const response = await setPermissions(kidId, { permissions: teen });

    expect(response.status).toBe(200);
    expect(kidPermissions()).toEqual(teen);
    expect(response.body).toEqual({ family: repositories.family.family });
    expect(repositories.family.calls).toEqual(["touchLastActive", "setMemberPermissions", "getFamily"]);
  });

  it("lets a parent who isn't the creator change a kid's permissions", async () => {
    repositories.family.membership = aParent({ memberId: secondParentId, isCreator: false });

    const response = await setPermissions(kidId, { permissions: teen });

    expect(response.status).toBe(200);
    expect(kidPermissions()).toEqual(teen);
  });

  it("refuses a kid with 403", async () => {
    repositories.family.membership = aKid({ memberId: kidId });

    const response = await setPermissions(kidId, { permissions: teen });

    expect(response).toMatchObject({ status: 403, body: { error: "Only parents can change a kid's permissions." } });
    expect(kidPermissions()).toEqual(PERMISSION_PRESETS.young_kid);
  });

  it("refuses to change a parent's permissions with 403", async () => {
    const response = await setPermissions(secondParentId, { permissions: teen });

    expect(response).toMatchObject({
      status: 403,
      body: { error: "Parents always have full access, so their permissions can't be changed." },
    });
  });

  it("answers 404 for a member outside the caller's family", async () => {
    const response = await setPermissions("60000000-0000-4000-8000-000000000099", { permissions: teen });

    expect(response).toMatchObject({ status: 404, body: { error: "That family member wasn't found." } });
  });

  it("rejects an identifier that isn't a UUID with 400, without any query", async () => {
    const response = await setPermissions("not-a-uuid", { permissions: teen });

    expect(response).toMatchObject({ status: 400, body: { error: "Invalid member identifier." } });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("rejects a level the module doesn't allow with 422, without any query", async () => {
    const response = await setPermissions(kidId, { permissions: { ...teen, investments: "view" } });

    expect(response).toMatchObject({ status: 422, body: { error: "Check the permissions and try again." } });
    expect(response.body.fieldErrors.permissions).toBeDefined();
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("rejects permissions missing a module with 422", async () => {
    const { expenses, investments, net_worth } = teen;

    const response = await setPermissions(kidId, { permissions: { expenses, investments, net_worth } });

    expect(response.status).toBe(422);
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("rejects a missing or malformed body with 422", async () => {
    const response = await setPermissions(kidId, "{");

    expect(response).toMatchObject({ status: 422, body: { error: "Check the permissions and try again." } });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("passes on the database's invalid-permissions refusal as 422", async () => {
    vi.spyOn(repositories.family, "setMemberPermissions").mockRejectedValue(
      new DomainError("Choose an allowed level for every module.", 422),
    );

    const response = await setPermissions(kidId, { permissions: teen });

    expect(response).toMatchObject({ status: 422, body: { error: "Choose an allowed level for every module." } });
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.family, "setMemberPermissions").mockRejectedValue(new Error("private database failure"));

    const response = await setPermissions(kidId, { permissions: teen });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to save the permissions." } });
  });

  it("answers 500 when the family can't be read back", async () => {
    vi.spyOn(repositories.family, "getFamily").mockResolvedValue(null);

    const response = await setPermissions(kidId, { permissions: teen });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to save the permissions." } });
  });
});
