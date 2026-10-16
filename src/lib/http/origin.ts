import "server-only";

import type { NextRequest } from "next/server";

/** Where an unusable `next` value falls back to. */
const DEFAULT_NEXT_PATH = "/dashboard";

/**
 * A `next` value from a query string or body, if it's a same-site path; otherwise the dashboard.
 * Refuses external URLs, protocol-relative paths (`//host`) and backslash tricks (`/\\host`).
 */
export function safeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_NEXT_PATH;
  }
  return value;
}

/** Origin used in auth redirect links (email confirmation, OAuth callback). */
export function siteOrigin(request: NextRequest) {
  const configuredOrigin = process.env.SITE_URL;
  const candidate = process.env.NODE_ENV === "production"
    ? configuredOrigin || request.nextUrl.origin
    : request.nextUrl.origin || configuredOrigin;

  try {
    return new URL(candidate || "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
}
