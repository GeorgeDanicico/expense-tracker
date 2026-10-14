import type { NextRequest } from "next/server";

import { getAccountCurrencyForUser } from "@/lib/data/account";
import { HttpError, json, readJson, withUser } from "@/lib/http/route";
import { createClient } from "@/lib/supabase/server";
import { isSupportedCurrency } from "@/lib/utils/currency";

export const GET = withUser(async (_request, user) => {
  const currency = await getAccountCurrencyForUser(user.id);
  return json({ email: user.email, currency });
}, { failure: "Unable to load account settings." });

const SAVE_FAILURE = "The currency could not be saved. Please try again.";

export const PATCH = withUser(async (request: NextRequest, user) => {
  const payload = (await readJson(request)) as { currency?: unknown } | null;
  if (!isSupportedCurrency(payload?.currency)) {
    throw new HttpError(422, "Choose a supported currency.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email || null,
      currency: payload.currency,
    },
    { onConflict: "id" },
  );

  if (error) {
    return json({ error: SAVE_FAILURE }, 500);
  }

  return json({ email: user.email, currency: payload.currency });
}, { failure: SAVE_FAILURE });
