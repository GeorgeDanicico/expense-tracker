import { describe, expect, it } from "vitest";

import type { PushPayload, PushResult, PushSender, PushTarget } from "@/lib/notifications/push";
import {
  createWorkerState,
  tick,
  todoDueNotification,
  type LogFields,
  type TickDependencies,
  type WorkerLog,
} from "@/lib/notifications/worker";
import { FakeWorkerStore } from "@/test/fakes/worker-store";

// R10: to-do notifications, "assigned to you" (the trigger's rows) and "Due today", on a fake clock.

const ANA = "10000000-0000-4000-8000-000000000001";
const BOGDAN = "10000000-0000-4000-8000-000000000002";
// Tuesday 10 November 2026: Bucharest is UTC+2, so 09:00 there is 07:00 UTC.
const TODAY = "2026-11-10";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TICK = 30_000;
const ON = { pushEnabled: true, remindersEnabled: true, todosEnabled: true, calendarEnabled: true };

class FakePush implements PushSender {
  sends: { endpoint: string; payload: PushPayload }[] = [];

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    this.sends.push({ endpoint: target.endpoint, payload });
    return { outcome: "sent" };
  }
}

function memoryLog() {
  const lines: { level: "info" | "error"; event: string; fields?: LogFields }[] = [];
  const log: WorkerLog = {
    info: (event, fields) => lines.push({ level: "info", event, fields }),
    error: (event, fields) => lines.push({ level: "error", event, fields }),
  };
  return { log, lines };
}

/** A worker over the fake store starting at `start`, with one device each for Ana and Bogdan. */
function setup(start: string) {
  let at = new Date(start).getTime();
  const clock = { now: () => new Date(at) };
  const store = new FakeWorkerStore();
  store.now = clock.now;
  const bogdanDevice = store.addDevice(BOGDAN);
  store.addDevice(ANA);
  const push = new FakePush();
  const { log, lines } = memoryLog();
  let deps: TickDependencies = { store, push, clock, log, version: "v1", state: createWorkerState() };

  /** Ticks every `step` (30 s by default) until `until`, as the running worker would. */
  async function runUntil(until: string, step = TICK) {
    const end = new Date(until).getTime();
    while (at < end) {
      at = Math.min(at + step, end);
      await tick(deps);
    }
  }

  return {
    store,
    push,
    lines,
    runUntil,
    tick: () => tick(deps),
    /** A new process: the same store, fresh in-memory state. */
    restart: () => {
      deps = { ...deps, state: createWorkerState() };
    },
    /** What Bogdan's browser showed, in order. */
    bogdanSaw: () => push.sends.filter((send) => send.endpoint === bogdanDevice.endpoint).map((send) => send.payload),
    /** The `todo_due` outbox rows. */
    dueRows: () => store.notifications.filter((row) => row.kind === "todo_due"),
  };
}

describe("tick, for to-do assignments", () => {
  it("sends the trigger's row to the new assignee as it is, without its extra fields", async () => {
    const worker = setup("2026-11-10T10:00:00Z");
    const card = worker.store.addTodo({ title: "Book the car service" });
    // What `todos_notify_assignee` inserts when Ana assigns the card to Bogdan.
    const row = worker.store.assignTodo(card, BOGDAN, "Ana");

    await worker.tick();

    expect(worker.store.notifications.filter((notification) => notification.kind === "todo_assigned")).toHaveLength(1);
    expect(row.status).toBe("sent");
    expect(worker.bogdanSaw()).toEqual([
      { title: "Ana assigned you", body: "Book the car service", url: `/todos?card=${card.id}`, tag: `todo:${card.id}` },
    ]);
    // Only Bogdan's browser.
    expect(worker.push.sends).toHaveLength(1);

    await worker.runUntil("2026-11-10T11:00:00Z");
    expect(worker.push.sends).toHaveLength(1);
  });

  it("skips it when the assignee turned To-dos off", async () => {
    const worker = setup("2026-11-10T10:00:00Z");
    worker.store.settings.set(BOGDAN, { ...ON, todosEnabled: false });
    const row = worker.store.assignTodo(worker.store.addTodo(), BOGDAN, "Ana");

    await worker.tick();

    expect(row.status).toBe("skipped");
    expect(row.lastError).toBe("Skipped: to-do notifications are off.");
    expect(worker.push.sends).toEqual([]);
  });
});

describe("tick, for cards due today", () => {
  it("notifies the assignee once, on the first tick at 09:00 Bucharest", async () => {
    const worker = setup("2026-11-10T05:00:00Z");
    const card = worker.store.addTodo({ title: "Pay the nursery", dueDate: TODAY, assigneeUserId: BOGDAN });

    await worker.runUntil("2026-11-10T06:59:30Z");
    expect(worker.dueRows()).toEqual([]);
    expect(worker.store.todoReads).toEqual([]);

    await worker.runUntil("2026-11-10T07:00:00Z");
    expect(worker.bogdanSaw()).toEqual([
      { title: "Due today", body: "Pay the nursery", url: `/todos?card=${card.id}`, tag: `todo:${card.id}` },
    ]);
    expect(worker.dueRows()).toMatchObject([
      { userId: BOGDAN, kind: "todo_due", status: "sent", sentAt: new Date("2026-11-10T07:00:00Z"), dedupeKey: `todo_due:${card.id}:${TODAY}` },
    ]);
    expect(worker.lines).toContainEqual({
      level: "info",
      event: "todos_due",
      fields: { date: TODAY, found: 1, queued: 1, duplicates: 0, failed: 0 },
    });

    // Later ticks that day don't read the board again.
    await worker.runUntil("2026-11-10T21:59:30Z", 10 * MINUTE);
    expect(worker.store.todoReads).toEqual([TODAY]);
    expect(worker.bogdanSaw()).toHaveLength(1);
  });

  it("doesn't notify again after a restart the same day: the dedupe key does", async () => {
    const worker = setup("2026-11-10T06:59:30Z");
    worker.store.addTodo({ dueDate: TODAY, assigneeUserId: BOGDAN });
    await worker.runUntil("2026-11-10T07:00:30Z");
    expect(worker.bogdanSaw()).toHaveLength(1);

    worker.restart();
    const result = await worker.tick();

    expect(result).toMatchObject({ todosDue: { date: TODAY, found: 1, queued: 0, duplicates: 1, failed: 0 } });
    expect(worker.store.todoReads).toEqual([TODAY, TODAY]);
    expect(worker.dueRows()).toHaveLength(1);
    expect(worker.bogdanSaw()).toHaveLength(1);
  });

  it("leaves out done cards and unassigned ones, and includes cards in progress", async () => {
    const worker = setup("2026-11-10T06:59:30Z");
    worker.store.addTodo({ title: "Done already", dueDate: TODAY, assigneeUserId: BOGDAN, status: "done" });
    worker.store.addTodo({ title: "Nobody's", dueDate: TODAY, assigneeUserId: null });
    worker.store.addTodo({ title: "Tomorrow's", dueDate: "2026-11-11", assigneeUserId: BOGDAN });
    worker.store.addTodo({ title: "Undated", assigneeUserId: BOGDAN });
    worker.store.addTodo({ title: "Under way", dueDate: TODAY, assigneeUserId: BOGDAN, status: "in_progress" });
    worker.store.addTodo({ title: "Ana's", dueDate: TODAY, assigneeUserId: ANA });

    await worker.runUntil("2026-11-10T07:00:00Z");

    expect(worker.dueRows().map((row) => [row.userId, (row.payload as PushPayload).body])).toEqual([
      [BOGDAN, "Under way"],
      [ANA, "Ana's"],
    ]);
    expect(worker.bogdanSaw().map((payload) => payload.body)).toEqual(["Under way"]);
  });

  it("still sends the day's when the worker starts at 14:00", async () => {
    const worker = setup("2026-11-10T12:00:00Z");
    worker.store.addTodo({ title: "Pay the nursery", dueDate: TODAY, assigneeUserId: BOGDAN });

    await worker.tick();

    expect(worker.bogdanSaw().map((payload) => payload.body)).toEqual(["Pay the nursery"]);
  });

  it("never sends a past day's cards", async () => {
    // Down all of 9 November; it starts on the 10th, before 09:00.
    const worker = setup("2026-11-10T04:00:00Z");
    worker.store.addTodo({ title: "Yesterday's", dueDate: "2026-11-09", assigneeUserId: BOGDAN });
    worker.store.addTodo({ title: "Today's", dueDate: TODAY, assigneeUserId: BOGDAN });

    await worker.runUntil("2026-11-10T06:59:30Z");
    expect(worker.push.sends).toEqual([]);
    await worker.runUntil("2026-11-10T08:00:00Z");
    expect(worker.bogdanSaw().map((payload) => payload.body)).toEqual(["Today's"]);
    expect(worker.store.todoReads).toEqual([TODAY]);
  });

  it("runs again each day, from that day's 09:00", async () => {
    const worker = setup("2026-11-10T06:30:00Z");
    worker.store.addTodo({ title: "Tuesday's", dueDate: TODAY, assigneeUserId: BOGDAN });
    worker.store.addTodo({ title: "Wednesday's", dueDate: "2026-11-11", assigneeUserId: BOGDAN });

    // Midnight in Bucharest (22:00 UTC) is a new date, but nothing goes out before 09:00.
    await worker.runUntil("2026-11-11T06:59:00Z", HOUR / 2);
    expect(worker.bogdanSaw().map((payload) => payload.body)).toEqual(["Tuesday's"]);
    await worker.runUntil("2026-11-11T07:00:00Z", MINUTE);
    expect(worker.bogdanSaw().map((payload) => payload.body)).toEqual(["Tuesday's", "Wednesday's"]);
    expect(worker.store.todoReads).toEqual([TODAY, "2026-11-11"]);
  });

  it("uses the Bucharest clock across the summer-time offset", async () => {
    // 1 July: UTC+3, so 09:00 there is 06:00 UTC.
    const worker = setup("2026-07-01T05:59:30Z");
    worker.store.addTodo({ title: "Summer card", dueDate: "2026-07-01", assigneeUserId: BOGDAN });

    await worker.tick();
    expect(worker.push.sends).toEqual([]);
    await worker.runUntil("2026-07-01T06:00:00Z");
    expect(worker.bogdanSaw().map((payload) => payload.body)).toEqual(["Summer card"]);
  });

  it("skips them when the assignee turned To-dos off", async () => {
    const worker = setup("2026-11-10T07:00:00Z");
    worker.store.settings.set(BOGDAN, { ...ON, todosEnabled: false });
    worker.store.addTodo({ dueDate: TODAY, assigneeUserId: BOGDAN });

    await worker.tick();

    expect(worker.dueRows()).toMatchObject([{ status: "skipped", lastError: "Skipped: to-do notifications are off." }]);
    expect(worker.push.sends).toEqual([]);
  });

  it("tries the day again next tick when reading the board or queueing a row failed", async () => {
    const worker = setup("2026-11-10T07:00:00Z");
    worker.store.addTodo({ title: "First", dueDate: TODAY, assigneeUserId: BOGDAN });
    worker.store.addTodo({ title: "Second", dueDate: TODAY, assigneeUserId: BOGDAN });

    const list = worker.store.listOpenTodosDueOn.bind(worker.store);
    worker.store.listOpenTodosDueOn = async () => {
      throw new Error("connection reset");
    };
    await worker.tick();
    expect(worker.lines).toContainEqual({ level: "error", event: "todos_due_failed", fields: { date: TODAY, error: "connection reset" } });
    expect(worker.dueRows()).toEqual([]);

    worker.store.listOpenTodosDueOn = list;
    const enqueue = worker.store.enqueueNotification.bind(worker.store);
    let calls = 0;
    worker.store.enqueueNotification = async (notification) => {
      if (++calls === 2) throw new Error("timeout");
      return enqueue(notification);
    };
    await worker.runUntil("2026-11-10T07:00:30Z");
    expect(worker.dueRows().map((row) => (row.payload as PushPayload).body)).toEqual(["First"]);

    await worker.runUntil("2026-11-10T07:01:00Z");
    expect(worker.dueRows().map((row) => (row.payload as PushPayload).body)).toEqual(["First", "Second"]);
    expect(worker.bogdanSaw().map((payload) => payload.body)).toEqual(["First", "Second"]);

    // Done for the day now.
    await worker.runUntil("2026-11-10T08:00:00Z");
    expect(worker.store.todoReads).toEqual([TODAY, TODAY]);
  });
});

describe("todoDueNotification", () => {
  it("is the card's 'Due today' row, deduplicated per card and day", () => {
    expect(todoDueNotification({ id: "c1", title: "Pay the nursery", assigneeUserId: BOGDAN }, TODAY)).toEqual({
      userId: BOGDAN,
      kind: "todo_due",
      payload: { title: "Due today", body: "Pay the nursery", url: "/todos?card=c1", tag: "todo:c1" },
      dedupeKey: `todo_due:c1:${TODAY}`,
    });
  });
});
