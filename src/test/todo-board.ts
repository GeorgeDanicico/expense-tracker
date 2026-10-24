import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import { aFamily, aFamilyMember, aKid, aParent } from "@/test/builders";
import type { FakeRepositories } from "@/test/fakes/repositories";
import { signedInAs, testUser } from "@/test/route";

// The family the to-do route tests share: `aParent()` (the creator, `testUser`), a second parent
// and a kid, plus another family's parent.

export const parentUser = testUser;
export const kidUser = { id: "10000000-0000-4000-8000-000000000002", email: "kid@example.test" };
export const outsiderUser = { id: "10000000-0000-4000-8000-000000000009", email: "outsider@example.test" };

export const kidMember = aFamilyMember({ displayName: "Ana", color: 3, avatarUrl: "/api/avatars/kid/a.webp" });
export const secondParentMember = aFamilyMember({
  memberId: "60000000-0000-4000-8000-000000000003",
  userId: "10000000-0000-4000-8000-000000000003",
  role: "parent",
  displayName: "Dana",
  permissions: PARENT_PERMISSIONS,
});
export const otherFamilyId = "70000000-0000-4000-8000-000000000999";
export const otherFamilyMemberId = "60000000-0000-4000-8000-000000000999";

/** Signs `parentUser` in as a parent of the shared family. */
export function asParent(repositories: FakeRepositories) {
  const family = aFamily();
  repositories.family.membership = aParent();
  repositories.family.family = { ...family, members: [...family.members, secondParentMember, kidMember] };
  repositories.family.caller = { userId: parentUser.id, displayName: "owner" };
  return signedInAs(parentUser);
}

/** Signs `kidUser` in as the kid of the shared family. */
export function asKid(repositories: FakeRepositories) {
  asParent(repositories);
  repositories.family.membership = aKid();
  repositories.family.caller = { userId: kidUser.id, displayName: "Ana" };
  return signedInAs(kidUser);
}

/** Signs `outsiderUser` in as a parent of another family, who must never see the shared family's cards. */
export function asOutsider(repositories: FakeRepositories) {
  repositories.family.membership = aParent({ familyId: otherFamilyId, memberId: otherFamilyMemberId, familyName: "The Joneses" });
  repositories.family.family = {
    family: { id: otherFamilyId, name: "The Joneses", createdAt: "2026-10-01T09:00:00.000Z" },
    members: [aFamilyMember({ memberId: otherFamilyMemberId, userId: outsiderUser.id, role: "parent", isCreator: true })],
  };
  repositories.family.caller = { userId: outsiderUser.id, displayName: "outsider" };
  return signedInAs(outsiderUser);
}

/** Signs `outsiderUser` in with no family at all. */
export function asLoner(repositories: FakeRepositories) {
  repositories.family.membership = null;
  repositories.family.family = null;
  repositories.family.caller = { userId: outsiderUser.id, displayName: "loner" };
  return signedInAs(outsiderUser);
}
