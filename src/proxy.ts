import { NextResponse, type NextRequest } from "next/server";

import { getEnv } from "@/lib/env";
import { contentSecurityPolicy, createNonce, CSP_HEADER, NONCE_HEADER, REPORTING_ENDPOINTS } from "@/lib/http/csp";
import { PAGE_PATH_HEADER, pagePathOf } from "@/lib/http/page-path";
import { strictTransportSecurity } from "@/lib/http/security-headers";
import { createRequestId, REQUEST_ID_FROM_PROXY, REQUEST_ID_HEADER, REQUEST_ID_SOURCE_HEADER } from "@/lib/log/request-id";
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
 *
 * It also gives the request its id (logging plan, L2): a new `x-request-id` on the forwarded request,
 * overwriting any the client sent, with `x-request-id-source: proxy` (also overwritten) so the route
 * wrappers know they may use it, and the same id on the response.
 *
 * And the page's path and query (`x-page-path`, also overwritten), which the `(app)` layout turns
 * into the `next` of its sign-in redirect (PF5).
 */
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const policy = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === "development" });
  const requestId = createRequestId();
  const requestHeaders = {
    [NONCE_HEADER]: nonce,
    [CSP_HEADER]: policy,
    [REQUEST_ID_HEADER]: requestId,
    [REQUEST_ID_SOURCE_HEADER]: REQUEST_ID_FROM_PROXY,
    [PAGE_PATH_HEADER]: pagePathOf(request.nextUrl),
  };

  const response = SESSIONLESS_PATHS.has(request.nextUrl.pathname)
    ? NextResponse.next({ request: { headers: withHeaders(request.headers, requestHeaders) } })
    : await updateSession(request, requestHeaders);

  response.headers.set(CSP_HEADER, policy);
  response.headers.set("Reporting-Endpoints", REPORTING_ENDPOINTS);
  const hsts = strictTransportSecurity(getEnv().SITE_URL);
  if (hsts) response.headers.set("Strict-Transport-Security", hsts);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

// The matcher skips `/api/client-log` (logging plan, L6) as well as the CSP reports: a browser report
// needs neither the CSP headers nor a refreshed session, and while the project's JWTs are signed
// with a shared secret (its JWKS is empty) every `getClaims()` with a session is a round trip to
// Supabase Auth, so refreshing here would cost a second Auth call per signed-in report. The route
// reads the user itself, through `getAuthenticatedUser`, and refreshes an expired session there.
export const config = {
  // Must stay the same string as `PROXY_MATCHER` (src/lib/http/proxy-matcher.ts); Next needs a literal here.
  matcher: [
    "/((?!health(?:/|$)|api/mcp(?:/|$)|api/csp-report(?:/|$)|api/client-log(?:/|$)|api/calendar/feed/|\\.well-known/|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
