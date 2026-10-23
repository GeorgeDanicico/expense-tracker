import { randomUUID } from "node:crypto";

import { DomainError } from "@/lib/errors";
import { KID_EMAIL_DOMAIN } from "@/lib/family/kid-account";
import type { McpAccess, McpToken, McpTokenCheck, McpTokenRepository } from "@/lib/mcp/token-repository";
import { MCP_TOKEN_EXPIRIES, type McpTokenExpiry } from "@/lib/mcp/token-expiry";

/** What the fake knows about an account: its email, its switch, and for a kid member their `mcp` permission. */
export type FakeMcpUser = { email: string; enabled: boolean; kid: { mcp: boolean } | null };

/** A token as the fake stores it: what `list()` shows, plus what only the database knows. */
export type FakeMcpToken = McpToken & { userId: string; hash: string; revokedAt: string | null };

// The SQL's messages (supabase/migrations/20261023000200_create_mcp_access.sql).
const KID_TOKENS = "Kids connect AI assistants through the app's sign-in page, not with tokens.";
const BAD_EXPIRY = "Choose an expiry: 1 month, 3 months, 6 months or never.";
const AT_CAP = "You can have at most 10 personal tokens. Revoke one to create another.";
const NOT_FOUND = "Token not found.";
const NOT_PERMITTED = "A parent needs to turn on AI assistants for you.";
const EMAIL_REQUIRED = "Add and confirm an email address in Settings to use AI assistants.";
// The Supabase repository's messages for a check-constraint failure.
const NAME_INVALID = "Give the token a name of 1 to 40 characters.";
const TOKEN_INVALID = "That token isn't valid.";

const MAX_LIVE_TOKENS = 10;
const MONTHS: Record<Exclude<McpTokenExpiry, "never">, number> = { "1m": 1, "3m": 3, "6m": 6 };
const LAST_USED_THROTTLE_MS = 5 * 60_000;

/**
 * In-memory `McpTokenRepository`, following the SQL's rules and messages. `users` holds each account's
 * switch and kid state (an account missing from it is an adult with the switch off); `tokens` holds
 * every user's tokens, revoked ones included. Every method but `check` acts on `caller` (`testUser`
 * from `@/test/route` by default; set it to match `signedInAs`). `now` is the clock for expiries.
 * `calls` records every method call.
 */
export class FakeMcpTokenRepository implements McpTokenRepository {
  caller = { userId: "10000000-0000-4000-8000-000000000001" };
  readonly users = new Map<string, FakeMcpUser>();
  tokens: FakeMcpToken[] = [];
  now = () => new Date();
  readonly calls: (keyof McpTokenRepository)[] = [];

  private user(userId: string): FakeMcpUser {
    let user = this.users.get(userId);
    if (!user) {
      user = { email: `${userId}@example.test`, enabled: false, kid: null };
      this.users.set(userId, user);
    }
    return user;
  }

  /** Like `kid_block_reason`: why a kid can't use MCP whatever their switch says, or null. */
  private kidBlockReason(user: FakeMcpUser): "not_permitted" | "email_required" | null {
    if (!user.kid) return null;
    if (!user.kid.mcp) return "not_permitted";
    if (user.email.toLowerCase().endsWith(`@${KID_EMAIL_DOMAIN}`)) return "email_required";
    return null;
  }

  /** Like `access_status`: the switch first, then the kid rules. */
  private accessStatus(user: FakeMcpUser): McpAccess["status"] {
    if (!user.enabled) return "mcp_off";
    return this.kidBlockReason(user) ?? "ok";
  }

  private isLive(token: FakeMcpToken) {
    return token.revokedAt === null && (token.expiresAt === null || Date.parse(token.expiresAt) > this.now().getTime());
  }

  /** Like `token_expires_at`: months from now, or null for "never"; 422 for anything else. */
  private expiresAt(expiry: McpTokenExpiry): string | null {
    if (!MCP_TOKEN_EXPIRIES.includes(expiry)) throw new DomainError(BAD_EXPIRY, 422);
    if (expiry === "never") return null;
    const date = this.now();
    date.setUTCMonth(date.getUTCMonth() + MONTHS[expiry]);
    return date.toISOString();
  }

  /** The table's check constraints. */
  private checkRow({ name, hash, prefix }: { name?: string; hash: string; prefix: string }) {
    if (name !== undefined && (name !== name.trim() || name.length < 1 || name.length > 40)) {
      throw new DomainError(NAME_INVALID, 422);
    }
    if (!/^[0-9a-f]{64}$/.test(hash) || !/^sl_mcp_[A-Za-z0-9_-]{6}$/.test(prefix)) {
      throw new DomainError(TOKEN_INVALID, 422);
    }
  }

  private refuseKids(userId: string) {
    if (this.user(userId).kid) throw new DomainError(KID_TOKENS, 403);
  }

  private liveCount(userId: string, exceptId?: string) {
    return this.tokens.filter((token) => token.userId === userId && token.id !== exceptId && this.isLive(token)).length;
  }

  private view({ id, name, prefix, createdAt, regeneratedAt, lastUsedAt, expiresAt }: FakeMcpToken): McpToken {
    return { id, name, prefix, createdAt, regeneratedAt, lastUsedAt, expiresAt };
  }

  async access(): Promise<McpAccess> {
    this.calls.push("access");
    const user = this.user(this.caller.userId);
    return { status: this.accessStatus(user), personalTokens: user.kid === null, blockReason: this.kidBlockReason(user) };
  }

  /** Like the switch guard: a kid who can't use MCP can't turn it on; turning it off always works. */
  async setEnabled(enabled: boolean) {
    this.calls.push("setEnabled");
    const user = this.user(this.caller.userId);
    if (enabled && !user.enabled) {
      const reason = this.kidBlockReason(user);
      if (reason === "not_permitted") throw new DomainError(NOT_PERMITTED, 403);
      if (reason === "email_required") throw new DomainError(EMAIL_REQUIRED, 403);
    }
    user.enabled = enabled;
  }

  async list() {
    this.calls.push("list");
    return this.tokens
      .filter((token) => token.userId === this.caller.userId && token.revokedAt === null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map((token) => this.view(token));
  }

  async create({ name, hash, prefix, expiry }: { name: string; hash: string; prefix: string; expiry: McpTokenExpiry }) {
    this.calls.push("create");
    const { userId } = this.caller;
    this.refuseKids(userId);
    const expiresAt = this.expiresAt(expiry);
    if (this.liveCount(userId) >= MAX_LIVE_TOKENS) throw new DomainError(AT_CAP, 409);
    this.checkRow({ name, hash, prefix });

    const token: FakeMcpToken = {
      id: randomUUID(),
      userId,
      name,
      prefix,
      hash,
      createdAt: this.now().toISOString(),
      regeneratedAt: null,
      lastUsedAt: null,
      expiresAt,
      revokedAt: null,
    };
    this.tokens.push(token);
    return this.view(token);
  }

  async regenerate(id: string, { hash, prefix, expiry }: { hash: string; prefix: string; expiry: McpTokenExpiry }) {
    this.calls.push("regenerate");
    const { userId } = this.caller;
    this.refuseKids(userId);
    const expiresAt = this.expiresAt(expiry);
    const token = this.tokens.find((candidate) => candidate.id === id && candidate.userId === userId && candidate.revokedAt === null);
    if (!token) throw new DomainError(NOT_FOUND, 404);
    if (this.liveCount(userId, id) >= MAX_LIVE_TOKENS) throw new DomainError(AT_CAP, 409);
    this.checkRow({ hash, prefix });

    Object.assign(token, { hash, prefix, expiresAt, regeneratedAt: this.now().toISOString(), lastUsedAt: null });
    return this.view(token);
  }

  async revoke(id: string) {
    this.calls.push("revoke");
    const token = this.tokens.find(
      (candidate) => candidate.id === id && candidate.userId === this.caller.userId && candidate.revokedAt === null,
    );
    if (!token) return false;
    token.revokedAt = this.now().toISOString();
    return true;
  }

  /** Like `authenticate_mcp_token`: unknown, revoked, expired, kid_token, then the owner's access. */
  async check(hash: string): Promise<McpTokenCheck> {
    this.calls.push("check");
    const token = this.tokens.find((candidate) => candidate.hash === hash);
    if (!token) return { status: "unknown" };
    if (token.revokedAt !== null) return { status: "revoked" };
    if (!this.isLive(token)) return { status: "expired" };

    const owner = this.user(token.userId);
    if (owner.kid) return { status: "kid_token" };
    const status = this.accessStatus(owner);
    if (status !== "ok") return { status };

    const now = this.now();
    if (token.lastUsedAt === null || now.getTime() - Date.parse(token.lastUsedAt) > LAST_USED_THROTTLE_MS) {
      token.lastUsedAt = now.toISOString();
    }
    return { status: "ok", tokenId: token.id, user: { id: token.userId, email: owner.email } };
  }
}
