/**
 * The app's view of the auth provider. Routes reach it through `getAuth()` in
 * `@/lib/auth`; only `src/lib/supabase/auth.ts` knows it is Supabase.
 * Every method except `startSession`, `verifyAppToken` and `sessionForAppToken` acts on the current
 * request's session.
 */

export type AuthenticatedUser = {
  id: string;
  email: string;
};

/**
 * Failures the routes answer differently from a plain refusal: the provider's rate limits (such as
 * its hourly cap on emails, which a free Supabase project reaches after a few sign-ups), and a
 * correct password for an account whose email isn't confirmed yet.
 */
export type AuthFailureKind = "rate_limited" | "email_not_confirmed";

/** A failed auth call. `reason` is safe to show to the user. */
export type AuthFailure = { ok: false; reason: string; kind?: AuthFailureKind };

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

/** The user behind an OAuth app's access token, and the app it was issued to. */
export type AppTokenUser = { userId: string; email: string; clientId: string };

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
  /** Sets a new password for the signed-in user. The session stays signed in. */
  updatePassword(password: string): Promise<AuthResult>;
  /** Asks to change the signed-in user's email; the link sent to the new address goes to `confirmationUrl`. */
  updateEmail(email: string, confirmationUrl: string): Promise<AuthResult>;
  /** Signs in without touching the request's session. Null when the credentials are rejected or the provider fails. */
  startSession(email: string, password: string): Promise<AuthSession | null>;
  /**
   * The user behind an OAuth app's access token, or null if it's invalid, not an app token, or its
   * session has ended (the user disconnected the app). Ask again on every request.
   */
  verifyAppToken(token: string): Promise<AppTokenUser | null>;
  /**
   * Runs as the user behind an app token, for an MCP call. Inside `run`, `getCurrentUser()` returns
   * that user; outside it, an app token is never a signed-in user (the REST API refuses it).
   *
   * SECURITY: call it only with a token `verifyAppToken` has just accepted.
   */
  sessionForAppToken(token: string): AuthSession;
}
