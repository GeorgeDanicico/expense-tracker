import "server-only";

import { getEnv } from "@/lib/env";

export function getSupabaseConfig() {
  const { SUPABASE_URL: supabaseUrl, SUPABASE_PUBLISHABLE_KEY: supabasePublishableKey } = getEnv();
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY environment variable.",
    );
  }

  return {
    url: supabaseUrl,
    publishableKey: supabasePublishableKey,
  };
}

/**
 * The project URL and the secret key, for the admin client in `admin-client.ts` only.
 *
 * SECURITY: the secret key bypasses every database rule (RLS). It is server-only and optional:
 * it is read here, when the admin client is needed, so the app starts without it and only the
 * features that need it (kid accounts, username sign-in, profile pictures, the notifications worker) fail. Never log it or pass it on.
 */
export function getSupabaseAdminConfig() {
  const { SUPABASE_URL: supabaseUrl, SUPABASE_SECRET_KEY: secretKey } = getEnv();
  if (!supabaseUrl || !secretKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variable. Kid accounts, username sign-in and the notifications worker need the secret key.",
    );
  }

  return {
    url: supabaseUrl,
    secretKey,
  };
}
