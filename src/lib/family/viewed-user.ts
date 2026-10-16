import "server-only";

import type { AuthenticatedUser } from "@/lib/auth";
import { isFamilyEnabled } from "@/lib/features";
import type { CurrentMember } from "@/lib/family/repository";
import type { Viewing } from "@/lib/family/viewing";
import { HttpError } from "@/lib/http/route";
import { can } from "@/lib/permissions";
import { getRepositories } from "@/lib/repositories";
import { idSchema } from "@/lib/validation/primitives";

/** The query parameter a finance read takes to show another family member's data. */
export const MEMBER_PARAM = "member";

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
