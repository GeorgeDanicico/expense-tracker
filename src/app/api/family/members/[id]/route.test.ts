import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import { PARENT_PERMISSIONS, type FamilyData } from "@/lib/family/repository";
import { aFamily, aFamilyMember, aKid, aParent } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { DELETE } from "@/app/api/family/members/[id]/route";

const creatorId = "60000000-0000-4000-8000-000000000001";
const kidId = "60000000-0000-4000-8000-000000000002";
const secondParentId = "60000000-0000-4000-8000-000000000003";

let repositories: FakeRepositories;

/** The creator's family with a kid and a second parent. */
function familyWithMembers(): FamilyData {
  const family = aFamily();
  return {
    ...family,
    members: [
      ...family.members,
      aFamilyMember({ memberId: kidId }),
      aFamilyMember({
        memberId: secondParentId,
        userId: "10000000-0000-4000-8000-000000000003",
        role: "parent",
        permissions: PARENT_PERMISSIONS,
      }),
    ],
  };
}

function removeMember(id: string) {
  return callRoute(DELETE, { method: "DELETE", params: { id } });
}

function memberIds() {
  return repositories.family.family?.members.map((member) => member.memberId);
}

beforeEach(() => {
  forgetLastActive();
  repositories = resetFakeRepositories();
  signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
  repositories.family.membership = aParent();
  repositories.family.family = familyWithMembers();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DELETE /api/family/members/[id]", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await removeMember(kidId);

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
  });

  it("lets the creator remove a kid, answering 204 with no body", async () => {
    const response = await removeMember(kidId);

    expect(response).toMatchObject({ status: 204, body: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(memberIds()).toEqual([creatorId, secondParentId]);
    expect(repositories.family.calls).toEqual(["touchLastActive", "removeMember"]);
  });

  it("lets the creator remove another parent", async () => {
    const response = await removeMember(secondParentId);

    expect(response.status).toBe(204);
    expect(memberIds()).toEqual([creatorId, kidId]);
  });

  it("refuses a parent who isn't the creator with 403", async () => {
    repositories.family.membership = aParent({ memberId: secondParentId, isCreator: false });

    const response = await removeMember(kidId);

    expect(response).toMatchObject({ status: 403, body: { error: "Only the family's creator can remove members." } });
    expect(memberIds()).toEqual([creatorId, kidId, secondParentId]);
  });

  it("refuses a kid with 403", async () => {
    repositories.family.membership = aKid({ memberId: kidId });

    const response = await removeMember(secondParentId);

    expect(response.status).toBe(403);
    expect(memberIds()).toEqual([creatorId, kidId, secondParentId]);
  });

  it("refuses to let the creator remove themselves with 403", async () => {
    const response = await removeMember(creatorId);

    expect(response).toMatchObject({
      status: 403,
      body: { error: "You can't remove yourself from a family you created. Delete the family instead." },
    });
    expect(memberIds()).toEqual([creatorId, kidId, secondParentId]);
  });

  it("answers 404 for a member outside the caller's family", async () => {
    const response = await removeMember("60000000-0000-4000-8000-000000000099");

    expect(response).toMatchObject({ status: 404, body: { error: "That family member wasn't found." } });
  });

  it("rejects an identifier that isn't a UUID with 400, without any query", async () => {
    const response = await removeMember("not-a-uuid");

    expect(response).toMatchObject({ status: 400, body: { error: "Invalid member identifier." } });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.family, "removeMember").mockRejectedValue(new Error("private database failure"));

    const response = await removeMember(kidId);

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to remove the member." } });
  });
});
