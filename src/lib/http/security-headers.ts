/**
 * The response headers that are the same on every response (security plan S7). `next.config.ts`
 * sends {@link STATIC_SECURITY_HEADERS}; `src/proxy.ts` adds what depends on the request or on the
 * runtime environment: the Content Security Policy (`src/lib/http/csp.ts`) and HSTS
 * ({@link strictTransportSecurity}).
 *
 * Plain code with no `server-only` import: `next.config.ts` imports it, and runs outside Next.
 */

export type Header = { key: string; value: string };

/** Every header that never changes. `next.config.ts` sends them on every path. */
export const STATIC_SECURITY_HEADERS: readonly Header[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // A window another site opens (or that opens one) shares no `window.opener` with our pages, so
  // that site can't navigate or probe them. Google sign-in is a full-page redirect, not a popup.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Other sites can't embed our responses (images, scripts, JSON) with no-cors requests.
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

/**
 * Paths whose `Cross-Origin-Opener-Policy` is `unsafe-none` instead, each with the reason.
 * `next.config.ts` sends this after the static headers, so it wins on these paths.
 */
export const COOP_EXEMPTIONS: Readonly<Record<string, string>> = {
  "/oauth/consent":
    "An MCP client may open the consent page in a popup (through Supabase's authorize URL) and read " +
    "the answer from its own callback page through window.opener. With same-origin here the popup " +
    "loses its opener as soon as it reaches this page and never gets it back.",
};

/** One year. Browsers remember it that long after the last HTTPS response that sent it. */
export const HSTS_MAX_AGE_SECONDS = 31_536_000;

/**
 * The `Strict-Transport-Security` value when `SITE_URL` is an `https:` address, else null (plain
 * HTTP, as in development, must never send it).
 *
 * No `includeSubDomains`: it would force HTTPS on every name under the app's own host, and if the
 * address ever moves to the apex of a custom domain, on every other site of that domain too. The
 * app serves nothing on a subdomain, so it would protect nothing. No `preload` either.
 *
 * Sent from `src/proxy.ts`, not `next.config.ts`: Next evaluates `headers()` once at build time
 * and bakes the result into the build, and the Docker image is built without `SITE_URL`.
 */
export function strictTransportSecurity(siteUrl: string | undefined): string | null {
  if (!siteUrl) return null;
  try {
    return new URL(siteUrl).protocol === "https:" ? `max-age=${HSTS_MAX_AGE_SECONDS}` : null;
  } catch {
    return null;
  }
}
