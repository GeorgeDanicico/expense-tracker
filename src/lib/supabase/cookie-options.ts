import "server-only";

import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * The options every Supabase auth cookie is written with, by the server client (`server.ts`) and the
 * proxy (`proxy.ts`), which are the only places the session cookies are read or written.
 *
 * - `httpOnly`: no script on the page can read the session, so an injected script can't steal it.
 *   Nothing in the browser needs to: the app never creates a browser Supabase client, and every
 *   auth call (sign-in, Google's PKCE verifier, refresh, sign-out) goes through the server.
 * - `secure` in production: the cookies only travel over HTTPS. Off in development, where the dev
 *   server is plain `http://localhost`.
 * - `sameSite: "lax"`: not sent on another site's background requests or form posts, but still sent
 *   when the browser comes back from Google or from an OAuth app's consent link (a top-level GET).
 * - `path: "/"`: the whole app and its API.
 *
 * `@supabase/ssr` adds its own `maxAge` (400 days, the browser maximum); the session itself expires
 * through its refresh token, not the cookie.
 */
export function authCookieOptions(): CookieOptionsWithName {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}
