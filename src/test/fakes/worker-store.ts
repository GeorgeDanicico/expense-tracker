import type { DueCounts, Heartbeat, WorkerStore } from "@/lib/notifications/worker-store";

/**
 * In-memory `WorkerStore`: `heartbeats` holds the latest beat by name, `due` is what `countDue`
 * answers, and `failWith` makes every call reject with that error.
 */
export class FakeWorkerStore implements WorkerStore {
  heartbeats = new Map<string, Heartbeat>();
  due: DueCounts = { notifications: 0, reminders: 0 };
  countedAt: Date[] = [];
  failWith: Error | null = null;

  async writeHeartbeat(heartbeat: Heartbeat) {
    if (this.failWith) throw this.failWith;
    this.heartbeats.set(heartbeat.name, heartbeat);
  }

  async countDue(now: Date) {
    if (this.failWith) throw this.failWith;
    this.countedAt.push(now);
    return this.due;
  }
}
