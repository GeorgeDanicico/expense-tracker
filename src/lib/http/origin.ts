import "server-only";

import type { NextRequest } from "next/server";

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
