import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createAdminClient: vi.fn(), getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin-client", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

import { supabaseMcpTokenRepository as tokens } from "@/lib/supabase/repositories/mcp-tokens";

const user = { id: "10000000-0000-4000-8000-000000000081", email: "owner@example.test" };
const otherUser = { id: "10000000-0000-4000-8000-000000000082", email: "other@example.test" };
const tokenId = "a0000000-0000-4000-8000-000000000081";
const hash = "a".repeat(64);
const prefix = "sl_mcp_Ab3xQ9";

const SAVE_ERROR = new Error("Unable to save the token. Please try again.");
const CHECK_ERROR = new Error("Unable to check the personal token.");

/** A token function's row: no hash, with user_id and revoked_at. */
const row = {
  id: tokenId,
  user_id: user.id,
  name: "VPS",
  prefix,
  created_at: "2026-10-23T10:00:00Z",
  regenerated_at: null,
  last_used_at: null,
  expires_at: "2027-01-23T10:00:00Z",
  revoked_at: null,
};
const token = {
  id: tokenId,
  name: "VPS",
  prefix,
  createdAt: "2026-10-23T10:00:00Z",
  regeneratedAt: null,
  lastUsedAt: null,
  expiresAt: "2027-01-23T10:00:00Z",
};

/** The request client: acts as the caller, through their session. */
function useRequestClient(tables: Record<string, Record<string, unknown>[]> = {}, options?: FakeSupabaseOptions) {
  const database = fakeSupabase(tables, options);
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

function useRpc(answer: (fn: string) => { data: unknown; error: unknown }) {
  return useRequestClient({}, { rpc: answer });
}

function useAdminRpc(answer: (fn: string) => { data: unknown; error: unknown }) {
  const database = fakeSupabase({}, { rpc: answer });
  mocks.createAdminClient.mockReturnValue(database.client);
  return database;
}

describe("Supabase MCP token repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(user);
  });

  describe("access", () => {
    it("calls my_mcp_access as the caller and returns its answer", async () => {
      const { rpcs } = useRpc(() => ({ data: { status: "ok", personalTokens: true }, error: null }));

      expect(await tokens.access()).toEqual({ status: "ok", personalTokens: true });
      expect(rpcs).toEqual([{ fn: "my_mcp_access", args: {} }]);
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    });

    it.each(["mcp_off", "not_permitted", "email_required"])("passes on the %s status", async (status) => {
      useRpc(() => ({ data: { status, personalTokens: false }, error: null }));

      expect(await tokens.access()).toEqual({ status, personalTokens: false });
    });

    it.each([
      ["an unknown status", { status: "maybe", personalTokens: true }],
      ["a missing personalTokens", { status: "ok" }],
      ["no answer", null],
    ])("rejects %s", async (_, data) => {
      useRpc(() => ({ data, error: null }));

      await expect(tokens.access()).rejects.toThrow(new Error("Unable to load your AI assistant settings."));
    });

    it("hides a database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(tokens.access()).rejects.toThrow(new Error("Unable to load your AI assistant settings."));
    });
  });

  describe("setEnabled", () => {
    it("updates only the caller's own profile row", async () => {
      const { queries, tables } = useRequestClient({
        profiles: [{ id: otherUser.id, mcp_enabled: false }, { id: user.id, mcp_enabled: false }],
      });

      await expect(tokens.setEnabled(true)).resolves.toBeUndefined();
      expect(queries).toEqual([
        expect.objectContaining({ table: "profiles", operation: "update", values: { mcp_enabled: true }, filters: [["eq", "id", user.id]] }),
      ]);
      expect(tables.profiles).toEqual([{ id: otherUser.id, mcp_enabled: false }, { id: user.id, mcp_enabled: true }]);
    });

    it("keeps the switch guard's message in a 403", async () => {
      const message = "A parent needs to turn on AI assistants for you.";
      useRequestClient({ profiles: [{ id: user.id, mcp_enabled: false }] }, { fail: () => ({ code: "42501", message }) });

      await expect(tokens.setEnabled(true)).rejects.toThrow(new DomainError(message, 403));
    });

    it("fails when no profile row was updated", async () => {
      useRequestClient({ profiles: [{ id: otherUser.id, mcp_enabled: false }] });

      await expect(tokens.setEnabled(false)).rejects.toThrow(new Error("Unable to save your AI assistant setting. Please try again."));
    });

    it("throws before querying when nobody is signed in", async () => {
      mocks.getAuthenticatedUser.mockResolvedValue(null);
      const { queries } = useRequestClient();

      await expect(tokens.setEnabled(true)).rejects.toThrow(new Error("Unable to save your AI assistant setting. Please try again."));
      expect(queries).toEqual([]);
    });

    it("hides any other database error behind a generic message", async () => {
      useRequestClient({ profiles: [{ id: user.id, mcp_enabled: false }] }, { fail: () => true });

      await expect(tokens.setEnabled(true)).rejects.toThrow(new Error("Unable to save your AI assistant setting. Please try again."));
    });
  });

  describe("list", () => {
    it("reads unrevoked tokens newest first, without the hash", async () => {
      const older = { ...row, id: "a0000000-0000-4000-8000-000000000082", created_at: "2026-10-01T10:00:00Z", expires_at: "2026-10-02T10:00:00Z" };
      const revoked = { ...row, id: "a0000000-0000-4000-8000-000000000083", revoked_at: "2026-10-20T10:00:00Z" };
      const { queries } = useRequestClient({ mcp_tokens: [older, revoked, row] });

      expect(await tokens.list()).toEqual([
        token,
        { ...token, id: older.id, createdAt: older.created_at, expiresAt: older.expires_at },
      ]);
      expect(queries).toEqual([
        expect.objectContaining({
          table: "mcp_tokens",
          operation: "select",
          filters: [["is", "revoked_at", null]],
          orders: ["created_at", "id"],
        }),
      ]);
    });

    it("never selects token_hash", async () => {
      // The fake ignores columns, so record what is passed to select.
      const { client } = useRequestClient({ mcp_tokens: [] });
      const selected: unknown[] = [];
      const from = client.from;
      client.from = (table: string) => {
        const query = from(table);
        const select = query.select.bind(query);
        query.select = (...columns: unknown[]) => {
          selected.push(...columns);
          return select(...columns);
        };
        return query;
      };

      await tokens.list();

      expect(selected).toEqual(["id, name, prefix, created_at, regenerated_at, last_used_at, expires_at"]);
    });

    it("hides a database error behind a generic message", async () => {
      useRequestClient({}, { fail: () => true });

      await expect(tokens.list()).rejects.toThrow(new Error("Unable to load your personal tokens."));
    });
  });

  describe("create", () => {
    it("calls create_mcp_token with the hash, prefix and expiry and maps the row", async () => {
      const { rpcs } = useRpc(() => ({ data: [row], error: null }));

      expect(await tokens.create({ name: "VPS", hash, prefix, expiry: "3m" })).toEqual(token);
      expect(rpcs).toEqual([
        { fn: "create_mcp_token", args: { p_name: "VPS", p_token_hash: hash, p_prefix: prefix, p_expiry: "3m" } },
      ]);
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    });

    it("fails when the function returns no row", async () => {
      useRpc(() => ({ data: [], error: null }));

      await expect(tokens.create({ name: "VPS", hash, prefix, expiry: "3m" })).rejects.toThrow(SAVE_ERROR);
    });
  });

  describe("regenerate", () => {
    it("calls regenerate_mcp_token with the id, hash, prefix and expiry and maps the row", async () => {
      const regenerated = { ...row, regenerated_at: "2026-10-23T12:00:00Z", expires_at: null };
      const { rpcs } = useRpc(() => ({ data: [regenerated], error: null }));

      expect(await tokens.regenerate(tokenId, { hash, prefix, expiry: "never" })).toEqual({
        ...token,
        regeneratedAt: "2026-10-23T12:00:00Z",
        expiresAt: null,
      });
      expect(rpcs).toEqual([
        { fn: "regenerate_mcp_token", args: { p_id: tokenId, p_token_hash: hash, p_prefix: prefix, p_expiry: "never" } },
      ]);
    });

    it("translates an unknown, revoked or other user's token into a 404", async () => {
      useRpc(() => ({ data: null, error: { code: "P0002", message: "Token not found." } }));

      await expect(tokens.regenerate(tokenId, { hash, prefix, expiry: "3m" })).rejects.toThrow(new DomainError("Token not found.", 404));
    });
  });

  describe.each([
    ["create", () => tokens.create({ name: "VPS", hash, prefix, expiry: "3m" })],
    ["regenerate", () => tokens.regenerate(tokenId, { hash, prefix, expiry: "3m" })],
  ])("%s errors", (_, write) => {
    it("keeps the kid refusal's message in a 403", async () => {
      const message = "Kids connect AI assistants through the app's sign-in page, not with tokens.";
      useRpc(() => ({ data: null, error: { code: "42501", message } }));

      await expect(write()).rejects.toThrow(new DomainError(message, 403));
    });

    it("keeps the cap's message in a 409", async () => {
      const message = "You can have at most 10 personal tokens. Revoke one to create another.";
      useRpc(() => ({ data: null, error: { code: "P0001", message } }));

      await expect(write()).rejects.toThrow(new DomainError(message, 409));
    });

    it("keeps the bad expiry's message in a 422", async () => {
      const message = "Choose an expiry: 1 month, 3 months, 6 months or never.";
      useRpc(() => ({ data: null, error: { code: "22023", message } }));

      await expect(write()).rejects.toThrow(new DomainError(message, 422));
    });

    it("turns a bad name into a 422 with a message for users", async () => {
      useRpc(() => ({
        data: null,
        error: { code: "23514", message: 'new row for relation "mcp_tokens" violates check constraint "mcp_tokens_name_valid"' },
      }));

      await expect(write()).rejects.toThrow(new DomainError("Give the token a name of 1 to 40 characters.", 422));
    });

    it("turns a bad hash or prefix into a generic 422", async () => {
      useRpc(() => ({
        data: null,
        error: { code: "23514", message: 'new row for relation "mcp_tokens" violates check constraint "mcp_tokens_hash_format"' },
      }));

      await expect(write()).rejects.toThrow(new DomainError("That token isn't valid.", 422));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(write()).rejects.toThrow(SAVE_ERROR);
    });
  });

  describe("revoke", () => {
    it("calls revoke_mcp_token with the id and returns its answer", async () => {
      const { rpcs } = useRpc(() => ({ data: true, error: null }));

      expect(await tokens.revoke(tokenId)).toBe(true);
      expect(rpcs).toEqual([{ fn: "revoke_mcp_token", args: { p_id: tokenId } }]);
    });

    it("is false for a token that isn't the caller's or is already revoked", async () => {
      useRpc(() => ({ data: false, error: null }));

      expect(await tokens.revoke(tokenId)).toBe(false);
    });

    it("hides a database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(tokens.revoke(tokenId)).rejects.toThrow(new Error("Unable to revoke the token. Please try again."));
    });
  });

  describe("check", () => {
    it("calls authenticate_mcp_token with the secret-key client and returns the owner on ok", async () => {
      const { rpcs } = useAdminRpc(() => ({
        data: [{ status: "ok", token_id: tokenId, user_id: user.id, email: user.email }],
        error: null,
      }));

      expect(await tokens.check(hash)).toEqual({ status: "ok", tokenId, user: { id: user.id, email: user.email } });
      expect(rpcs).toEqual([{ fn: "authenticate_mcp_token", args: { p_token_hash: hash } }]);
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
    });

    it.each(["unknown", "revoked", "expired", "kid_token", "mcp_off", "not_permitted", "email_required"])(
      "passes on the %s status alone",
      async (status) => {
        useAdminRpc(() => ({
          data: [{ status, token_id: status === "unknown" ? null : tokenId, user_id: status === "unknown" ? null : user.id, email: null }],
          error: null,
        }));

        expect(await tokens.check(hash)).toEqual({ status });
      },
    );

    it.each([
      ["an unknown status", [{ status: "maybe", token_id: null, user_id: null, email: null }]],
      ["ok without an email", [{ status: "ok", token_id: tokenId, user_id: user.id, email: null }]],
      ["no row", []],
    ])("rejects %s", async (_, data) => {
      useAdminRpc(() => ({ data, error: null }));

      await expect(tokens.check(hash)).rejects.toThrow(CHECK_ERROR);
    });

    it("hides a database error behind a generic message", async () => {
      useAdminRpc(() => ({ data: null, error: { code: "42501", message: "permission denied" } }));

      await expect(tokens.check(hash)).rejects.toThrow(CHECK_ERROR);
    });
  });
});
