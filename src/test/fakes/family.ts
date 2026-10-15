import type { CurrentMember, FamilyData, FamilyRepository } from "@/lib/family/repository";

/**
 * In-memory `FamilyRepository` for the signed-in caller. Seed `membership` and `family` directly;
 * both start as `null` (no family). `calls` records every method call, so a test can prove that
 * nothing was queried, for example while the family flag is off.
 */
export class FakeFamilyRepository implements FamilyRepository {
  membership: CurrentMember | null = null;
  family: FamilyData | null = null;
  readonly calls: (keyof FamilyRepository)[] = [];

  async getMembership() {
    this.calls.push("getMembership");
    return this.membership;
  }

  async getFamily() {
    this.calls.push("getFamily");
    return this.family;
  }
}
