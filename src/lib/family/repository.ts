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
   * Marks the caller as active now. Does nothing for a caller without a family, or when they were
   * last marked under 5 minutes ago.
   */
  touchLastActive(): Promise<void>;
}
