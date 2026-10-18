import type { FamilyRole, Permissions } from "@/lib/permissions";

/**
 * The caller's family membership as the account response carries it. `permissions` has every
 * module: a kid's levels, or the full parent levels for a parent, so `can()` reads it the same way
 * on the client as on the server.
 */
export type AccountMembership = {
  /** The caller's own member id, so a page can tell "me" from another member (`?member=`). */
  memberId: string;
  role: FamilyRole;
  isCreator: boolean;
  familyName: string;
  permissions: Permissions;
};

export type AccountData = {
  email: string;
  currency: string;
  features: { family: boolean };
  /** `null` when the user has no family, and always `null` while the family flag is off. */
  membership: AccountMembership | null;
  /**
   * The user has to choose a new password before using the app (a kid account a parent created or
   * reset). Not behind the family flag; always `false` for an ordinary account.
   */
  mustChangePassword: boolean;
  /** The caller's picture as an `/api/avatars/…` URL, or `null` without one. Not behind the family flag. */
  avatarUrl: string | null;
};
