import "server-only";

import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http/errors";

/**
 * The request guard (security plan S5, audit P3): a cookie-authenticated write must come from the
 * app's own pages. `withUser` (and so `withPermission`) runs it before authenticating, and
 * `withRequestGuard` runs it for the routes that don't use those wrappers (`/api/auth`).
 *
 * For `POST`, `PUT`, `PATCH` and `DELETE` it refuses, with 403 {@link CROSS_SITE_REFUSED}:
 * - `Sec-Fetch-Site: cross-site` or `same-site`. The app's own pages, its service worker and the
 *   OAuth consent page are all same-origin. `same-site` would be another port or subdomain under
 *   the same registrable domain, which the app never calls itself from and which `SameSite=Lax`
 *   cookies would otherwise reach.
 * - An `Origin` that isn't the app's (see {@link isAppOrigin}), including `Origin: null`.
 *
 * A request with neither header (curl, server-to-server, an old browser's same-origin request)
 * passes; it still needs a valid session. `GET`, `HEAD` and `OPTIONS` are never checked: they
 * change nothing (the calendar feed and health check are GETs).
 *
 * The JSON body rules (`Content-Type: application/json`, 64 KB) are in `readJson`.
 */

/** The methods the guard checks. */
export const GUARDED_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The only `/api` routes whose writes skip the guard, each with the reason. The coverage test in
 * `src/app/api/protected-routes.test.ts` reads this list: any other route whose `POST`, `PUT`,
 * `PATCH` or `DELETE` lets a cross-site request through fails it.
 *
 * No OAuth endpoint is here: the authorize, token and client-registration endpoints MCP clients
 * call are Supabase's (on `SUPABASE_URL`), not this app's. The app's own
 * `/api/oauth/authorizations/[id]/approve` and `/deny` are called by its consent page with the
 * session cookie, so they are guarded like every other route.
 */
export const REQUEST_GUARD_EXEMPTIONS: Readonly<Record<string, string>> = {
  "/api/mcp":
    "Authenticated only by a bearer token in the Authorization header, never by cookies, so a " +
    "forged cross-site request has no credential to ride on. MCP clients send no Origin; the " +
    "route keeps its own Origin check against SITE_URL (the MCP spec's DNS-rebinding guard).",
};

export const CROSS_SITE_REFUSED = "This request didn't come from the app, so it was refused.";

/** `SITE_URL`'s origin, or null when it's unset or not a URL. */
function configuredOrigin(): string | null {
  const siteUrl = getEnv().SITE_URL;
  if (!siteUrl) return null;
  try {
    return new URL(siteUrl).origin;
  } catch {
    return null;
  }
}

/**
 * The host the browser asked for: `X-Forwarded-Host` (set by a reverse proxy), else `Host`, else
 * the request URL's (tests build requests without a `Host`). A page on another site can't set
 * either header on a cross-site request without a CORS preflight, which the app never grants.
 */
function requestHost(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || request.headers.get("host")?.trim();
  return (host || new URL(request.url).host).toLowerCase();
}

/**
 * Whether `origin` is the app's own:
 * - With `SITE_URL` set, its origin always counts. In production it is the only one: behind
 *   Tailscale Serve (or any proxy) the container's own address is not what the browser opened, and
 *   `SITE_URL` must be exactly the address the app is opened at.
 * - Without `SITE_URL`, and in development and tests whatever it says, the host the request was
 *   sent to counts too, like Next's own Server Action check (`Origin` against `Host` /
 *   `X-Forwarded-Host`). So `next dev` works at localhost, 127.0.0.1 or a LAN address.
 */
export function isAppOrigin(origin: string, request: Request): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false; // `null` (sandboxed frames, some redirects) and anything else that isn't a URL.
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const configured = configuredOrigin();
  if (configured !== null) {
    if (parsed.origin === configured) return true;
    if (process.env.NODE_ENV === "production") return false;
  }
  return parsed.host === requestHost(request);
}

/**
 * The guard's refusal for `request`, or null when it may go on. `request` is only ever missing
 * when a test calls a handler directly with no arguments; Next always passes one.
 */
export function refuseForeignRequest(request: Request | undefined): HttpError | null {
  if (!request || !GUARDED_METHODS.has(request.method.toUpperCase())) return null;

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "cross-site" || fetchSite === "same-site") return new HttpError(403, CROSS_SITE_REFUSED);

  const origin = request.headers.get("origin");
  if (origin !== null && !isAppOrigin(origin, request)) return new HttpError(403, CROSS_SITE_REFUSED);

  return null;
}
