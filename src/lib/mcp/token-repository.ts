import type { McpTokenExpiry } from "@/lib/mcp/token-expiry";

/** A personal token as its owner sees it: never the secret or its hash. */
export type McpToken = {
  id: string;
  name: string;
  /** The token's first 13 characters (`sl_mcp_Ab3xQ9`), shown in the list. */
  prefix: string;
  createdAt: string;
  regeneratedAt: string | null;
  lastUsedAt: string | null;
  /** Null when it never expires. */
  expiresAt: string | null;
};

export type McpAccess = {
  status: "ok" | "mcp_off" | "not_permitted" | "email_required";
  /** False for kids, who connect through OAuth only. */
  personalTokens: boolean;
};

/** What `check` finds for a token, in the database's order: unknown, revoked, expired, kid_token, then access. */
export type McpTokenCheck =
  | { status: "ok"; tokenId: string; user: { id: string; email: string } }
  | { status: "unknown" | "revoked" | "expired" | "kid_token" | Exclude<McpAccess["status"], "ok"> };

/**
 * Personal MCP tokens, the MCP switch and the access check. Get it from `getRepositories()`; never
 * import an implementation.
 *
 * Every method except `check` acts as the signed-in caller, on their own switch and tokens; none takes
 * a user id. Expected refusals are `DomainError`s with the database's message: 403 for kids (tokens)
 * and for a kid who can't turn the switch on, 409 at 10 live tokens, 404 for a token that isn't the
 * caller's (or is revoked), 422 for a bad name or expiry.
 */
export interface McpTokenRepository {
  /** The caller's access: the switch, and for a kid the permission and email. */
  access(): Promise<McpAccess>;
  /** Turns the caller's switch on or off. Turning it off always works. */
  setEnabled(enabled: boolean): Promise<void>;
  /** The caller's tokens that aren't revoked (expired ones included), newest first. */
  list(): Promise<McpToken[]>;
  create(input: { name: string; hash: string; prefix: string; expiry: McpTokenExpiry }): Promise<McpToken>;
  /** Swaps a new secret into one of the caller's unrevoked tokens (expired ones too); the old one stops working at once. */
  regenerate(id: string, input: { hash: string; prefix: string; expiry: McpTokenExpiry }): Promise<McpToken>;
  /** False, changing nothing, when the token isn't the caller's or is already revoked. */
  revoke(id: string): Promise<boolean>;
  /**
   * Looks a personal token up by its hash, with no signed-in user. On `ok` it also records the use
   * (at most every 5 minutes).
   * SECURITY: runs with the secret key (authenticate_mcp_token is granted to service_role only).
   */
  check(hash: string): Promise<McpTokenCheck>;
}
