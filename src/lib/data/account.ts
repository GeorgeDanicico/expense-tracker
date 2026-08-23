import "server-only";

import { cache } from "react";

import { getAuthenticatedUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_CURRENCY, normalizeCurrency } from "@/lib/utils/currency";

export const getAccountCurrency = cache(async () => {
  const user = await getAuthenticatedUser();
  if (!user) return DEFAULT_CURRENCY;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("currency")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error("Unable to load account settings.");
  return normalizeCurrency(data?.currency);
});
