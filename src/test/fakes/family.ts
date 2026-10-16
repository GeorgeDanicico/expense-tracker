import { randomUUID } from "node:crypto";

import { DomainError } from "@/lib/errors";
import {
  PARENT_PERMISSIONS,
  type CurrentMember,
  type FamilyData,
  type FamilyRepository,
} from "@/lib/family/repository";

/**
 * In-memory `FamilyRepository` for the signed-in caller. Seed `membership` and `family` directly;
 * both start as `null` (no family). `calls` records every method call, so a test can prove that
 * nothing was queried, for example while the family flag is off.
 */
export class FakeFamilyRepository implements FamilyRepository {
  membership: CurrentMember | null = null;
  family: FamilyData | null = null;
  /** Who the caller is, for the member entry `createFamily` adds. Defaults to `testUser` from `@/test/route`. */
  caller = { userId: "10000000-0000-4000-8000-000000000001", displayName: "owner" as string | null };
  readonly calls: (keyof FamilyRepository)[] = [];

  async getMembership() {
    this.calls.push("getMembership");
    return this.membership;
  }

  async getFamily() {
    this.calls.push("getFamily");
    return this.family;
  }

  /** Like `create_family`: refuses a caller who is already in a family, else makes them its creator and parent. */
  async createFamily(name: string) {
    this.calls.push("createFamily");
    if (this.membership || this.family) throw new DomainError("You're already in a family.", 409);

    const familyId = randomUUID();
    const memberId = randomUUID();
    const familyName = name.trim();
    const createdAt = new Date().toISOString();

    this.membership = {
      memberId,
      familyId,
      familyName,
      role: "parent",
      isCreator: true,
      permissions: PARENT_PERMISSIONS,
    };
    this.family = {
      family: { id: familyId, name: familyName, createdAt },
      members: [
        {
          memberId,
          userId: this.caller.userId,
          role: "parent",
          isCreator: true,
          displayName: this.caller.displayName,
          username: null,
          joinedAt: createdAt,
          lastActiveAt: null,
          permissions: PARENT_PERMISSIONS,
        },
      ],
    };
    return familyId;
  }

  /** Only records the call; `family` is left as the test seeded it. */
  async touchLastActive() {
    this.calls.push("touchLastActive");
  }
}
