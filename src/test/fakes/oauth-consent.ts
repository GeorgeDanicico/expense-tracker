import type { ConnectedApp, ConsentRequest, OAuthApp, OAuthConsent } from "@/lib/auth/oauth-consent";
import { DomainError } from "@/lib/errors";
import { FakeAuth } from "@/test/fakes/auth";

type FakeRequest = {
  userId: string;
  app: OAuthApp;
  redirectUri: string;
  scopes: string[];
  /** When true, `getRequest` answers `already_approved`, as Supabase does for an app it auto-approves. */
  alreadyApproved: boolean;
};

export type FakeRequestInput = {
  app?: Partial<OAuthApp>;
  redirectUri?: string;
  scopes?: string[];
  alreadyApproved?: boolean;
};

/**
 * In-memory `OAuthConsent` for route and component tests. The caller is the `FakeAuth`'s current
 * user, and disconnecting an app ends its tokens there, so `verifyAppToken` refuses them next:
 *
 *   let auth: FakeAuth;
 *   let consent: FakeOAuthConsent;
 *   vi.mock("@/lib/auth", () => ({ getAuth: () => auth, getOAuthConsent: () => consent }));
 *   beforeEach(() => { auth = new FakeAuth(); consent = new FakeOAuthConsent(auth); });
 *
 * Seed requests with `addRequest` and grants with `approve` (or `addGrant`), and use
 * `fail(method, error)` to make the next call of that method throw `error`. Its errors match the
 * Supabase implementation's: 404 for a request that is unknown or someone else's.
 */
export class FakeOAuthConsent implements OAuthConsent {
  /** Pending authorization requests, by id. */
  readonly requests = new Map<string, FakeRequest>();
  /** Every live grant, oldest first. */
  readonly grants: (ConnectedApp & { userId: string })[] = [];

  private readonly failures = new Map<keyof OAuthConsent, Error>();
  private nextId = 1;

  constructor(readonly auth: FakeAuth = new FakeAuth()) {}

  /** Makes the next call of `method` throw `error`. */
  fail(method: keyof OAuthConsent, error: Error = new Error("OAuth consent failure")) {
    this.failures.set(method, error);
  }

  /** A pending request by `userId`'s browser; returns its authorization id. */
  addRequest(userId: string, input: FakeRequestInput = {}): string {
    const id = `authorization-${this.nextId++}`;
    this.requests.set(id, {
      userId,
      app: { clientId: "client-1", name: "Claude Code (simple-ledger)", uri: null, logoUri: null, ...input.app },
      redirectUri: input.redirectUri ?? "http://localhost:4567/callback",
      scopes: input.scopes ?? ["email"],
      alreadyApproved: input.alreadyApproved ?? false,
    });
    return id;
  }

  /** A grant `userId` already gave, as if they had clicked Allow earlier. */
  addGrant(userId: string, app: Partial<OAuthApp> = {}, connectedAt = new Date().toISOString()) {
    this.grants.push({
      userId,
      clientId: "client-1",
      name: "Claude Code (simple-ledger)",
      uri: null,
      logoUri: null,
      ...app,
      scopes: ["email"],
      connectedAt,
    });
  }

  async getRequest(authorizationId: string): Promise<ConsentRequest | null> {
    this.throwFailure("getRequest");
    const request = await this.callersRequest(authorizationId);
    if (!request) return null;
    if (request.alreadyApproved) return { kind: "already_approved", redirectUrl: this.codeUrl(request) };
    return { kind: "needs_consent", authorizationId, app: { ...request.app }, redirectUri: request.redirectUri, scopes: [...request.scopes] };
  }

  async approve(authorizationId: string): Promise<{ redirectUrl: string }> {
    this.throwFailure("approve");
    const request = await this.callersRequest(authorizationId);
    if (!request) throw new DomainError("That authorization request doesn't exist or has expired.", 404);
    this.requests.delete(authorizationId);
    if (!this.grants.some((grant) => grant.userId === request.userId && grant.clientId === request.app.clientId)) {
      this.grants.push({ userId: request.userId, ...request.app, scopes: [...request.scopes], connectedAt: new Date().toISOString() });
    }
    return { redirectUrl: this.codeUrl(request) };
  }

  async deny(authorizationId: string): Promise<{ redirectUrl: string }> {
    this.throwFailure("deny");
    const request = await this.callersRequest(authorizationId);
    if (!request) throw new DomainError("That authorization request doesn't exist or has expired.", 404);
    this.requests.delete(authorizationId);
    return { redirectUrl: `${request.redirectUri}?error=access_denied` };
  }

  async listConnectedApps(): Promise<ConnectedApp[]> {
    this.throwFailure("listConnectedApps");
    const user = await this.auth.getCurrentUser();
    if (!user) throw new Error("Unable to load the connected apps.");
    return this.grants
      .filter((grant) => grant.userId === user.id)
      .map(({ clientId, name, uri, logoUri, scopes, connectedAt }) => ({ clientId, name, uri, logoUri, scopes: [...scopes], connectedAt }));
  }

  async disconnect(clientId: string): Promise<void> {
    this.throwFailure("disconnect");
    const user = await this.auth.getCurrentUser();
    if (!user) throw new Error("Unable to disconnect the app.");
    for (let index = this.grants.length - 1; index >= 0; index--) {
      if (this.grants[index].userId === user.id && this.grants[index].clientId === clientId) this.grants.splice(index, 1);
    }
    this.auth.revokeAppTokens(user.id, clientId);
  }

  private async callersRequest(authorizationId: string): Promise<FakeRequest | null> {
    const user = await this.auth.getCurrentUser();
    const request = this.requests.get(authorizationId);
    return request && user && request.userId === user.id ? request : null;
  }

  private codeUrl(request: FakeRequest) {
    return `${request.redirectUri}?code=code-${this.nextId++}`;
  }

  private throwFailure(method: keyof OAuthConsent) {
    const error = this.failures.get(method);
    if (error === undefined) return;
    this.failures.delete(method);
    throw error;
  }
}
