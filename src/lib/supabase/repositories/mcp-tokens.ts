import "server-only";

import { getAuthenticatedUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import type { McpAccess, McpToken, McpTokenCheck, McpTokenRepository } from "@/lib/mcp/token-repository";
import { createAdminClient } from "@/lib/supabase/admin-client";
import { translateDatabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const ACCESS_ERROR = "Unable to load your AI assistant settings.";
const SWITCH_ERROR = "Unable to save your AI assistant setting. Please try again.";
const LIST_ERROR = "Unable to load your personal tokens.";
const SAVE_ERROR = "Unable to save the token. Please try again.";
const REVOKE_ERROR = "Unable to revoke the token. Please try again.";
const CHECK_ERROR = "Unable to check the personal token.";
const NAME_INVALID = "Give the token a name of 1 to 40 characters.";
const TOKEN_INVALID = "That token isn't valid.";

// Never `token_hash`: signed-in users aren't granted it.
const TOKEN_COLUMNS = "id, name, prefix, created_at, regenerated_at, last_used_at, expires_at";

const ACCESS_STATUSES: readonly string[] = ["ok", "mcp_off", "not_permitted", "email_required"];
const BLOCK_REASONS: readonly unknown[] = [null, "not_permitted", "email_required"];
const REFUSED_STATUSES: readonly string[] = ["unknown", "revoked", "expired", "kid_token", "mcp_off", "not_permitted", "email_required"];

type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  regenerated_at: string | null;
  last_used_at: string | null;
  expires_at: string | null;
};

function toToken(row: TokenRow): McpToken {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.created_at,
    regeneratedAt: row.regenerated_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
}

/**
 * The token functions' own codes on top of `translateDatabaseError`: P0001 is the 10-token cap (409)
 * and 22023 a bad expiry (422), both with the database's message. A 23514 is a check constraint, whose
 * message isn't written for users, so it gets ours: the name's, or (a hash or prefix that isn't from
 * `generateMcpToken`) a generic one.
 */
function translateTokenError(error: { code?: string; message: string }): Error {
  if (error.code === "P0001") return new DomainError(error.message, 409);
  if (error.code === "22023") return new DomainError(error.message, 422);
  if (error.code === "23514") {
    return new DomainError(error.message.includes("mcp_tokens_name_valid") ? NAME_INVALID : TOKEN_INVALID, 422);
  }
  return translateDatabaseError(error, SAVE_ERROR);
}

function firstToken(data: TokenRow[] | null): McpToken {
  const row = data?.[0];
  if (!row) throw new Error(SAVE_ERROR);
  return toToken(row);
}

/**
 * `McpTokenRepository` on `profiles.mcp_enabled`, `mcp_tokens` and the M2 functions
 * (supabase/migrations/20261023000200_create_mcp_access.sql, and 20261023000300_add_mcp_block_reason.sql for `blockReason`). Everything but `check` acts as the
 * request's caller, under RLS.
 */
export const supabaseMcpTokenRepository: McpTokenRepository = {
  async access(): Promise<McpAccess> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("my_mcp_access");

    if (error) throw translateDatabaseError(error, ACCESS_ERROR);
    const access = data as { status?: unknown; personalTokens?: unknown; blockReason?: unknown } | null;
    if (
      typeof access?.status !== "string" ||
      !ACCESS_STATUSES.includes(access.status) ||
      typeof access.personalTokens !== "boolean" ||
      !BLOCK_REASONS.includes(access.blockReason)
    ) {
      throw new Error(ACCESS_ERROR);
    }
    return {
      status: access.status as McpAccess["status"],
      personalTokens: access.personalTokens,
      blockReason: access.blockReason as McpAccess["blockReason"],
    };
  },

  /** On the caller's own profile row; the switch guard trigger refuses a kid who can't turn it on (42501). */
  async setEnabled(enabled) {
    const user = await getAuthenticatedUser();
    if (!user) throw new Error(SWITCH_ERROR);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .update({ mcp_enabled: enabled })
      .eq("id", user.id)
      .select("id");

    if (error) throw translateDatabaseError(error, SWITCH_ERROR);
    // Every user has a profile row (handle_new_user); no row updated means something is wrong.
    if (!data?.length) throw new Error(SWITCH_ERROR);
  },

  /** RLS limits the rows to the caller's own. */
  async list() {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("mcp_tokens")
      .select(TOKEN_COLUMNS)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (error) throw translateDatabaseError(error, LIST_ERROR);
    return (data ?? []).map(toToken);
  },

  async create({ name, hash, prefix, expiry }) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_mcp_token", {
      p_name: name,
      p_token_hash: hash,
      p_prefix: prefix,
      p_expiry: expiry,
    });

    if (error) throw translateTokenError(error);
    return firstToken(data);
  },

  /** P0002 (someone else's, revoked or unknown token) becomes a 404 through `translateDatabaseError`. */
  async regenerate(id, { hash, prefix, expiry }) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("regenerate_mcp_token", {
      p_id: id,
      p_token_hash: hash,
      p_prefix: prefix,
      p_expiry: expiry,
    });

    if (error) throw translateTokenError(error);
    return firstToken(data);
  },

  async revoke(id) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("revoke_mcp_token", { p_id: id });

    if (error) throw translateDatabaseError(error, REVOKE_ERROR);
    return data === true;
  },

  async check(hash): Promise<McpTokenCheck> {
    // SECURITY: secret key, for the one function granted to service_role only. It reads the token by
    // its hash and returns its owner; it never acts on anyone's data.
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("authenticate_mcp_token", { p_token_hash: hash });

    if (error) throw new Error(CHECK_ERROR);
    const row = data?.[0];
    if (row?.status === "ok" && row.token_id && row.user_id && row.email) {
      return { status: "ok", tokenId: row.token_id, user: { id: row.user_id, email: row.email } };
    }
    if (row && REFUSED_STATUSES.includes(row.status)) {
      return { status: row.status as Exclude<McpTokenCheck["status"], "ok"> };
    }
    throw new Error(CHECK_ERROR);
  },
};
