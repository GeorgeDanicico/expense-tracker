import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "@/lib/database.types";
import { getSupabaseConfig } from "@/lib/supabase/config";

const scopedClient = new AsyncLocalStorage<SupabaseClient<Database>>();

export function runWithSupabaseClient<T>(client: SupabaseClient<Database>, fn: () => T): T {
  return scopedClient.run(client, fn);
}

export async function createClient(): Promise<SupabaseClient<Database>> {
  const scoped = scopedClient.getStore();
  if (scoped) return scoped;

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
