import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { supabaseNotificationSettingsRepository as settings } from "@/lib/supabase/repositories/notification-settings";

const userId = "10000000-0000-4000-8000-000000000181";
const endpoint = "https://push.example.test/abc";

/** `notification_settings` and `push_subscriptions` rows behind RLS (the caller's own only). */
function useDatabase(
  tables: { notification_settings?: Record<string, unknown>[]; push_subscriptions?: Record<string, unknown>[] },
  options: FakeSupabaseOptions = {},
) {
  const database = fakeSupabase({ notification_settings: [], push_subscriptions: [], ...tables }, options);
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

describe("Supabase notification settings repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("get", () => {
    it("returns the defaults without a row, and the device count", async () => {
      useDatabase({ push_subscriptions: [{ id: "s1", user_id: userId }, { id: "s2", user_id: userId }] });

      expect(await settings.get()).toEqual({ pushEnabled: true, remindersEnabled: true, todosEnabled: true, calendarEnabled: true, deviceCount: 2 });
    });

    it("returns the caller's switches", async () => {
      useDatabase({
        notification_settings: [{ user_id: userId, push_enabled: true, reminders_enabled: false, todos_enabled: true, calendar_enabled: false }],
      });

      expect(await settings.get()).toEqual({ pushEnabled: true, remindersEnabled: false, todosEnabled: true, calendarEnabled: false, deviceCount: 0 });
    });

    it("keeps database failures private", async () => {
      useDatabase({}, { fail: () => true });

      await expect(settings.get()).rejects.toThrow("Unable to load your notification settings.");
    });
  });

  describe("update", () => {
    it("upserts only the given switches on the caller's row", async () => {
      const { queries, tables } = useDatabase({});

      const updated = await settings.update(userId, { remindersEnabled: false });

      expect(queries[0]).toMatchObject({
        table: "notification_settings",
        operation: "upsert",
        onConflict: "user_id",
        values: { user_id: userId, reminders_enabled: false },
      });
      expect(tables.notification_settings).toHaveLength(1);
      // The fake has no column defaults; the database fills in the others.
      expect(updated).toMatchObject({ remindersEnabled: false, deviceCount: 0 });
    });

    it("writes calendarEnabled to calendar_enabled", async () => {
      const { queries } = useDatabase({});

      await settings.update(userId, { calendarEnabled: false });

      expect(queries[0]).toMatchObject({ operation: "upsert", values: { user_id: userId, calendar_enabled: false } });
    });

    it("writes nothing for an empty patch", async () => {
      const { queries } = useDatabase({});

      expect(await settings.update(userId, {})).toMatchObject({ pushEnabled: true });
      expect(queries.every((query) => query.operation === "select")).toBe(true);
    });

    it("passes a refusal on as a DomainError", async () => {
      useDatabase({}, { fail: (query) => query.operation === "upsert" && { code: "42501", message: "Not allowed." } });

      await expect(settings.update(userId, { pushEnabled: false })).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("push subscriptions", () => {
    it("registers through register_push_subscription", async () => {
      const { rpcs } = useDatabase({});

      await settings.registerPushSubscription({ endpoint, p256dh: "key", auth: "secret", userAgent: "Safari" });

      expect(rpcs).toEqual([{
        fn: "register_push_subscription",
        args: { p_endpoint: endpoint, p_p256dh: "key", p_auth: "secret", p_user_agent: "Safari" },
      }]);
    });

    it("passes a bad subscription on as a 422", async () => {
      useDatabase({}, { rpc: () => ({ data: null, error: { code: "23514", message: "new row violates check constraint" } }) });

      await expect(settings.registerPushSubscription({ endpoint: "http://bad", p256dh: "k", auth: "a", userAgent: "" }))
        .rejects.toMatchObject({ status: 422 });
    });

    it("deletes the caller's subscription by endpoint", async () => {
      const { queries, tables } = useDatabase({ push_subscriptions: [{ id: "s1", user_id: userId, endpoint }] });

      expect(await settings.deletePushSubscription(endpoint)).toBe(true);
      expect(await settings.deletePushSubscription(endpoint)).toBe(false);
      expect(queries[0]).toMatchObject({ operation: "delete", filters: [["eq", "endpoint", endpoint]] });
      expect(tables.push_subscriptions).toEqual([]);
    });
  });

  describe("sendTest", () => {
    it("returns what send_test_notification answers", async () => {
      let queued = false;
      const { rpcs } = useDatabase({}, {
        rpc: () => {
          const answer = !queued;
          queued = true;
          return { data: answer, error: null };
        },
      });

      expect(await settings.sendTest()).toBe(true);
      expect(await settings.sendTest()).toBe(false);
      expect(rpcs).toEqual([
        { fn: "send_test_notification", args: {} },
        { fn: "send_test_notification", args: {} },
      ]);
    });

    it("keeps unknown failures private", async () => {
      useDatabase({}, { rpc: () => ({ data: null, error: { message: "private" } }) });

      await expect(settings.sendTest()).rejects.toThrow("Unable to send a test notification.");
    });
  });
});
