import "server-only";

import { cache } from "react";

import type { AccountData, AccountMembership } from "@/lib/account/types";
import { asPageCaller, getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth";
import { avatarUrl } from "@/lib/avatars/paths";
import { isFamilyEnabled } from "@/lib/features";
import { getCurrentMember } from "@/lib/family/current-member";
import { signInName, visibleEmail } from "@/lib/family/kid-account";
import { getRepositories } from "@/lib/repositories";

/** The caller's membership with their own member id only (not the family's id); `null` with no family or while the flag is off. */
async function accountMembership(): Promise<AccountMembership | null> {
  const member = await getCurrentMember();
  if (!member) return null;
  const { memberId, role, isCreator, familyName, permissions } = member;
  return { memberId, role, isCreator, familyName, permissions };
}

/**
 * The account as `GET /api/account` answers it, reading the currency (unless given), the membership,
 * the password flag and the picture in parallel. The route and the `(app)` layout both call it, so the
 * account the layout puts in the page is exactly what the browser would have fetched (PF5).
 */
export async function loadAccount(user: AuthenticatedUser, knownCurrency?: string): Promise<AccountData> {
  const { account, avatars } = getRepositories();
  const [currency, membership, mustChangePassword, avatarPath] = await Promise.all([
    knownCurrency ?? account.getCurrency(user.id),
    accountMembership(),
    account.getMustChangePassword(user.id),
    avatars.getPath(user.id),
  ]);
  return {
    email: visibleEmail(user.email),
    signInName: signInName(user.email),
    currency,
    features: { family: isFamilyEnabled() },
    membership,
    mustChangePassword,
    avatarUrl: avatarUrl(avatarPath),
  };
}

/**
 * The signed-in user's account for a server component, or `null` with no session (signed out,
 * expired, deleted). Read once per render (React's `cache`): the `(app)` layout decides the redirects
 * with it, and a page that needs it too (Home, to know which blocks to load) gets the same answer.
 */
export const loadPageAccount = cache((): Promise<AccountData | null> =>
  asPageCaller(async () => {
    const user = await getAuthenticatedUser();
    return user ? loadAccount(user) : null;
  }),
);
