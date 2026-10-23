/**
 * The consent side of the OAuth server that MCP clients (Claude Code and the like) connect through:
 * the request an app makes, the user's answer, and the apps they have allowed. Routes reach it
 * through `getOAuthConsent()` in `@/lib/auth`; only `src/lib/supabase/oauth-consent.ts` knows it is
 * Supabase. Every method acts as the request's signed-in user.
 *
 * Anyone can register an app under any name, so the name is a claim; the redirect URI is what tells
 * a real app apart from a fake one.
 */

export type OAuthApp = {
  clientId: string;
  name: string;
  /** The app's website, when it registered one. */
  uri: string | null;
  logoUri: string | null;
};

export type ConsentRequest =
  | { kind: "needs_consent"; authorizationId: string; app: OAuthApp; redirectUri: string; scopes: string[] }
  /** The user already allowed this app: send the browser straight back to it. */
  | { kind: "already_approved"; redirectUrl: string };

export type ConnectedApp = OAuthApp & { scopes: string[]; connectedAt: string };

/**
 * Failures are thrown: a `DomainError` (404) for a request that doesn't exist, has expired or
 * belongs to someone else, or a plain `Error` with a generic message for anything else.
 */
export interface OAuthConsent {
  /** Null when the request doesn't exist, has expired, or belongs to someone else. */
  getRequest(authorizationId: string): Promise<ConsentRequest | null>;
  /** The URL to send the browser back to the app with, carrying a one-time code. */
  approve(authorizationId: string): Promise<{ redirectUrl: string }>;
  /** The URL to send the browser back to the app with, carrying `access_denied`. */
  deny(authorizationId: string): Promise<{ redirectUrl: string }>;
  /** The apps the caller has allowed. The same app can appear once per registration. */
  listConnectedApps(): Promise<ConnectedApp[]>;
  /** Ends every session and refresh token the app holds for the caller. */
  disconnect(clientId: string): Promise<void>;
}
