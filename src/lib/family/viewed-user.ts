import "server-only";

import type { AuthenticatedUser } from "@/lib/auth";
import { isFamilyEnabled } from "@/lib/features";
import type { CurrentMember } from "@/lib/family/repository";
import { ALL_MEMBERS, MEMBER_PARAM, type Viewing } from "@/lib/family/viewing";
import { HttpError } from "@/lib/http/route";
import { can } from "@/lib/permissions";
import { getRepositories } from "@/lib/repositories";
import { idSchema } from "@/lib/validation/primitives";

export { ALL_MEMBERS, MEMBER_PARAM };

/**
 * The one answer for every refused `member`: flag off, no family, not allowed, unknown or another
 * family's member, malformed id. It never says which, so member ids can't be probed.
 */
export const MEMBER_NOT_FOUND_MESSAGE = "Member not found.";

export type { Viewing };

export type ViewedUser = { userId: string; viewing: Viewing };

function notViewable(): never {
  throw new HttpError(404, MEMBER_NOT_FOUND_MESSAGE);
}

function self(caller: AuthenticatedUser, memberId: string | null): ViewedUser {
  return { userId: caller.id, viewing: { memberId, displayName: null, currency: null, readOnly: false } };
}

/**
 * Decides whose finance data a read shows. This check is the real gate: finance repositories read
 * whichever `userId` they're given, and the database's read policies (F43) are only the backstop.
 *
 * - No param (`null`): the caller, not read-only. No query.
 * - The caller's own member id: the caller too. No query.
 * - Another member's id: allowed only while the family flag is on, when the caller is a parent or a
 *   kid with `family_finance` at `view`, and only when the member is in the caller's family per
 *   `getFamily()`. Returns that member's user id, read-only.
 * - Anything else (flag off, no family, not allowed, unknown or another family's member, malformed
 *   id) throws a 404 with `MEMBER_NOT_FOUND_MESSAGE`. The id's format is checked first, and nothing
 *   is queried while the flag is off.
 *
 * `member` is the caller's membership exactly as `withPermission` loaded it for the module check
 * (its handler's fourth argument). It's passed on rather than read again because
 * `getCurrentMember()`'s React `cache` doesn't deduplicate inside route handlers. Call this after
 * that permission check, and only from read routes.
 */
export async function resolveViewedUser(
  memberParam: string | null,
  caller: AuthenticatedUser,
  member: CurrentMember | null,
): Promise<ViewedUser> {
  if (memberParam === null) return self(caller, member?.memberId ?? null);

  if (!idSchema().safeParse(memberParam).success) notViewable();
  if (!isFamilyEnabled() || !member) notViewable();

  const memberId = memberParam.toLowerCase();
  if (memberId === member.memberId.toLowerCase()) return self(caller, member.memberId);

  // `can()` passes parents; a kid needs `family_finance` at `view`.
  if (!can(member, "family_finance", "view")) notViewable();

  const family = await getRepositories().family.getFamily();
  if (!family || family.family.id !== member.familyId) notViewable();
  const viewed = family.members.find((entry) => entry.memberId.toLowerCase() === memberId) ?? notViewable();

  if (viewed.userId === caller.id) return self(caller, viewed.memberId);
  return {
    userId: viewed.userId,
    viewing: { memberId: viewed.memberId, displayName: viewed.displayName, currency: viewed.currency, readOnly: true },
  };
}

/** `resolveViewedUser` for the request's `?member=` parameter. */
export function resolveViewedUserFor(request: Request, caller: AuthenticatedUser, member: CurrentMember | null) {
  return resolveViewedUser(new URL(request.url).searchParams.get(MEMBER_PARAM), caller, member);
}

/** True when the request asks for the combined family view (`?member=all`). */
export function wantsFamilyView(request: Request) {
  return new URL(request.url).searchParams.get(MEMBER_PARAM) === ALL_MEMBERS;
}

/** One person in a combined family view, with what the view needs to label and format their rows. */
export type FamilyViewer = { userId: string; memberId: string; name: string; currency: string };

/** What a combined family response says about whose data it shows. */
export const FAMILY_VIEWING: Viewing = { memberId: ALL_MEMBERS, displayName: null, currency: null, readOnly: true };

/**
 * Everyone whose finance data the caller may see, caller included, for `?member=all`. The same gate as
 * `resolveViewedUser` for another member: the family flag on, and the caller a parent or a kid with
 * `family_finance` at `view`. Anything else throws the same 404, so the view can't be probed. Call it
 * after the module permission check, and only from read routes.
 */
export async function resolveFamilyViewers(member: CurrentMember | null): Promise<FamilyViewer[]> {
  if (!isFamilyEnabled() || !member) notViewable();
  if (!can(member, "family_finance", "view")) notViewable();

  const family = await getRepositories().family.getFamily();
  if (!family || family.family.id !== member.familyId) notViewable();
  return family.members.map((entry) => ({
    userId: entry.userId,
    memberId: entry.memberId,
    name: entry.displayName ?? entry.username ?? "Unnamed",
    currency: entry.currency,
  }));
}
