import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { createTracedFetch, tracedFetch, type TracedFetchOptions } from "@/lib/log/traced-fetch";
import { getSupabaseAdminConfig } from "@/lib/supabase/config";

export type AdminClient = SupabaseClient<Database>;

/**
 * SECURITY: a client with the secret key. It bypasses RLS and every grant meant for signed-in
 * users, so it is created only on the server, only in `auth-admin.ts` (when an `AuthAdmin` method is
 * about to run, including `startSessionForUser`, which uses it only to make the one-time token, and `deleteUser`, which also empties the account's avatar folder), `repositories/avatars.ts` (when the caller's own picture is about to change),
 * `repositories/mcp-tokens.ts` (to check a personal MCP token, which has no signed-in user), `repositories/ai.ts` (the AI gate: the global spend, the usage ledger, the kill switch and the budget notifications, none of which a signed-in user may touch) and
 * `worker-store.ts` (for the notifications worker, `src/worker/main.ts`, a separate process with no
 * request, which acts for every user: heartbeats, the outbox, due reminders, the open to-dos due today with their assignees, and recipients' notification settings and push subscriptions).
 * It never stores, refreshes or reads a session: it acts as the service, not as a user.
 *
 * Its calls have the web app's time limit (`SUPABASE_TIMEOUT_MS`) unless `timeoutMs` says otherwise:
 * the worker passes its own (`WORKER_SUPABASE_TIMEOUT_MS`).
 */
export function createAdminClient({ timeoutMs }: TracedFetchOptions = {}): AdminClient {
  const { url, secretKey } = getSupabaseAdminConfig();
  return createSupabaseClient<Database>(url, secretKey, {
    global: { fetch: timeoutMs === undefined ? tracedFetch : createTracedFetch(undefined, { timeoutMs }) },
    db: { retry: false },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
