import type { NextRequest } from "next/server";

import type { AccountData, AccountMembership } from "@/lib/account/types";
import type { AuthenticatedUser } from "@/lib/auth";
import { isFamilyEnabled } from "@/lib/features";
import { getCurrentMember } from "@/lib/family/current-member";
import { HttpError, json, readJson, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { isSupportedCurrency } from "@/lib/utils/currency";

/** The caller's membership without its ids; `null` with no family or while the flag is off. */
async function accountMembership(): Promise<AccountMembership | null> {
  const member = await getCurrentMember();
  if (!member) return null;
  const { role, isCreator, familyName, permissions } = member;
  return { role, isCreator, familyName, permissions };
}

/** The account response, reading the currency (unless given), the membership and the password flag in parallel. */
async function accountData(user: AuthenticatedUser, knownCurrency?: string): Promise<AccountData> {
  const account = getRepositories().account;
  const [currency, membership, mustChangePassword] = await Promise.all([
    knownCurrency ?? account.getCurrency(user.id),
    accountMembership(),
    account.getMustChangePassword(user.id),
  ]);
  return { email: user.email, currency, features: { family: isFamilyEnabled() }, membership, mustChangePassword };
}

export const GET = withUser(async (_request, user) => json(await accountData(user)), {
  failure: "Unable to load account settings.",
});

export const PATCH = withUser(async (request: NextRequest, user) => {
  const payload = (await readJson(request)) as { currency?: unknown } | null;
  if (!isSupportedCurrency(payload?.currency)) {
    throw new HttpError(422, "Choose a supported currency.");
  }

  await getRepositories().account.updateCurrency(user, payload.currency);

  return json(await accountData(user, payload.currency));
}, { failure: "The currency could not be saved. Please try again." });
