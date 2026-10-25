import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin-client", () => mocks);

import { createSupabaseWorkerStore } from "@/lib/supabase/worker-store";

const now = new Date("2026-10-25T09:00:00.000Z");

function useDatabase(tables: Record<string, Record<string, unknown>[]> = {}, options: FakeSupabaseOptions = {}) {
  const database = fakeSupabase(
    { worker_heartbeats: [], notifications: [], reminders: [], notification_settings: [], push_subscriptions: [], ...tables },
    options,
  );
  mocks.createAdminClient.mockReturnValue(database.client);
  return database;
}

describe("Supabase worker store", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("uses the admin client", () => {
    useDatabase();

    createSupabaseWorkerStore();

    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
  });

  describe("writeHeartbeat", () => {
    it("upserts the worker's row by name", async () => {
      const { queries, tables } = useDatabase({
        worker_heartbeats: [{ name: "worker", beat_at: "2026-10-25T08:59:30.000Z", version: "old" }],
      });

      await createSupabaseWorkerStore().writeHeartbeat({ name: "worker", beatAt: now, version: "abc1234" });

      expect(queries).toEqual([
        expect.objectContaining({
          table: "worker_heartbeats",
          operation: "upsert",
          onConflict: "name",
          values: { name: "worker", beat_at: "2026-10-25T09:00:00.000Z", version: "abc1234" },
        }),
      ]);
      expect(tables.worker_heartbeats).toEqual([{ name: "worker", beat_at: "2026-10-25T09:00:00.000Z", version: "abc1234" }]);
    });

    it("throws with the database's message", async () => {
      useDatabase({}, { fail: () => ({ message: "connection refused" }) });

      await expect(createSupabaseWorkerStore().writeHeartbeat({ name: "worker", beatAt: now, version: "v1" }))
        .rejects.toThrow("Unable to write the heartbeat: connection refused");
    });
  });

  describe("countDue", () => {
    it("counts pending outbox rows and unmuted reminders whose time has passed, writing nothing", async () => {
      const { queries, rpcs } = useDatabase({
        notifications: [
          { id: "n1", status: "pending", send_at: "2026-10-25T08:00:00.000Z" },
          { id: "n2", status: "pending", send_at: "2026-10-25T09:00:00.000Z" },
          { id: "n3", status: "pending", send_at: "2026-10-25T09:00:01.000Z" },
          { id: "n4", status: "sent", send_at: "2026-10-25T08:00:00.000Z" },
        ],
        reminders: [
          { id: "r1", notifications_muted: false, next_notify_at: "2026-10-24T09:00:00.000Z" },
          { id: "r2", notifications_muted: true, next_notify_at: "2026-10-24T09:00:00.000Z" },
          { id: "r3", notifications_muted: false, next_notify_at: null },
          { id: "r4", notifications_muted: false, next_notify_at: "2026-10-26T09:00:00.000Z" },
        ],
      });

      expect(await createSupabaseWorkerStore().countDue(now)).toEqual({ notifications: 2, reminders: 1 });
      expect(queries.map(({ table, operation, filters }) => ({ table, operation, filters }))).toEqual([
        {
          table: "notifications",
          operation: "select",
          filters: [["eq", "status", "pending"], ["lte", "send_at", "2026-10-25T09:00:00.000Z"]],
        },
        {
          table: "reminders",
          operation: "select",
          filters: [["eq", "notifications_muted", false], ["lte", "next_notify_at", "2026-10-25T09:00:00.000Z"]],
        },
      ]);
      // Counting must not lease rows: no claim function is called.
      expect(rpcs).toEqual([]);
    });

    it("throws with the database's message", async () => {
      useDatabase({}, { fail: (query) => query.table === "reminders" && { message: "permission denied" } });

      await expect(createSupabaseWorkerStore().countDue(now)).rejects.toThrow("Unable to count due reminders: permission denied");
    });
  });

  describe("claimNotifications", () => {
    it("calls claim_notifications with the batch size and maps the rows", async () => {
      const { rpcs } = useDatabase({}, {
        rpc: () => ({
          data: [{ id: "n1", user_id: "u1", kind: "test", payload: { title: "T" }, attempts: 2, status: "pending" }],
          error: null,
        }),
      });

      expect(await createSupabaseWorkerStore().claimNotifications(50)).toEqual([
        { id: "n1", userId: "u1", kind: "test", payload: { title: "T" }, attempts: 2 },
      ]);
      expect(rpcs).toEqual([{ fn: "claim_notifications", args: { p_batch: 50 } }]);
    });

    it("throws with the database's message", async () => {
      useDatabase({}, { rpc: () => ({ data: null, error: { message: "permission denied" } }) });
      await expect(createSupabaseWorkerStore().claimNotifications(50)).rejects.toThrow("Unable to claim notifications: permission denied");
    });
  });

  describe("getRecipientSettings and listDevices", () => {
    const tables = {
      notification_settings: [
        { user_id: "u1", push_enabled: false, reminders_enabled: true, todos_enabled: false },
        { user_id: "u3", push_enabled: true, reminders_enabled: true, todos_enabled: true },
      ],
      push_subscriptions: [
        { id: "d1", user_id: "u1", endpoint: "https://push.example.test/1", p256dh: "k1", auth: "a1", user_agent: "", last_success_at: null },
        { id: "d2", user_id: "u2", endpoint: "https://push.example.test/2", p256dh: "k2", auth: "a2", user_agent: "", last_success_at: null },
        { id: "d3", user_id: "u3", endpoint: "https://push.example.test/3", p256dh: "k3", auth: "a3", user_agent: "", last_success_at: null },
      ],
    };

    it("reads only the given users' settings and devices", async () => {
      const { queries } = useDatabase(tables);
      const store = createSupabaseWorkerStore();

      expect(await store.getRecipientSettings(["u1", "u2"])).toEqual(
        new Map([["u1", { pushEnabled: false, remindersEnabled: true, todosEnabled: false }]]),
      );
      expect(await store.listDevices(["u1", "u2"])).toEqual([
        { id: "d1", userId: "u1", endpoint: "https://push.example.test/1", p256dh: "k1", auth: "a1" },
        { id: "d2", userId: "u2", endpoint: "https://push.example.test/2", p256dh: "k2", auth: "a2" },
      ]);
      expect(queries.map(({ table, filters }) => ({ table, filters }))).toEqual([
        { table: "notification_settings", filters: [["in", "user_id", ["u1", "u2"]]] },
        { table: "push_subscriptions", filters: [["in", "user_id", ["u1", "u2"]]] },
      ]);
    });

    it("asks nothing for no users", async () => {
      const { queries } = useDatabase(tables);
      const store = createSupabaseWorkerStore();

      expect(await store.getRecipientSettings([])).toEqual(new Map());
      expect(await store.listDevices([])).toEqual([]);
      expect(queries).toEqual([]);
    });
  });

  describe("devices", () => {
    it("deletes one subscription by id and records deliveries", async () => {
      const { tables } = useDatabase({
        push_subscriptions: [
          { id: "d1", user_id: "u1", last_success_at: null },
          { id: "d2", user_id: "u1", last_success_at: null },
          { id: "d3", user_id: "u1", last_success_at: null },
        ],
      });
      const store = createSupabaseWorkerStore();

      await store.deleteDevice("d1");
      await store.markDevicesDelivered(["d2"], now);

      expect(tables.push_subscriptions).toEqual([
        { id: "d2", user_id: "u1", last_success_at: "2026-10-25T09:00:00.000Z" },
        { id: "d3", user_id: "u1", last_success_at: null },
      ]);
    });
  });

  describe("finishNotification", () => {
    const row = () => ({ id: "n1", status: "pending", attempts: 0, last_error: null, locked_until: "2026-10-25T09:02:00.000Z", send_at: "2026-10-25T08:59:00.000Z", sent_at: null });

    it.each([
      [
        { status: "sent", attempts: 1, sentAt: now, lastError: null },
        { status: "sent", attempts: 1, last_error: null, locked_until: null, sent_at: "2026-10-25T09:00:00.000Z" },
      ],
      [
        { status: "pending", attempts: 1, sendAt: new Date("2026-10-25T09:01:00.000Z"), lastError: "Push service answered 503" },
        { status: "pending", attempts: 1, last_error: "Push service answered 503", locked_until: null, send_at: "2026-10-25T09:01:00.000Z" },
      ],
      [
        { status: "skipped", attempts: 0, lastError: "No devices" },
        { status: "skipped", attempts: 0, last_error: "No devices", locked_until: null },
      ],
    ] as const)("writes %j and releases the lease", async (outcome, values) => {
      const { queries, tables } = useDatabase({ notifications: [row(), { ...row(), id: "n2" }] });

      await createSupabaseWorkerStore().finishNotification("n1", outcome);

      expect(queries).toEqual([expect.objectContaining({ table: "notifications", operation: "update", values, filters: [["eq", "id", "n1"]] })]);
      expect(tables.notifications[1]).toEqual({ ...row(), id: "n2" });
    });
  });

  describe("deleteOldNotifications", () => {
    it("deletes sent and skipped rows created before the cut-off and counts them", async () => {
      const { tables } = useDatabase({
        notifications: [
          { id: "old-sent", status: "sent", created_at: "2026-09-01T00:00:00.000Z" },
          { id: "old-skipped", status: "skipped", created_at: "2026-09-01T00:00:00.000Z" },
          { id: "old-failed", status: "failed", created_at: "2026-09-01T00:00:00.000Z" },
          { id: "old-pending", status: "pending", created_at: "2026-09-01T00:00:00.000Z" },
          { id: "new-sent", status: "sent", created_at: "2026-10-20T00:00:00.000Z" },
        ],
      });

      expect(await createSupabaseWorkerStore().deleteOldNotifications(new Date("2026-09-25T09:00:00.000Z"))).toBe(2);
      expect(tables.notifications.map((row) => row.id)).toEqual(["old-failed", "old-pending", "new-sent"]);
    });
  });
});
