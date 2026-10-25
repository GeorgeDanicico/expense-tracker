import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin-client", () => mocks);

import { createSupabaseWorkerStore } from "@/lib/supabase/worker-store";

const now = new Date("2026-10-25T09:00:00.000Z");

function useDatabase(tables: Record<string, Record<string, unknown>[]> = {}, options: FakeSupabaseOptions = {}) {
  const database = fakeSupabase({ worker_heartbeats: [], notifications: [], reminders: [], ...tables }, options);
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
});
