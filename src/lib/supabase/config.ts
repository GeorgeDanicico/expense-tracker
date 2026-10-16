import "server-only";

const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

export function getSupabaseConfig() {
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
 * The project URL and the secret key, for the admin client in `auth-admin.ts` only.
 *
 * SECURITY: the secret key bypasses every database rule (RLS). It is server-only and optional:
 * it is read here, when the admin client is needed, so the app starts without it and only the
 * features that need it (kid accounts, username sign-in) fail. Never log it or pass it on.
 */
export function getSupabaseAdminConfig() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variable. Kid accounts and username sign-in need the secret key.",
    );
  }

  return {
    url: supabaseUrl,
    secretKey,
  };
}
