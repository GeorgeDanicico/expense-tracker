import { AsyncLocalStorage } from "node:async_hooks";

import type {
  AuthenticatedUser,
  AuthFailure,
  AuthResult,
  AuthService,
  AuthSession,
  EmailLink,
  OAuthProvider,
  OAuthUrlResult,
  SignUpResult,
} from "@/lib/auth/service";

type FakeAccount = { id: string; email: string; password: string; confirmed: boolean };

/** A session from `startSession`. Set `active` to false to expire it; `checks` counts `isActive` calls. */
export type FakeAuthSession = AuthSession & { active: boolean; checks: number };

export type FakeAuthOptions = {
  /** When true (the default), new accounts must confirm their email before they can sign in. */
  requireEmailConfirmation?: boolean;
};

/**
 * In-memory `AuthService` for route tests. It keeps accounts and the "session"
 * of the request under test. Swap it in with:
 *
 *   let auth: FakeAuth;
 *   vi.mock("@/lib/auth", () => ({ getAuth: () => auth }));
 *   beforeEach(() => { auth = new FakeAuth(); });
 *
 * `fail(method, reason)` makes the next call of that method fail like the provider would.
 * Inside a session's `run`, `getCurrentUser()` returns that session's user.
 */
export class FakeAuth implements AuthService {
  readonly accounts: FakeAccount[] = [];
  /** Valid email links, by the code or token hash the email carries. */
  readonly emailLinks = new Map<string, string>();
  currentUser: AuthenticatedUser | null = null;
  /** The confirmation URL passed to the last `signUp`. */
  lastConfirmationUrl: string | null = null;
  /** The provider and callback URL passed to the last `oauthSignInUrl`. */
  lastOAuth: { provider: OAuthProvider; callbackUrl: string } | null = null;
  /** Every session handed out by `startSession`, oldest first. */
  readonly sessions: FakeAuthSession[] = [];

  private readonly sessionUser = new AsyncLocalStorage<AuthenticatedUser>();
  private readonly failures = new Map<keyof AuthService, string>();
  private readonly requireEmailConfirmation: boolean;
  private nextId = 1;

  constructor({ requireEmailConfirmation = true }: FakeAuthOptions = {}) {
    this.requireEmailConfirmation = requireEmailConfirmation;
  }

  /** Adds a confirmed account and returns its user. */
  addUser(email: string, password: string): AuthenticatedUser {
    return this.createAccount(email, password, true);
  }

  /** Makes the next call of `method` fail with `reason`. */
  fail(method: keyof AuthService, reason = "Auth provider failure") {
    this.failures.set(method, reason);
  }

  async getCurrentUser() {
    return this.sessionUser.getStore() ?? this.currentUser;
  }

  async signInWithPassword(email: string, password: string): Promise<AuthResult> {
    const failure = this.takeFailure("signInWithPassword");
    if (failure) return failure;
    const account = this.accounts.find((candidate) => candidate.email === email);
    if (!account || account.password !== password) return { ok: false, reason: "Invalid login credentials" };
    if (!account.confirmed) return { ok: false, reason: "Email not confirmed" };
    this.currentUser = { id: account.id, email: account.email };
    return { ok: true };
  }

  async signUp(email: string, password: string, confirmationUrl: string): Promise<SignUpResult> {
    const failure = this.takeFailure("signUp");
    if (failure) return failure;
    if (this.accounts.some((account) => account.email === email)) {
      return { ok: false, reason: "User already registered" };
    }
    this.lastConfirmationUrl = confirmationUrl;
    const user = this.createAccount(email, password, !this.requireEmailConfirmation);
    if (this.requireEmailConfirmation) return { ok: true, signedIn: false };
    this.currentUser = user;
    return { ok: true, signedIn: true };
  }

  async signOut(): Promise<AuthResult> {
    const failure = this.takeFailure("signOut");
    if (failure) return failure;
    this.currentUser = null;
    return { ok: true };
  }

  async oauthSignInUrl(provider: OAuthProvider, callbackUrl: string): Promise<OAuthUrlResult> {
    const failure = this.takeFailure("oauthSignInUrl");
    if (failure) return failure;
    this.lastOAuth = { provider, callbackUrl };
    return { ok: true, url: `https://${provider}.auth.test/authorize?redirect_to=${encodeURIComponent(callbackUrl)}` };
  }

  async completeEmailLink(link: EmailLink): Promise<AuthResult> {
    const failure = this.takeFailure("completeEmailLink");
    if (failure) return failure;
    const key = "code" in link ? link.code : "tokenHash" in link ? link.tokenHash : `${link.email}:${link.token}`;
    const email = this.emailLinks.get(key);
    const account = this.accounts.find((candidate) => candidate.email === email);
    if (!account) return { ok: false, reason: "Email link is invalid or has expired" };
    this.emailLinks.delete(key);
    account.confirmed = true;
    this.currentUser = { id: account.id, email: account.email };
    return { ok: true };
  }

  async startSession(email: string, password: string): Promise<AuthSession | null> {
    if (this.takeFailure("startSession")) return null;
    const account = this.accounts.find((candidate) => candidate.email === email);
    if (!account || account.password !== password || !account.confirmed) return null;
    const user = { id: account.id, email: account.email };
    const session: FakeAuthSession = {
      userId: user.id,
      email: user.email,
      active: true,
      checks: 0,
      run: (fn) => this.sessionUser.run(user, fn),
      async isActive() {
        session.checks += 1;
        return session.active;
      },
    };
    this.sessions.push(session);
    return session;
  }

  private createAccount(email: string, password: string, confirmed: boolean): AuthenticatedUser {
    const id = `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
    this.accounts.push({ id, email, password, confirmed });
    return { id, email };
  }

  private takeFailure(method: keyof AuthService): AuthFailure | null {
    const reason = this.failures.get(method);
    if (reason === undefined) return null;
    this.failures.delete(method);
    return { ok: false, reason };
  }
}
