import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createAdminClient: vi.fn(), getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin-client", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

import { supabaseAiGateRepository as ai } from "@/lib/supabase/repositories/ai";

const user = "10000000-0000-4000-8000-000000000151";
const parent = "10000000-0000-4000-8000-000000000152";
const otherParent = "10000000-0000-4000-8000-000000000153";
const kid = "10000000-0000-4000-8000-000000000154";
const family = "20000000-0000-4000-8000-000000000151";
const otherFamily = "20000000-0000-4000-8000-000000000152";
const monthStart = new Date("2026-09-30T21:00:00Z");

/** The request client: acts as the caller, through their session. */
function useRequestClient(tables: Record<string, Record<string, unknown>[]> = {}, options?: FakeSupabaseOptions) {
  const database = fakeSupabase(tables, options);
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

/** The admin client: the secret key, for what a signed-in user may not do. */
function useAdminClient(tables: Record<string, Record<string, unknown>[]> = {}, options?: FakeSupabaseOptions) {
  const database = fakeSupabase(tables, options);
  mocks.createAdminClient.mockReturnValue(database.client);
  return database;
}

const members = () => [
  { user_id: parent, family_id: family, role: "parent" },
  { user_id: otherParent, family_id: family, role: "parent" },
  { user_id: kid, family_id: family, role: "kid" },
  { user_id: user, family_id: otherFamily, role: "parent" },
];

describe("Supabase AI gate repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ id: user, email: "owner@example.test" });
  });

  describe("isEnabled", () => {
    it("reads the ai_enabled flag as the caller", async () => {
      const { queries } = useRequestClient({ app_flags: [{ key: "ai_enabled", value: true }, { key: "other", value: false }] });

      expect(await ai.isEnabled()).toBe(true);
      expect(queries).toMatchObject([{ table: "app_flags", operation: "select", filters: [["eq", "key", "ai_enabled"]] }]);
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    });

    it("is off when the flag is false, missing or not a boolean", async () => {
      useRequestClient({ app_flags: [{ key: "ai_enabled", value: false }] });
      expect(await ai.isEnabled()).toBe(false);

      useRequestClient({ app_flags: [] });
      expect(await ai.isEnabled()).toBe(false);

      useRequestClient({ app_flags: [{ key: "ai_enabled", value: "true" }] });
      expect(await ai.isEnabled()).toBe(false);
    });

    it("fails with a message of ours when the read fails", async () => {
      useRequestClient({}, { fail: () => true });

      await expect(ai.isEnabled()).rejects.toThrow("Unable to check whether AI is on.");
    });
  });

  describe("access", () => {
    it.each(["ok", "ai_off", "not_permitted"])("returns %s from my_ai_access as the caller", async (status) => {
      const { rpcs } = useRequestClient({}, { rpc: () => ({ data: status, error: null }) });

      expect(await ai.access(user)).toBe(status);
      expect(rpcs).toEqual([{ fn: "my_ai_access", args: {} }]);
    });

    it("refuses an answer it doesn't know", async () => {
      useRequestClient({}, { rpc: () => ({ data: "maybe", error: null }) });

      await expect(ai.access(user)).rejects.toThrow("Unable to check your AI settings.");
    });

    it("fails with a message of ours when the call fails", async () => {
      useRequestClient({}, { rpc: () => ({ data: null, error: { message: "private" } }) });

      await expect(ai.access(user)).rejects.toThrow("Unable to check your AI settings.");
    });

    it("acts only for the signed-in user", async () => {
      useRequestClient({}, { rpc: () => ({ data: "ok", error: null }) });

      await expect(ai.access(kid)).rejects.toThrow("The AI gate can only act for the signed-in user.");

      mocks.getAuthenticatedUser.mockResolvedValue(null);
      await expect(ai.access(user)).rejects.toThrow("The AI gate can only act for the signed-in user.");
    });
  });

  describe("spend", () => {
    it("asks ai_family_spend for the month, as the caller", async () => {
      const { rpcs } = useRequestClient({}, { rpc: () => ({ data: 1_750_000, error: null }) });

      expect(await ai.familySpendMicros(user, monthStart)).toBe(1_750_000);
      expect(rpcs).toEqual([{ fn: "ai_family_spend", args: { p_month_start: "2026-09-30T21:00:00.000Z" } }]);
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    });

    it("reads the family's spend only for the signed-in user", async () => {
      useRequestClient({}, { rpc: () => ({ data: 5, error: null }) });

      await expect(ai.familySpendMicros(kid, monthStart)).rejects.toThrow("The AI gate can only act for the signed-in user.");
    });

    it("asks ai_global_spend with the admin client", async () => {
      const { rpcs } = useAdminClient({}, { rpc: () => ({ data: 4_550_000, error: null }) });

      expect(await ai.globalSpendMicros(monthStart)).toBe(4_550_000);
      expect(rpcs).toEqual([{ fn: "ai_global_spend", args: { p_month_start: "2026-09-30T21:00:00.000Z" } }]);
      expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it("fails with a message of ours when a sum is missing or the call fails", async () => {
      useRequestClient({}, { rpc: () => ({ data: null, error: null }) });
      await expect(ai.familySpendMicros(user, monthStart)).rejects.toThrow("Unable to check this month's AI spend.");

      useAdminClient({}, { rpc: () => ({ data: null, error: { message: "private" } }) });
      await expect(ai.globalSpendMicros(monthStart)).rejects.toThrow("Unable to check this month's AI spend.");
    });
  });

  describe("insertUsage", () => {
    const record = {
      userId: kid,
      feature: "statements",
      provider: "openai",
      model: "gpt-5.6-luna",
      inputTokens: 6000,
      outputTokens: 5000,
      cachedInputTokens: 4000,
      costMicros: 7200,
      outcome: "ok" as const,
    };

    it("inserts the ledger row with the admin client, stamped with the user's family at that moment", async () => {
      const { queries, tables } = useAdminClient({ family_members: members(), ai_usage: [] });

      await ai.insertUsage(record);

      expect(tables.ai_usage).toMatchObject([
        {
          user_id: kid,
          family_id: family,
          feature: "statements",
          provider: "openai",
          model: "gpt-5.6-luna",
          input_tokens: 6000,
          output_tokens: 5000,
          cached_input_tokens: 4000,
          cost_micros: 7200,
          outcome: "ok",
        },
      ]);
      expect(queries.map((query) => [query.table, query.operation])).toEqual([["family_members", "select"], ["ai_usage", "insert"]]);
      expect(queries[0].filters).toEqual([["eq", "user_id", kid]]);
      expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it("leaves the family empty for a user without one", async () => {
      const { tables } = useAdminClient({ family_members: members() });

      await ai.insertUsage({ ...record, userId: "10000000-0000-4000-8000-0000000000ff", outcome: "timeout", costMicros: 0 });

      expect(tables.ai_usage).toMatchObject([{ family_id: null, outcome: "timeout", cost_micros: 0 }]);
    });

    it("fails with a message of ours when either query fails", async () => {
      useAdminClient({ family_members: members() }, { fail: (query) => query.table === "family_members" });
      await expect(ai.insertUsage(record)).rejects.toThrow("Unable to record the AI usage.");

      useAdminClient({ family_members: members() }, { fail: (query) => query.table === "ai_usage" });
      await expect(ai.insertUsage(record)).rejects.toThrow("Unable to record the AI usage.");
    });
  });

  describe("setEnabled", () => {
    it("calls set_app_flag for ai_enabled with the admin client and no user", async () => {
      const { rpcs } = useAdminClient();

      await ai.setEnabled(false);

      expect(rpcs).toEqual([{ fn: "set_app_flag", args: { p_key: "ai_enabled", p_value: false } }]);
    });

    it("fails with a message of ours when the call fails", async () => {
      useAdminClient({}, { rpc: () => ({ data: null, error: { message: "private" } }) });

      await expect(ai.setEnabled(false)).rejects.toThrow("Unable to turn AI off.");
    });
  });

  describe("budgetRecipients", () => {
    it("returns the parents of the user's family, not the kids", async () => {
      const { queries } = useAdminClient({ family_members: members() });

      expect(await ai.budgetRecipients(kid)).toEqual({ familyId: family, userIds: [parent, otherParent] });
      expect(queries[1].filters).toEqual([["eq", "family_id", family], ["eq", "role", "parent"]]);
    });

    it("returns the user alone when they have no family", async () => {
      useAdminClient({ family_members: members() });

      expect(await ai.budgetRecipients("10000000-0000-4000-8000-0000000000ff")).toEqual({
        familyId: null,
        userIds: ["10000000-0000-4000-8000-0000000000ff"],
      });
    });

    it("falls back to the user for a family without a parent", async () => {
      useAdminClient({ family_members: [{ user_id: kid, family_id: family, role: "kid" }] });

      expect(await ai.budgetRecipients(kid)).toEqual({ familyId: family, userIds: [kid] });
    });

    it("fails with a message of ours when a query fails", async () => {
      useAdminClient({ family_members: members() }, { fail: () => true });

      await expect(ai.budgetRecipients(kid)).rejects.toThrow("Unable to find who to tell about the AI budget.");
    });
  });

  describe("enqueueNotification", () => {
    const notification = {
      userId: parent,
      kind: "ai_budget" as const,
      dedupeKey: `ai_budget:family:${family}:2026-10:80:${parent}`,
      payload: { title: "AI budget at 80%", body: "Your family has used $2.40 of the $3.00 AI budget this month.", url: "/settings", tag: "ai-budget" },
    };

    it("inserts into the outbox with the admin client", async () => {
      const { tables } = useAdminClient();

      expect(await ai.enqueueNotification(notification)).toBe("queued");
      expect(tables.notifications).toMatchObject([
        { user_id: parent, kind: "ai_budget", dedupe_key: notification.dedupeKey, payload: notification.payload },
      ]);
    });

    it("reports a dedupe key that is already queued", async () => {
      useAdminClient({}, { fail: () => ({ code: "23505", message: "duplicate key value" }) });

      expect(await ai.enqueueNotification(notification)).toBe("duplicate");
    });

    it("fails with a message of ours on any other error", async () => {
      useAdminClient({}, { fail: () => ({ code: "23514", message: "private" }) });

      await expect(ai.enqueueNotification(notification)).rejects.toThrow("Unable to queue the AI budget notification.");
    });
  });
});
