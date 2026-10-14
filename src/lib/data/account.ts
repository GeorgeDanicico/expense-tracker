import "server-only";

import type { AuthenticatedUser } from "@/lib/auth";
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

/** Upserts the caller's own profile row, so a first save also creates it. */
export async function updateAccountCurrencyForUser(user: AuthenticatedUser, currency: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").upsert(
    { id: user.id, email: user.email || null, currency },
    { onConflict: "id" },
  );

  if (error) throw new Error("The currency could not be saved. Please try again.");
}
