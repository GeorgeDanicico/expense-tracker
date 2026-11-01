import { NextResponse, type NextRequest } from "next/server";

import { getEnv } from "@/lib/env";
import { contentSecurityPolicy, createNonce, CSP_HEADER, NONCE_HEADER, REPORTING_ENDPOINTS } from "@/lib/http/csp";
import { strictTransportSecurity } from "@/lib/http/security-headers";
import { updateSession, withHeaders } from "@/lib/supabase/proxy";

/**
 * Pages the proxy runs on only for their headers, never touching the session. The offline page is
 * cached by the service worker and shown with no network, so it must not carry a refreshed cookie.
 */
const SESSIONLESS_PATHS: ReadonlySet<string> = new Set(["/offline"]);

/**
 * Every matched request gets a fresh CSP nonce (security plan S7): on the request, so Next puts it
 * on its scripts and the root layout can read it, and on the response, with the policy itself, the
 * reporting endpoint and HSTS. Then the Supabase session is refreshed (except on
 * {@link SESSIONLESS_PATHS}).
 */
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const policy = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === "development" });
  const requestHeaders = { [NONCE_HEADER]: nonce, [CSP_HEADER]: policy };

  const response = SESSIONLESS_PATHS.has(request.nextUrl.pathname)
    ? NextResponse.next({ request: { headers: withHeaders(request.headers, requestHeaders) } })
    : await updateSession(request, requestHeaders);

  response.headers.set(CSP_HEADER, policy);
  response.headers.set("Reporting-Endpoints", REPORTING_ENDPOINTS);
  const hsts = strictTransportSecurity(getEnv().SITE_URL);
  if (hsts) response.headers.set("Strict-Transport-Security", hsts);
  return response;
}

export const config = {
  matcher: [
    "/((?!health(?:/|$)|api/mcp(?:/|$)|api/csp-report(?:/|$)|api/calendar/feed/|\\.well-known/|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
