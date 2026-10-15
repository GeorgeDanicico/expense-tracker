/**
 * The app's view of the auth provider. Routes reach it through `getAuth()` in
 * `@/lib/auth`; only `src/lib/supabase/auth.ts` knows it is Supabase.
 * Every method except `startSession` acts on the current request's session.
 */

export type AuthenticatedUser = {
  id: string;
  email: string;
};

/** A failed auth call. `reason` is the provider's message, safe to show to the user. */
export type AuthFailure = { ok: false; reason: string };

export type AuthResult = { ok: true } | AuthFailure;

/** `signedIn` is false when the provider wants the email confirmed before the first sign-in. */
export type SignUpResult = { ok: true; signedIn: boolean } | AuthFailure;

export type OAuthProvider = "google";

export type OAuthUrlResult = { ok: true; url: string } | AuthFailure;

/** The `type` query parameter of a link sent by email. */
export type EmailLinkType = "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email";

/** The parameters of a link sent by email: a sign-in code, a hashed token, or an address with a 6-digit code. */
export type EmailLink =
  | { code: string }
  | { tokenHash: string; type: EmailLinkType }
  | { email: string; token: string; type: "email" };

/**
 * A session signed in outside the browser, for example by an MCP client. It lives
 * beyond a single request, so the caller decides how long to keep it.
 */
export type AuthSession = {
  userId: string;
  email: string;
  /** Runs `fn` as this user: `getAuth()` and the repositories inside it act for this session. */
  run<T>(fn: () => T): T;
  /** Whether the session can still be used, refreshing it if the provider needs to. */
  isActive(): Promise<boolean>;
};

export interface AuthService {
  /** The signed-in user, or null. */
  getCurrentUser(): Promise<AuthenticatedUser | null>;
  /** Signs in and stores the session for this request. */
  signInWithPassword(email: string, password: string): Promise<AuthResult>;
  /** Creates the account; the confirmation email links to `confirmationUrl`. */
  signUp(email: string, password: string, confirmationUrl: string): Promise<SignUpResult>;
  signOut(): Promise<AuthResult>;
  /** The provider page to send the browser to; it returns to `callbackUrl`. */
  oauthSignInUrl(provider: OAuthProvider, callbackUrl: string): Promise<OAuthUrlResult>;
  /** Verifies a link sent by email and stores the resulting session for this request. */
  completeEmailLink(link: EmailLink): Promise<AuthResult>;
  /** Signs in without touching the request's session. Null when the credentials are rejected or the provider fails. */
  startSession(email: string, password: string): Promise<AuthSession | null>;
}
