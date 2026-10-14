import type { NextRequest } from "next/server";

import { getAccountCurrencyForUser, updateAccountCurrencyForUser } from "@/lib/data/account";
import { HttpError, json, readJson, withUser } from "@/lib/http/route";
import { isSupportedCurrency } from "@/lib/utils/currency";

export const GET = withUser(async (_request, user) => {
  const currency = await getAccountCurrencyForUser(user.id);
  return json({ email: user.email, currency });
}, { failure: "Unable to load account settings." });

export const PATCH = withUser(async (request: NextRequest, user) => {
  const payload = (await readJson(request)) as { currency?: unknown } | null;
  if (!isSupportedCurrency(payload?.currency)) {
    throw new HttpError(422, "Choose a supported currency.");
  }

  await updateAccountCurrencyForUser(user, payload.currency);

  return json({ email: user.email, currency: payload.currency });
}, { failure: "The currency could not be saved. Please try again." });
