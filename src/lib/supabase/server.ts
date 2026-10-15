import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

import type { Database } from "@/lib/database.types";
import { getSupabaseConfig } from "@/lib/supabase/config";

const scopedClient = new AsyncLocalStorage<SupabaseClient<Database>>();

export function runWithSupabaseClient<T>(client: SupabaseClient<Database>, fn: () => T): T {
  return scopedClient.run(client, fn);
}

/**
 * The request's `Authorization: Bearer` token, or null when the request has none.
 * A bearer header without a usable token gives `""`: still a bearer request, so the caller
 * gets a 401 instead of falling back to the cookie session. Inside `runWithSupabaseClient`
 * (MCP) the scoped client decides who the caller is, so the header is not read.
 */
export async function getBearerToken(): Promise<string | null> {
  if (scopedClient.getStore()) return null;

  const match = (await headers()).get("authorization")?.match(/^Bearer(?:\s+(.*))?$/i);
  if (!match) return null;

  const token = match[1]?.trim() ?? "";
  return /^\S+$/.test(token) ? token : "";
}

/** A client that acts as the bearer token's user. It never stores or refreshes a session. */
function createTokenClient(token: string): SupabaseClient<Database> {
  const { url, publishableKey } = getSupabaseConfig();
  return createSupabaseClient<Database>(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * The request's client, in this order: the scoped client (MCP), then a client built from the
 * request's bearer token, then the cookie session. A bearer request never reads the cookies.
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const scoped = scopedClient.getStore();
  if (scoped) return scoped;

  const token = await getBearerToken();
  if (token !== null) return createTokenClient(token);

  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseConfig();

  return createServerClient<Database>(
    url,
    publishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies. The proxy refreshes them.
          }
        },
      },
    },
  );
}
