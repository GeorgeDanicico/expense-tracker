import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { getSupabaseAdminConfig } from "@/lib/supabase/config";

export type AdminClient = SupabaseClient<Database>;

/**
 * SECURITY: a client with the secret key. It bypasses RLS and every grant meant for signed-in
 * users, so it is created only on the server, only in `auth-admin.ts` (when an `AuthAdmin` method is
 * about to run, including `startSessionForUser`, which uses it only to make the one-time token), `repositories/avatars.ts` (when the caller's own picture is about to change),
 * `repositories/mcp-tokens.ts` (to check a personal MCP token, which has no signed-in user) and
 * `worker-store.ts` (for the notifications worker, `src/worker/main.ts`, a separate process with no
 * request, which acts for every user: heartbeats, the outbox, due reminders, the open to-dos due today with their assignees, and recipients' notification settings and push subscriptions).
 * It never stores, refreshes or reads a session: it acts as the service, not as a user.
 */
export function createAdminClient(): AdminClient {
  const { url, secretKey } = getSupabaseAdminConfig();
  return createSupabaseClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
