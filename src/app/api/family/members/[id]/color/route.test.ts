import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import { DomainError } from "@/lib/errors";
import { PARENT_PERMISSIONS, type FamilyData } from "@/lib/family/repository";
import { aFamily, aFamilyMember, aKid, aParent } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { PATCH } from "@/app/api/family/members/[id]/color/route";

const kidId = "60000000-0000-4000-8000-000000000002";
const secondParentId = "60000000-0000-4000-8000-000000000003";

let repositories: FakeRepositories;

/** The creator's family with a kid and a second parent, who already has colour 2. */
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
        color: 2,
      }),
      aFamilyMember({ memberId: kidId }),
    ],
  };
}

function setColor(id: string, body: unknown) {
  return callRoute(PATCH, { method: "PATCH", body, params: { id } });
}

function colorOf(memberId: string) {
  return repositories.family.family?.members.find((member) => member.memberId === memberId)?.color;
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

describe("PATCH /api/family/members/[id]/color", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await setColor(kidId, { color: 3 });

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
  });

  it("sets a member's colour and returns the updated family", async () => {
    const response = await setColor(kidId, { color: 3 });

    expect(response.status).toBe(200);
    expect(colorOf(kidId)).toBe(3);
    expect(response.body).toEqual({ family: repositories.family.family });
    expect(repositories.family.calls).toEqual(["touchLastActive", "setMemberColor", "getFamily"]);
  });

  it("resets a member to automatic with null", async () => {
    await setColor(kidId, { color: 3 });

    const response = await setColor(kidId, { color: null });

    expect(response.status).toBe(200);
    expect(colorOf(kidId)).toBeNull();
  });

  it("refuses a kid with 403", async () => {
    repositories.family.membership = aKid({ memberId: kidId });

    const response = await setColor(kidId, { color: 3 });

    expect(response).toMatchObject({ status: 403, body: { error: "Only parents can choose member colours." } });
    expect(colorOf(kidId)).toBeNull();
  });

  it("answers 404 for a member outside the caller's family", async () => {
    const response = await setColor("60000000-0000-4000-8000-000000000099", { color: 3 });

    expect(response).toMatchObject({ status: 404, body: { error: "That family member wasn't found." } });
  });

  it("answers 409 when another member already has the colour", async () => {
    const response = await setColor(kidId, { color: 2 });

    expect(response).toMatchObject({ status: 409, body: { error: "Another family member already has that colour." } });
    expect(colorOf(kidId)).toBeNull();
  });

  it("rejects an identifier that isn't a UUID with 400, without any query", async () => {
    const response = await setColor("not-a-uuid", { color: 3 });

    expect(response).toMatchObject({ status: 400, body: { error: "Invalid member identifier." } });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it.each([0, 9, 1.5, "3", undefined])("rejects the colour %s with 422, without any query", async (color) => {
    const response = await setColor(kidId, { color });

    expect(response).toMatchObject({ status: 422, body: { error: "Choose one of the eight colours." } });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("rejects a missing or malformed body with 422", async () => {
    const response = await setColor(kidId, "{");

    expect(response).toMatchObject({ status: 422, body: { error: "Choose one of the eight colours." } });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.family, "setMemberColor").mockRejectedValue(new Error("private database failure"));

    const response = await setColor(kidId, { color: 3 });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to save the colour." } });
  });

  it("passes on the database's clash as 409", async () => {
    vi.spyOn(repositories.family, "setMemberColor").mockRejectedValue(
      new DomainError("Another family member already has that colour.", 409),
    );

    const response = await setColor(kidId, { color: 3 });

    expect(response.status).toBe(409);
  });

  it("answers 500 when the family can't be read back", async () => {
    vi.spyOn(repositories.family, "getFamily").mockResolvedValue(null);

    const response = await setColor(kidId, { color: 3 });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to save the colour." } });
  });
});
