import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
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

  describe("setOptIn", () => {
    const SAVE_ERROR = "Unable to save your AI setting. Please try again.";

    it("updates only the caller's own profile row, as the caller", async () => {
      const { queries, tables } = useRequestClient({ profiles: [{ id: kid, ai_enabled: false }, { id: user, ai_enabled: false }] });

      await expect(ai.setOptIn(user, true)).resolves.toBeUndefined();
      expect(queries).toEqual([
        expect.objectContaining({ table: "profiles", operation: "update", values: { ai_enabled: true }, filters: [["eq", "id", user]] }),
      ]);
      expect(tables.profiles).toEqual([{ id: kid, ai_enabled: false }, { id: user, ai_enabled: true }]);
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    });

    it("keeps the switch guard's message in a 403", async () => {
      const message = "A parent needs to turn on AI features for you.";
      useRequestClient({ profiles: [{ id: user, ai_enabled: false }] }, { fail: () => ({ code: "42501", message, hint: "user" }) });

      await expect(ai.setOptIn(user, true)).rejects.toThrow(new DomainError(message, 403));
    });

    it("fails when no profile row was updated", async () => {
      useRequestClient({ profiles: [{ id: kid, ai_enabled: false }] });

      await expect(ai.setOptIn(user, false)).rejects.toThrow(new Error(SAVE_ERROR));
    });

    it("hides any other database error behind a generic message", async () => {
      useRequestClient({ profiles: [{ id: user, ai_enabled: false }] }, { fail: () => true });

      await expect(ai.setOptIn(user, true)).rejects.toThrow(new Error(SAVE_ERROR));
    });

    it("acts only for the signed-in user, before querying", async () => {
      const { queries } = useRequestClient({ profiles: [{ id: kid, ai_enabled: false }] });

      await expect(ai.setOptIn(kid, true)).rejects.toThrow("The AI gate can only act for the signed-in user.");
      expect(queries).toEqual([]);
    });
  });

  describe("reserve", () => {
    const request = {
      userId: user,
      feature: "statements",
      provider: "openai",
      model: "gpt-5.6-luna",
      estimatedMicros: 52_000,
      monthStart,
      familyLimitMicros: 3_000_000,
      globalLimitMicros: 10_000_000,
    };
    const answer = (row: Record<string, unknown>) => ({ rpc: () => ({ data: [row], error: null }) });

    it("asks ai_reserve_budget with the admin client, for the signed-in user", async () => {
      const { rpcs } = useAdminClient({}, answer({ status: "ok", reservation_id: "r1", family_spent_micros: 1_750_000, global_spent_micros: 4_550_000 }));

      expect(await ai.reserve(request)).toEqual({ status: "ok", reservationId: "r1", familySpentMicros: 1_750_000, globalSpentMicros: 4_550_000 });
      expect(rpcs).toEqual([{
        fn: "ai_reserve_budget",
        args: {
          p_user_id: user,
          p_feature: "statements",
          p_provider: "openai",
          p_model: "gpt-5.6-luna",
          p_estimated_micros: 52_000,
          p_month_start: "2026-09-30T21:00:00.000Z",
          p_family_limit_micros: 3_000_000,
          p_global_limit_micros: 10_000_000,
        },
      }]);
      expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it.each([
      [{ status: "flag_off", reservation_id: null, family_spent_micros: null, global_spent_micros: null }, { status: "flag_off" }],
      [{ status: "ai_off", reservation_id: null, family_spent_micros: null, global_spent_micros: null }, { status: "ai_off" }],
      [{ status: "not_permitted", reservation_id: null, family_spent_micros: null, global_spent_micros: null }, { status: "not_permitted" }],
      [{ status: "family_budget", reservation_id: null, family_spent_micros: 3_000_000, global_spent_micros: null }, { status: "family_budget", familySpentMicros: 3_000_000 }],
      [
        { status: "global_budget", reservation_id: null, family_spent_micros: 0, global_spent_micros: 10_000_000 },
        { status: "global_budget", familySpentMicros: 0, globalSpentMicros: 10_000_000 },
      ],
    ])("reads a refusal %j", async (row, reservation) => {
      useAdminClient({}, answer(row));

      expect(await ai.reserve(request)).toEqual(reservation);
    });

    it("reserves only for the signed-in user", async () => {
      const { rpcs } = useAdminClient({}, answer({ status: "ok", reservation_id: "r1", family_spent_micros: 0, global_spent_micros: 0 }));

      await expect(ai.reserve({ ...request, userId: kid })).rejects.toThrow("The AI gate can only act for the signed-in user.");
      expect(rpcs).toEqual([]);
    });

    it.each([
      ["an unknown status", answer({ status: "maybe", reservation_id: null, family_spent_micros: null, global_spent_micros: null })],
      ["an ok without a reservation", answer({ status: "ok", reservation_id: null, family_spent_micros: 0, global_spent_micros: 0 })],
      ["a refusal without its spend", answer({ status: "family_budget", reservation_id: null, family_spent_micros: null, global_spent_micros: null })],
      ["no row", { rpc: () => ({ data: [], error: null }) }],
      ["a failed call", { rpc: () => ({ data: null, error: { message: "private" } }) }],
    ])("fails with a message of ours for %s", async (_name, options) => {
      useAdminClient({}, options);

      await expect(ai.reserve(request)).rejects.toThrow("Unable to check this month's AI budget.");
    });
  });

  describe("settle", () => {
    const settlement = {
      reservationId: "r1",
      userId: kid,
      inputTokens: 6000,
      outputTokens: 5000,
      cachedInputTokens: 4000,
      costMicros: 7200,
      outcome: "ok" as const,
      monthStart,
    };

    it("asks ai_settle_usage with the admin client and returns the month's spend", async () => {
      const { rpcs } = useAdminClient({}, { rpc: () => ({ data: [{ family_spent_micros: 1_007_200, global_spent_micros: 4_007_200 }], error: null }) });

      expect(await ai.settle(settlement)).toEqual({ familySpentMicros: 1_007_200, globalSpentMicros: 4_007_200 });
      expect(rpcs).toEqual([{
        fn: "ai_settle_usage",
        args: {
          p_reservation_id: "r1",
          p_user_id: kid,
          p_input_tokens: 6000,
          p_output_tokens: 5000,
          p_cached_input_tokens: 4000,
          p_cost_micros: 7200,
          p_outcome: "ok",
          p_month_start: "2026-09-30T21:00:00.000Z",
        },
      }]);
      expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it("fails with a message of ours when the reservation can't be settled or the answer is odd", async () => {
      useAdminClient({}, { rpc: () => ({ data: null, error: { code: "P0002", message: "That AI reservation wasn't found or was already settled.", hint: "user" } }) });
      await expect(ai.settle(settlement)).rejects.toThrow(new Error("Unable to record the AI usage."));

      useAdminClient({}, { rpc: () => ({ data: [], error: null }) });
      await expect(ai.settle(settlement)).rejects.toThrow("Unable to record the AI usage.");
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
