import { AsyncLocalStorage } from "node:async_hooks";

import type { AuthAdmin, CreatedUser, CreateUserInput } from "@/lib/auth/admin";
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
import { DomainError } from "@/lib/errors";

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

/** The kid-account columns `FakeAuthAdmin` keeps for each account it creates, as `profiles` stores them. */
export type FakeAdminProfile = {
  username: string;
  displayName: string;
  managedByFamily: string | null;
  mustChangePassword: boolean;
};

/**
 * In-memory `AuthAdmin` for route and service tests. Its accounts live in a `FakeAuth`, so an account
 * it creates can sign in through that fake, and a password it sets is the one sign-in checks:
 *
 *   let auth: FakeAuth;
 *   let admin: FakeAuthAdmin;
 *   vi.mock("@/lib/auth", () => ({ getAuth: () => auth, getAuthAdmin: () => admin }));
 *   beforeEach(() => { auth = new FakeAuth(); admin = new FakeAuthAdmin(auth); });
 *
 * Seed a username account with `createUser`, assert on `profiles`, `auth.accounts` and
 * `deletedUserIds`, and use `fail(method, error)` to make the next call of that method throw `error`.
 * Its errors match the Supabase implementation's: 409 for a taken email or username, 404 for an
 * unknown account.
 */
export class FakeAuthAdmin implements AuthAdmin {
  /** The profile columns of every account created here, by user id. */
  readonly profiles = new Map<string, FakeAdminProfile>();
  /** The user ids passed to `deleteUser`, oldest first. */
  readonly deletedUserIds: string[] = [];

  private readonly failures = new Map<keyof AuthAdmin, Error>();

  constructor(readonly auth: FakeAuth = new FakeAuth()) {}

  /** Makes the next call of `method` throw `error`. */
  fail(method: keyof AuthAdmin, error: Error = new Error("Auth admin failure")) {
    this.failures.set(method, error);
  }

  async createUser({ email, password, ...profile }: CreateUserInput): Promise<CreatedUser> {
    this.throwFailure("createUser");
    if (this.auth.accounts.some((account) => account.email === email)) {
      throw new DomainError("An account with that email already exists.", 409);
    }
    if ([...this.profiles.values()].some((existing) => existing.username === profile.username)) {
      throw new DomainError("That username is taken.", 409);
    }
    const user = this.auth.addUser(email, password);
    this.profiles.set(user.id, { ...profile });
    return user;
  }

  async deleteUser(userId: string): Promise<void> {
    this.throwFailure("deleteUser");
    this.deletedUserIds.push(userId);
    const index = this.auth.accounts.findIndex((account) => account.id === userId);
    if (index < 0) throw new DomainError("That account doesn't exist.", 404);
    this.auth.accounts.splice(index, 1);
    this.profiles.delete(userId);
  }

  async setPassword(userId: string, password: string): Promise<void> {
    this.throwFailure("setPassword");
    const account = this.auth.accounts.find((candidate) => candidate.id === userId);
    if (!account) throw new DomainError("That account doesn't exist.", 404);
    account.password = password;
  }

  async findEmailByUsername(username: string): Promise<string | null> {
    this.throwFailure("findEmailByUsername");
    const wanted = username.trim().toLowerCase();
    const userId = [...this.profiles].find(([, profile]) => profile.username === wanted)?.[0];
    return this.auth.accounts.find((account) => account.id === userId)?.email ?? null;
  }

  private throwFailure(method: keyof AuthAdmin) {
    const error = this.failures.get(method);
    if (error === undefined) return;
    this.failures.delete(method);
    throw error;
  }
}
