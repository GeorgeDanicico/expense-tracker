/** Where an unusable `next` value falls back to. */
const DEFAULT_NEXT_PATH = "/dashboard";

/**
 * A `next` value from a query string or body, if it's a same-site path; otherwise the dashboard.
 * Refuses external URLs, protocol-relative paths (`//host`) and backslash tricks (`/\\host`).
 *
 * Kept apart from `origin.ts` (which is server-only) so the browser builds its sign-in redirect
 * with the same rule the login page and the auth routes clean `next` with.
 */
export function safeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_NEXT_PATH;
  }
  return value;
}
