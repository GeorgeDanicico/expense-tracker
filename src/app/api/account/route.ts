import type { NextRequest } from "next/server";

import type { AccountData, AccountMembership } from "@/lib/account/types";
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

function accountData(email: string, currency: string, membership: AccountMembership | null): AccountData {
  return { email, currency, features: { family: isFamilyEnabled() }, membership };
}

export const GET = withUser(async (_request, user) => {
  const [currency, membership] = await Promise.all([
    getRepositories().account.getCurrency(user.id),
    accountMembership(),
  ]);
  return json(accountData(user.email, currency, membership));
}, { failure: "Unable to load account settings." });

export const PATCH = withUser(async (request: NextRequest, user) => {
  const payload = (await readJson(request)) as { currency?: unknown } | null;
  if (!isSupportedCurrency(payload?.currency)) {
    throw new HttpError(422, "Choose a supported currency.");
  }

  await getRepositories().account.updateCurrency(user, payload.currency);

  return json(accountData(user.email, payload.currency, await accountMembership()));
}, { failure: "The currency could not be saved. Please try again." });
