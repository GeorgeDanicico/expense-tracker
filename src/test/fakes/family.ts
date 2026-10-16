import { randomUUID } from "node:crypto";

import { DomainError } from "@/lib/errors";
import {
  PARENT_PERMISSIONS,
  type CurrentMember,
  type FamilyData,
  type FamilyInvite,
  type FamilyRepository,
  type InvitePreview,
  type NewInvite,
} from "@/lib/family/repository";
import { FAMILY_ROLES, MODULE_KEYS, isLevelAllowed, type PermissionLevel, type Permissions } from "@/lib/permissions";

import type { FakeAdminProfile } from "./auth";

/** An invite as the fake stores it: what `listInvites()` shows, plus what only the database knows. */
export type FakeInvite = FamilyInvite & {
  familyId: string;
  /** The name of the invite's family, which `previewInvite` shows and `redeemInvite` joins. */
  familyName: string;
  codeHash: string;
  usedAt: string | null;
  revokedAt: string | null;
};

const CODE_HASH_PATTERN = /^[0-9a-f]{64}$/;
const PARENT_INVITE_HOURS = 48;
const KID_INVITE_HOURS = 7 * 24;

/** Like `family_private.is_valid_permissions`: exactly the catalogue's modules, each at a level it allows. */
function isValidPermissions(permissions: Permissions) {
  const keys = Object.keys(permissions).sort();
  return (
    keys.join() === [...MODULE_KEYS].sort().join() &&
    MODULE_KEYS.every((module) => isLevelAllowed(module, permissions[module] as PermissionLevel))
  );
}

/**
 * In-memory `FamilyRepository` for the signed-in caller. Seed `membership` and `family` directly;
 * both start as `null` (no family). `membership` says who the caller is (role, creator); the members
 * of `family` are who they can act on. The write methods follow the SQL's rules and messages. `calls` records every method call, so a test can prove that
 * nothing was queried, for example while the family flag is off. `invites` holds every invite of
 * every family; the invite methods act on the family of `membership`, and only for a parent, like the SQL.
 */
export class FakeFamilyRepository implements FamilyRepository {
  membership: CurrentMember | null = null;
  family: FamilyData | null = null;
  /** Who the caller is, for the member entry `createFamily` adds. Defaults to `testUser` from `@/test/route`. */
  caller = { userId: "10000000-0000-4000-8000-000000000001", displayName: "owner" as string | null };
  invites: FakeInvite[] = [];
  /**
   * The accounts' kid-account profile columns, by user id, which `addManagedKid` checks like
   * `add_managed_kid` does. Share `FakeAuthAdmin`'s map so accounts it creates are found:
   * `repositories.family.accountProfiles = admin.profiles`.
   */
  accountProfiles: ReadonlyMap<string, FakeAdminProfile> = new Map();
  readonly calls: (keyof FamilyRepository)[] = [];

  /** The caller's family id when they are a parent; otherwise throws the SQL's 403. */
  private parentFamilyId(message: string) {
    if (this.membership?.role !== "parent") throw new DomainError(message, 403);
    return this.membership.familyId;
  }

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

  /** Like `set_member_permissions`: parents only, on kids of their family. */
  async setMemberPermissions(memberId: string, permissions: Permissions) {
    this.calls.push("setMemberPermissions");
    if (this.membership?.role !== "parent") {
      throw new DomainError("Only parents can change a kid's permissions.", 403);
    }
    const target = this.findMember(memberId);
    if (target.role !== "kid") {
      throw new DomainError("Parents always have full access, so their permissions can't be changed.", 403);
    }
    if (!isValidPermissions(permissions)) throw new DomainError("Choose an allowed level for every module.", 422);

    this.replaceMembers((members) =>
      members.map((member) => (member.memberId === memberId ? { ...member, permissions: { ...permissions } } : member)),
    );
  }

  /**
   * Like `add_managed_kid`: parents only, for an account in `accountProfiles` marked for the caller's
   * family that has no membership yet. Adds the kid to `family` (when seeded) with its profile's names.
   */
  async addManagedKid(userId: string, permissions: Permissions) {
    this.calls.push("addManagedKid");
    if (this.membership?.role !== "parent") throw new DomainError("Only parents can add a kid.", 403);
    const profile = this.accountProfiles.get(userId);
    if (!profile || profile.managedByFamily !== this.membership.familyId) {
      throw new DomainError("That account wasn't found.", 404);
    }
    if (this.family?.members.some((member) => member.userId === userId)) {
      throw new DomainError("That account is already in a family.", 409);
    }
    if (!isValidPermissions(permissions)) throw new DomainError("Choose an allowed level for every module.", 422);

    const memberId = randomUUID();
    this.replaceMembers((members) => [
      ...members,
      {
        memberId,
        userId,
        role: "kid",
        isCreator: false,
        displayName: profile.displayName,
        username: profile.username,
        joinedAt: new Date().toISOString(),
        lastActiveAt: null,
        permissions: { ...permissions },
      },
    ]);
    return memberId;
  }

  /** Like `remove_family_member`: the creator only, never on themselves. */
  async removeMember(memberId: string) {
    this.calls.push("removeMember");
    if (!this.membership?.isCreator) throw new DomainError("Only the family's creator can remove members.", 403);
    this.findMember(memberId);
    if (memberId === this.membership.memberId) {
      throw new DomainError("You can't remove yourself from a family you created. Delete the family instead.", 403);
    }

    this.replaceMembers((members) => members.filter((member) => member.memberId !== memberId));
  }

  /** Like `delete_family`: the creator only, after typing the name (case and surrounding spaces ignored). */
  async deleteFamily(confirmName: string) {
    this.calls.push("deleteFamily");
    if (!this.membership?.isCreator) throw new DomainError("Only the family's creator can delete the family.", 403);
    const name = this.family?.family.name ?? this.membership.familyName;
    if (confirmName.trim().toLowerCase() !== name.toLowerCase()) {
      throw new DomainError("Type the family's name to confirm.", 422);
    }

    this.membership = null;
    this.family = null;
  }

  /** Only records the call; `family` is left as the test seeded it. */
  async touchLastActive() {
    this.calls.push("touchLastActive");
  }

  /** Like `create_family_invite`: parents only, the SQL's validation, and a 409 for a hash already in use. */
  async createInvite({ role, permissions, codeHash }: NewInvite) {
    this.calls.push("createInvite");
    const familyId = this.parentFamilyId("Only parents can invite people to the family.");
    if (!FAMILY_ROLES.includes(role)) throw new DomainError("Choose whether to invite a parent or a kid.", 422);
    if (role === "parent" && permissions !== null) {
      throw new DomainError("Parents always have full access, so a parent invite can't have permissions.", 422);
    }
    if (role === "kid" && !isValidPermissions(permissions)) {
      throw new DomainError("Choose an allowed level for every module.", 422);
    }
    this.checkCodeHash(codeHash);
    if (this.invites.some((invite) => invite.codeHash === codeHash)) {
      throw new DomainError("That invite code is already in use.", 409);
    }

    const now = Date.now();
    const hours = role === "parent" ? PARENT_INVITE_HOURS : KID_INVITE_HOURS;
    const invite: FakeInvite = {
      inviteId: randomUUID(),
      familyId,
      familyName: this.membership?.familyName ?? "",
      codeHash,
      role,
      permissions,
      createdByName: this.caller.displayName,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + hours * 60 * 60 * 1000).toISOString(),
      usedAt: null,
      revokedAt: null,
    };
    this.invites.push(invite);
    return { inviteId: invite.inviteId, expiresAt: invite.expiresAt };
  }

  /** Like `list_family_invites`: parents only; the family's unused, unrevoked, unexpired invites, newest first. */
  async listInvites() {
    this.calls.push("listInvites");
    const familyId = this.parentFamilyId("Only parents can see the family's invites.");
    const now = Date.now();

    return this.invites
      .filter((invite) => invite.familyId === familyId && !invite.usedAt && !invite.revokedAt)
      .filter((invite) => Date.parse(invite.expiresAt) > now)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(
        ({ inviteId, role, permissions, createdByName, createdAt, expiresAt }): FamilyInvite => ({
          inviteId,
          role,
          permissions,
          createdByName,
          createdAt,
          expiresAt,
        }),
      );
  }

  /** Like `revoke_family_invite`: parents only, 404 outside the family; used or revoked invites stay as they are. */
  async revokeInvite(inviteId: string) {
    this.calls.push("revokeInvite");
    const familyId = this.parentFamilyId("Only parents can revoke invites.");
    const invite = this.invites.find((candidate) => candidate.inviteId === inviteId && candidate.familyId === familyId);
    if (!invite) throw new DomainError("That invite wasn't found.", 404);
    if (!invite.usedAt && !invite.revokedAt) invite.revokedAt = new Date().toISOString();
  }

  /**
   * Like `preview_family_invite`: the invite with `codeHash` when it can be redeemed, else `null`
   * without saying why. Works for callers already in a family. (The fake doesn't model an invite
   * whose creator is no longer a parent; mark such an invite revoked instead.)
   */
  async previewInvite(codeHash: string): Promise<InvitePreview | null> {
    this.calls.push("previewInvite");
    this.checkCodeHash(codeHash);
    const invite = this.redeemableInvite(codeHash);
    if (!invite) return null;

    return {
      familyName: invite.familyName,
      inviterName: invite.createdByName,
      role: invite.role,
      permissions: invite.permissions,
      expiresAt: invite.expiresAt,
    };
  }

  /**
   * Like `redeem_family_invite`: refuses a caller already in a family (409), then a code that can't
   * be redeemed (404); else makes the caller a member with the invite's role and permissions, marks
   * the invite used, and returns the new member id. Afterwards `family` holds the invite's family
   * with only the caller's own entry, since the fake doesn't know its other members.
   */
  async redeemInvite(codeHash: string) {
    this.calls.push("redeemInvite");
    this.checkCodeHash(codeHash);
    if (this.membership || this.family) throw new DomainError("You're already in a family.", 409);
    const invite = this.redeemableInvite(codeHash);
    if (!invite) throw new DomainError("This code isn't valid anymore.", 404);

    const memberId = randomUUID();
    const joinedAt = new Date().toISOString();
    const permissions = invite.role === "kid" && invite.permissions ? { ...invite.permissions } : PARENT_PERMISSIONS;

    this.membership = {
      memberId,
      familyId: invite.familyId,
      familyName: invite.familyName,
      role: invite.role,
      isCreator: false,
      permissions,
    };
    this.family = {
      family: { id: invite.familyId, name: invite.familyName, createdAt: invite.createdAt },
      members: [
        {
          memberId,
          userId: this.caller.userId,
          role: invite.role,
          isCreator: false,
          displayName: this.caller.displayName,
          username: null,
          joinedAt,
          lastActiveAt: null,
          permissions,
        },
      ],
    };
    invite.usedAt = joinedAt;
    return memberId;
  }

  /** The SQL's 422 for a hash that isn't 64 lowercase hex characters. */
  private checkCodeHash(codeHash: string) {
    if (!CODE_HASH_PATTERN.test(codeHash)) throw new DomainError("The invite code is not valid.", 422);
  }

  /** Like `family_private.is_invite_redeemable`: unused, unrevoked, unexpired, and a kid's permissions still valid. */
  private redeemableInvite(codeHash: string) {
    return this.invites.find(
      (invite) =>
        invite.codeHash === codeHash &&
        !invite.usedAt &&
        !invite.revokedAt &&
        Date.parse(invite.expiresAt) > Date.now() &&
        (invite.role === "parent" || (invite.permissions !== null && isValidPermissions(invite.permissions))),
    );
  }

  /** A member of the caller's family, or the SQL's 404 (unknown and other-family members look the same). */
  private findMember(memberId: string) {
    const member = this.family?.members.find((candidate) => candidate.memberId === memberId);
    if (!member) throw new DomainError("That family member wasn't found.", 404);
    return member;
  }

  private replaceMembers(update: (members: FamilyData["members"]) => FamilyData["members"]) {
    if (this.family) this.family = { ...this.family, members: update(this.family.members) };
  }
}
