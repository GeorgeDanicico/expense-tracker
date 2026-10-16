import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { supabaseAccountRepository as account } from "@/lib/supabase/repositories/account";

const user = { id: "10000000-0000-4000-8000-000000000041", email: "owner@example.test" };
const otherUser = { id: "10000000-0000-4000-8000-000000000042", email: "other@example.test" };

function useDatabase(profiles: Record<string, unknown>[], options?: FakeSupabaseOptions) {
  const database = fakeSupabase({ profiles }, options);
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

describe("Supabase account repository", () => {
  beforeEach(() => vi.resetAllMocks());

  describe("getCurrency", () => {
    it("reads the currency from the user's own profile", async () => {
      const { queries } = useDatabase([{ id: otherUser.id, currency: "USD" }, { id: user.id, currency: "RON" }]);

      expect(await account.getCurrency(user.id)).toBe("RON");
      expect(queries[0]).toMatchObject({ table: "profiles", operation: "select", filters: [["eq", "id", user.id]] });
    });

    it("falls back to the default currency when the user has no profile", async () => {
      useDatabase([]);

      expect(await account.getCurrency(user.id)).toBe("EUR");
    });

    it("falls back to the default currency when the stored one is not supported", async () => {
      useDatabase([{ id: user.id, currency: "XYZ" }]);

      expect(await account.getCurrency(user.id)).toBe("EUR");
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase([], { fail: () => true });

      await expect(account.getCurrency(user.id)).rejects.toThrow(new Error("Unable to load account settings."));
    });
  });

  describe("updateCurrency", () => {
    it("creates the user's profile on the first save", async () => {
      const { tables } = useDatabase([]);

      await account.updateCurrency(user, "USD");

      expect(tables.profiles).toEqual([{ id: user.id, email: user.email, currency: "USD" }]);
    });

    it("updates only the user's own profile, matched by id", async () => {
      const { tables, queries } = useDatabase([{ id: user.id, currency: "RON" }, { id: otherUser.id, currency: "RON" }]);

      await account.updateCurrency(user, "USD");

      expect(queries[0]).toMatchObject({ table: "profiles", operation: "upsert", onConflict: "id" });
      expect(tables.profiles).toEqual([
        { id: user.id, email: user.email, currency: "USD" },
        { id: otherUser.id, currency: "RON" },
      ]);
    });

    it("stores a missing email as null", async () => {
      const { tables } = useDatabase([]);

      await account.updateCurrency({ id: user.id, email: "" }, "USD");

      expect(tables.profiles[0]).toMatchObject({ email: null });
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase([], { fail: () => true });

      await expect(account.updateCurrency(user, "USD")).rejects.toThrow(
        new Error("The currency could not be saved. Please try again."),
      );
    });
  });

  describe("getMustChangePassword", () => {
    it("reads the flag from the user's own profile", async () => {
      const { queries } = useDatabase([
        { id: otherUser.id, must_change_password: false },
        { id: user.id, must_change_password: true },
      ]);

      expect(await account.getMustChangePassword(user.id)).toBe(true);
      expect(queries[0]).toMatchObject({ table: "profiles", operation: "select", filters: [["eq", "id", user.id]] });
    });

    it("is false when the flag is not set", async () => {
      useDatabase([{ id: user.id, must_change_password: false }]);

      expect(await account.getMustChangePassword(user.id)).toBe(false);
    });

    it("is false when the user has no profile", async () => {
      useDatabase([{ id: otherUser.id, must_change_password: true }]);

      expect(await account.getMustChangePassword(user.id)).toBe(false);
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase([], { fail: () => true });

      await expect(account.getMustChangePassword(user.id)).rejects.toThrow(new Error("Unable to load account settings."));
    });
  });

  describe("completePasswordChange", () => {
    it("calls complete_password_change without arguments", async () => {
      const { rpcs } = useDatabase([]);

      await account.completePasswordChange();

      expect(rpcs).toEqual([{ fn: "complete_password_change", args: {} }]);
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase([], { rpc: () => ({ data: null, error: { message: "private database failure" } }) });

      await expect(account.completePasswordChange()).rejects.toThrow(
        new Error("Unable to finish changing your password."),
      );
    });
  });
});
