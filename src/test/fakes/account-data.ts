import {
  DELETE_ACCOUNT_PHRASE,
  DELETION_REFUSALS,
  type AccountDataRepository,
  type ExportRow,
  type ExportSection,
} from "@/lib/account/data-repository";
import { DomainError } from "@/lib/errors";

import type { FakeFamilyRepository } from "./family";

/** Like the SQL: surrounding whitespace dropped, case ignored. */
function same(typed: string, expected: string) {
  return typed.trim().toLowerCase() === expected.toLowerCase();
}

/**
 * In-memory `AccountDataRepository` for the caller the family fake describes (`family.membership`,
 * `family.family`, and `family.accountProfiles` for which accounts a family manages). Seed each
 * user's export in `exports`; the deletions follow the SQL's rules and messages, empty that user's
 * export and record the user id in `deleted`. `failSection` makes reading that section throw, like a
 * failed RPC. `caller` is the signed-in user (`testUser` from `@/test/route` by default).
 */
export class FakeAccountDataRepository implements AccountDataRepository {
  readonly exports = new Map<string, Partial<Record<ExportSection, ExportRow[]>>>();
  readonly deleted: string[] = [];
  /** The sections read, in order. */
  readonly sectionsRead: ExportSection[] = [];
  failSection: ExportSection | null = null;
  caller = { userId: "10000000-0000-4000-8000-000000000001" };

  constructor(private readonly family: FakeFamilyRepository) {}

  async deleteMyData(confirm: string) {
    if (!same(confirm, DELETE_ACCOUNT_PHRASE)) throw new DomainError(DELETION_REFUSALS.phrase, 422);
    const membership = this.family.membership;
    if (membership?.isCreator) throw new DomainError(DELETION_REFUSALS.creator, 409);
    if (membership) {
      if (this.family.accountProfiles.get(this.caller.userId)?.managedByFamily === membership.familyId) {
        throw new DomainError(DELETION_REFUSALS.managed, 403);
      }
      throw new DomainError(DELETION_REFUSALS.member, 409);
    }
    this.exports.delete(this.caller.userId);
    this.deleted.push(this.caller.userId);
  }

  async deleteManagedKidData(memberId: string, confirmName: string) {
    const parent = this.family.membership;
    if (parent?.role !== "parent") throw new DomainError(DELETION_REFUSALS.notParent, 403);
    const target = this.family.family?.members.find((member) => member.memberId === memberId);
    if (!target) throw new DomainError("That family member wasn't found.", 404);
    if (target.role !== "kid" || this.family.accountProfiles.get(target.userId)?.managedByFamily !== parent.familyId) {
      throw new DomainError(DELETION_REFUSALS.notManagedKid, 403);
    }
    const name = target.displayName ?? target.username;
    if (name === null || !same(confirmName, name)) throw new DomainError(DELETION_REFUSALS.kidName, 422);
    this.exports.delete(target.userId);
    this.deleted.push(target.userId);
    return target.userId;
  }

  async openExport() {
    const userId = this.caller.userId;
    return {
      section: async (section: ExportSection) => {
        this.sectionsRead.push(section);
        if (this.failSection === section) throw new Error("Unable to prepare your data. Please try again.");
        return this.exports.get(userId)?.[section] ?? [];
      },
    };
  }
}
