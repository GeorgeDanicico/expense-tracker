import "server-only";

import type { AccountRepository } from "@/lib/account/repository";
import { translateDatabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { normalizeCurrency } from "@/lib/utils/currency";

/**
 * `AccountRepository` on the `profiles` table. Its errors stay plain `Error`s (500s), as before the
 * repository existed: no account query raises an expected Postgres error.
 */
export const supabaseAccountRepository: AccountRepository = {
  async getCurrency(userId) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("currency")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw new Error("Unable to load account settings.");
    return normalizeCurrency(data?.currency);
  },

  /** Upserts the caller's own profile row, so a first save also creates it. */
  async updateCurrency(user, currency) {
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").upsert(
      { id: user.id, email: user.email || null, currency },
      { onConflict: "id" },
    );

    if (error) throw new Error("The currency could not be saved. Please try again.");
  },

  /** A user without a profile row has never been asked to change their password. */
  async getMustChangePassword(userId) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("must_change_password")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw new Error("Unable to load account settings.");
    return data?.must_change_password === true;
  },

  /** `complete_password_change()` acts as the request's caller and touches no other row. */
  async completePasswordChange() {
    const supabase = await createClient();
    const { error } = await supabase.rpc("complete_password_change");

    if (error) throw translateDatabaseError(error, "Unable to finish changing your password.");
  },
};
