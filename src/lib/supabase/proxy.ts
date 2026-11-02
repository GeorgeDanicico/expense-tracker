import "server-only";

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import { tracedFetch } from "@/lib/log/traced-fetch";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { authCookieOptions } from "@/lib/supabase/cookie-options";

/**
 * Refreshes the Supabase session cookies, and passes the request on with `extraRequestHeaders`
 * added (the proxy's CSP nonce). Each `NextResponse.next` copies the request's headers as they are
 * at that moment, so a refreshed cookie written into the request is forwarded too.
 */
export async function updateSession(request: NextRequest, extraRequestHeaders: Readonly<Record<string, string>> = {}) {
  const next = () => NextResponse.next({ request: { headers: withHeaders(request.headers, extraRequestHeaders) } });
  let response = next();
  const { url, publishableKey } = getSupabaseConfig();

  const supabase = createServerClient<Database>(
    url,
    publishableKey,
    {
      // No request context exists yet in the proxy (the route wrappers open it), so the traced fetch
      // records nothing here; it's passed so every Supabase client is built the same way.
      global: { fetch: tracedFetch },
      cookieOptions: authCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = next();

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }

          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  await supabase.auth.getClaims();
  return response;
}

/** A copy of `headers` with `extra` set on top. */
export function withHeaders(headers: Headers, extra: Readonly<Record<string, string>>): Headers {
  const merged = new Headers(headers);
  for (const [key, value] of Object.entries(extra)) merged.set(key, value);
  return merged;
}
