import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { getSupabaseConfig } from "@/lib/supabase/config";

/**
 * A client with the publishable key and no session: the `anon` role, for the few functions that
 * are granted to it because their caller can't sign in (the calendar feed, read by a calendar app
 * with a secret token). It never reads, stores or refreshes a session, so it never carries a user.
 */
export function createAnonClient(): SupabaseClient<Database> {
  const { url, publishableKey } = getSupabaseConfig();
  return createSupabaseClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
