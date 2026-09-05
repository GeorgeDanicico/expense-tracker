import "server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizeCurrency } from "@/lib/utils/currency";

export async function getAccountCurrencyForUser(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("currency")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error("Unable to load account settings.");
  return normalizeCurrency(data?.currency);
}
