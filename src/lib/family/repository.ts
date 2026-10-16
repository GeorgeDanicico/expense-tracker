import type { FamilyRole, Permissions } from "@/lib/permissions";

/**
 * A parent's permissions: the highest level each module allows. Parents have no stored permissions
 * and pass every check (`can()` returns true for the `parent` role before it reads `permissions`),
 * so this is never used to decide access. It keeps `permissions` a full `Permissions` object for
 * every member, so callers never branch on null. `role` is what tells a parent from a kid.
 */
export const PARENT_PERMISSIONS: Permissions = {
  expenses: "edit",
  investments: "edit",
  net_worth: "edit",
  family_finance: "view",
};

/**
 * The signed-in user's membership. Pass it straight to `can()`.
 * `permissions` has every module: a kid's stored levels (missing ones are `off`), or
 * `PARENT_PERMISSIONS` for a parent.
 */
export type CurrentMember = {
  memberId: string;
  familyId: string;
  familyName: string;
  role: FamilyRole;
  isCreator: boolean;
  permissions: Permissions;
};

/** A member as `getFamily()` shows them to the caller. */
export type FamilyMember = {
  memberId: string;
  userId: string;
  role: FamilyRole;
  isCreator: boolean;
  /** The profile's display name, else the username, else the email before the `@`; null if none exists. */
  displayName: string | null;
  username: string | null;
  /** The member's ISO 4217 currency, visible to everyone in the family; the app default without a profile. */
  currency: string;
  joinedAt: string;
  /**
   * Hidden (absent) unless the caller is a parent or this is the caller's own entry.
   * `null` when visible but the member has never been active.
   */
  lastActiveAt?: string | null;
  /**
   * Hidden (absent) unless the caller is a parent or this is the caller's own entry.
   * Every module for a kid; `PARENT_PERMISSIONS` for a parent.
   */
  permissions?: Permissions;
};

/** The caller's family and its members: the creator first, then other parents, then kids, each by join date. */
export type FamilyData = {
  family: { id: string; name: string; createdAt: string };
  members: FamilyMember[];
};

/** A pending invite (not used, revoked or expired), as `listInvites()` shows it to a parent. Never carries the code. */
export type FamilyInvite = {
  inviteId: string;
  role: FamilyRole;
  /** Every module for a kid invite; `null` for a parent invite. */
  permissions: Permissions | null;
  /** The creator's display name, else username, else email before the `@`; `null` once their account is gone. */
  createdByName: string | null;
  createdAt: string;
  expiresAt: string;
};

/** What `createInvite` stores: a kid invite carries the kid's permissions, a parent invite none. */
export type NewInvite =
  | { role: "parent"; permissions: null; codeHash: string }
  | { role: "kid"; permissions: Permissions; codeHash: string };

/** What an invite code invites the caller to, as `previewInvite()` shows it before they join. */
export type InvitePreview = {
  familyName: string;
  /** The inviter's display name, else username, else email before the `@`; `null` when none exists. */
  inviterName: string | null;
  role: FamilyRole;
  /** Every module for a kid invite; `null` for a parent invite. */
  permissions: Permissions | null;
  expiresAt: string;
};

/**
 * Families and memberships. Get it from `getRepositories()`; never import an implementation.
 * Unlike the finance repositories, methods take no `userId`: they act as the signed-in caller,
 * because the SQL functions identify the caller themselves.
 */
export interface FamilyRepository {
  /** The caller's membership, or `null` when they have no family. */
  getMembership(): Promise<CurrentMember | null>;
  /** The caller's family with its members, or `null` when they have no family. */
  getFamily(): Promise<FamilyData | null>;
  /**
   * Creates a family named `name` (trimmed, 1–60 characters) with the caller as its creator and
   * parent, and returns the family's id. Throws a 409 `DomainError` when the caller is already in a
   * family, and a 422 one when the name is invalid.
   */
  createFamily(name: string): Promise<string>;
  /**
   * Replaces a kid's permissions with `permissions` (every module). For parents of the kid's family.
   * Throws a 403 `DomainError` when the caller isn't a parent or the member is a parent, a 404 one
   * when the member isn't in the caller's family, and a 422 one when the permissions are invalid.
   */
  setMemberPermissions(memberId: string, permissions: Permissions): Promise<void>;
  /**
   * Adds the account `userId` to the caller's family as a kid with `permissions` (every module), and
   * returns the new member's id. For parents, and only for an account created for the caller's family
   * (a managed kid account, see `AuthAdmin.createUser`'s `managedByFamily`). Throws a 403 `DomainError`
   * when the caller isn't a parent, a 404 one when the account isn't marked for the caller's family,
   * a 409 one when it's already in a family, and a 422 one when the permissions are invalid.
   */
  addManagedKid(userId: string, permissions: Permissions): Promise<string>;
  /**
   * Marks a kid of the caller's family as having to choose a new password, and returns the kid's user
   * id. For parents, and the permission check for resetting a kid's password. Throws a 403
   * `DomainError` when the caller isn't a parent or the member is a parent, and a 404 one when the
   * member isn't in the caller's family.
   */
  requirePasswordChange(memberId: string): Promise<string>;
  /**
   * Removes a member from the caller's family and leaves them a notice. For the family's creator,
   * never on themselves. Throws a 403 `DomainError` when the caller isn't the creator or names
   * themselves, and a 404 one when the member isn't in the caller's family.
   */
  removeMember(memberId: string): Promise<void>;
  /**
   * Deletes the caller's family and leaves every other member a notice. For the family's creator.
   * `confirmName` must be the family's name, ignoring case and surrounding spaces. Throws a 403
   * `DomainError` when the caller isn't the creator, and a 422 one when the name doesn't match.
   */
  deleteFamily(confirmName: string): Promise<void>;
  /**
   * Marks the caller as active now. Does nothing for a caller without a family, or when they were
   * last marked under 5 minutes ago.
   */
  touchLastActive(): Promise<void>;
  /**
   * Creates an invite to the caller's family and returns its id and expiry (48 hours for a parent
   * invite, 7 days for a kid invite). `codeHash` is `hashInviteCode(code)`; the plain code never
   * reaches storage. Throws a 403 `DomainError` when the caller isn't a parent, a 422 one for an
   * invalid role or permissions, and a 409 one when the hash is already in use (retry with a new code).
   */
  createInvite(invite: NewInvite): Promise<{ inviteId: string; expiresAt: string }>;
  /** The family's pending invites, newest first. Throws a 403 `DomainError` when the caller isn't a parent. */
  listInvites(): Promise<FamilyInvite[]>;
  /**
   * Revokes an invite of the caller's family; an invite already revoked or used is left as it is.
   * Throws a 403 `DomainError` when the caller isn't a parent, and a 404 one when the invite doesn't
   * exist or belongs to another family.
   */
  revokeInvite(inviteId: string): Promise<void>;
  /**
   * What the invite with `codeHash` (`hashInviteCode(code)`) invites the caller to, or `null` when the
   * code can't be redeemed: unknown, expired, used, revoked, or its creator is no longer a parent. The
   * reason is never revealed. Works for callers already in a family too. A malformed hash is a bug in
   * the caller and throws a plain `Error`.
   */
  previewInvite(codeHash: string): Promise<InvitePreview | null>;
  /**
   * The caller joins the family of the invite with `codeHash` (`hashInviteCode(code)`), with its role
   * (and, for a kid, its permissions), and the invite is used up. Returns the new member id. Throws a
   * 409 `DomainError` when the caller is already in a family, and a 404 one when the code can't be
   * redeemed (for any of `previewInvite`'s reasons). A malformed hash throws a plain `Error`.
   */
  redeemInvite(codeHash: string): Promise<string>;
}
