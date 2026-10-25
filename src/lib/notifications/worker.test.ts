import { describe, expect, it } from "vitest";

import { tick, type LogFields, type WorkerLog } from "@/lib/notifications/worker";
import { FakeWorkerStore } from "@/test/fakes/worker-store";

/** A log that keeps its lines. */
function memoryLog() {
  const lines: { level: "info" | "error"; event: string; fields?: LogFields }[] = [];
  const log: WorkerLog = {
    info: (event, fields) => lines.push({ level: "info", event, fields }),
    error: (event, fields) => lines.push({ level: "error", event, fields }),
  };
  return { log, lines };
}

/** A clock that moves 25 ms each time it's read. */
function steppingClock(start = "2026-10-25T09:00:00.000Z") {
  let at = new Date(start).getTime();
  return { now: () => new Date((at += 25) - 25) };
}

describe("tick", () => {
  it("writes the heartbeat with its start time and version, then logs the due counts", async () => {
    const store = new FakeWorkerStore();
    store.due = { notifications: 3, reminders: 2 };
    const { log, lines } = memoryLog();

    const result = await tick({ store, clock: steppingClock(), log, version: "abc1234" });

    expect(store.heartbeats.get("worker")).toEqual({
      name: "worker",
      beatAt: new Date("2026-10-25T09:00:00.000Z"),
      version: "abc1234",
    });
    expect(store.countedAt).toEqual([new Date("2026-10-25T09:00:00.000Z")]);
    expect(result).toEqual({ due: { notifications: 3, reminders: 2 } });
    expect(lines).toEqual([{ level: "info", event: "tick", fields: { dueNotifications: 3, dueReminders: 2, ms: 25 } }]);
  });

  it("replaces the previous heartbeat on the next tick", async () => {
    const store = new FakeWorkerStore();
    const clock = steppingClock();
    const { log } = memoryLog();

    await tick({ store, clock, log, version: "v1" });
    await tick({ store, clock, log, version: "v1" });

    expect(store.heartbeats.size).toBe(1);
    expect(store.heartbeats.get("worker")?.beatAt).toEqual(new Date("2026-10-25T09:00:00.050Z"));
  });

  it("logs a failure as one error line and doesn't throw", async () => {
    const store = new FakeWorkerStore();
    store.failWith = new Error("Unable to write the heartbeat: connection refused");
    const { log, lines } = memoryLog();

    await expect(tick({ store, clock: steppingClock(), log, version: "v1" })).resolves.toBeNull();

    expect(lines).toEqual([
      {
        level: "error",
        event: "tick_failed",
        fields: { error: "Unable to write the heartbeat: connection refused", ms: 25 },
      },
    ]);
  });
});
