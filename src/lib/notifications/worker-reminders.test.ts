import { describe, expect, it } from "vitest";

import type { PushPayload, PushResult, PushSender, PushTarget } from "@/lib/notifications/push";
import { createWorkerState, tick, type LogFields, type TickDependencies, type WorkerLog } from "@/lib/notifications/worker";
import { FakeWorkerStore } from "@/test/fakes/worker-store";

// R8: the worker turns due reminders into outbox rows and sends them, on a fake clock.

const ANA = "10000000-0000-4000-8000-000000000001";
const START = "2026-10-25T09:00:00.000Z";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TICK = 30_000;

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

/** A worker over the fake store, with one device for Ana and a clock that stands still until moved. */
function setup() {
  let at = new Date(START).getTime();
  const clock = { now: () => new Date(at) };
  const store = new FakeWorkerStore();
  store.now = clock.now;
  store.addDevice(ANA);
  const push = new FakePush();
  const { log, lines } = memoryLog();
  const deps: TickDependencies = { store, push, clock, log, version: "v1", state: createWorkerState() };

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
    deps,
    runUntil,
    tick: () => tick(deps),
    advance: (ms: number) => {
      at += ms;
    },
    /** The bodies of the reminder notifications sent so far. */
    sent: () => push.sends.filter((send) => send.payload.tag.startsWith("reminder:")).map((send) => send.payload.body),
  };
}

describe("tick, for reminders", () => {
  it("notifies a monthly reminder at each lead time, then not until it's marked done", async () => {
    const worker = setup();
    // Thursday 5 November 2026 at 09:00 (07:00 UTC): 3 days before and at the time.
    const rent = worker.store.addReminder({ userId: ANA, startsOn: "2026-11-05", repeatUnit: "month", leadMinutes: [4320, 0] });
    expect(rent.nextNotifyAt).toEqual(new Date("2026-11-02T07:00:00Z"));

    await worker.runUntil("2026-11-02T06:59:30Z", HOUR / 2);
    expect(worker.sent()).toEqual([]);
    await worker.runUntil("2026-11-02T07:01:00Z");
    expect(worker.sent()).toEqual(["Due in 3 days, Thu 5 Nov"]);
    expect(rent.nextNotifyAt).toEqual(new Date("2026-11-05T07:00:00Z"));
    expect(rent.lockedUntil).toBeNull();

    await worker.runUntil("2026-11-05T06:59:30Z", HOUR / 2);
    await worker.runUntil("2026-11-05T07:01:00Z");
    expect(worker.sent()).toEqual(["Due in 3 days, Thu 5 Nov", "Due now"]);
    expect(rent.nextNotifyAt).toBeNull();
    const november = worker.store.reminderNotifications();
    expect(november.map((row) => row.dedupeKey)).toEqual([
      `reminder:${rent.id}:2026-11-02T07:00:00.000Z`,
      `reminder:${rent.id}:2026-11-05T07:00:00.000Z`,
    ]);
    expect(november.every((row) => row.status === "sent" && row.userId === ANA)).toBe(true);
    expect(november[0].payload).toEqual({
      title: "Pay rent",
      body: "Due in 3 days, Thu 5 Nov",
      url: `/reminders?focus=${rent.id}`,
      tag: `reminder:${rent.id}`,
    });

    // Overdue and not marked done: nothing more, however long it waits.
    await worker.runUntil("2026-11-20T09:00:00Z", HOUR);
    expect(worker.sent()).toHaveLength(2);

    worker.store.completeReminder(rent.id);
    expect(rent.nextDueOn).toBe("2026-12-05");
    await worker.runUntil("2026-12-10T09:00:00Z", HOUR);
    expect(worker.sent()).toEqual(["Due in 3 days, Thu 5 Nov", "Due now", "Due in 3 days, Sat 5 Dec", "Due now"]);

    // The daily clean-up has deleted November's sent rows by now.
    expect(worker.store.reminderNotifications().map((row) => row.dedupeKey)).toEqual([
      `reminder:${rent.id}:2026-12-02T07:00:00.000Z`,
      `reminder:${rent.id}:2026-12-05T07:00:00.000Z`,
    ]);
  });

  it("never notifies a muted reminder", async () => {
    const worker = setup();
    worker.store.addReminder({ userId: ANA, startsOn: "2026-10-26", leadMinutes: [1440, 0], notificationsMuted: true });
    const muted = worker.store.addReminder({ userId: ANA, startsOn: "2026-10-27", leadMinutes: [0] });
    worker.store.editReminder(muted.id, { notificationsMuted: true });

    await worker.runUntil("2026-10-30T09:00:00Z", 5 * MINUTE);

    expect(worker.store.notifications).toEqual([]);
    expect(worker.sent()).toEqual([]);
  });

  it("notifies a snoozed reminder once when the snooze ends", async () => {
    const worker = setup();
    // Today, 25 October, at 12:00 (10:00 UTC), notifying at the time.
    const call = worker.store.addReminder({ userId: ANA, title: "Call the bank", startsOn: "2026-10-25", timeOfDay: "12:00" });
    await worker.runUntil("2026-10-25T10:01:00Z");
    expect(worker.sent()).toEqual(["Due now"]);

    worker.store.snoozeReminder(call.id, new Date("2026-10-25T13:00:00Z"));
    await worker.runUntil("2026-10-25T12:59:30Z", 5 * MINUTE);
    expect(worker.sent()).toHaveLength(1);
    await worker.runUntil("2026-10-28T09:00:00Z");
    expect(worker.sent()).toEqual(["Due now", "Due now"]);
    expect(worker.store.reminderNotifications().map((row) => row.dedupeKey)).toEqual([
      `reminder:${call.id}:2026-10-25T10:00:00.000Z`,
      `reminder:${call.id}:2026-10-25T13:00:00.000Z`,
    ]);
  });

  it("drops the lead times a snooze covers and notifies when it ends instead", async () => {
    const worker = setup();
    // Wednesday 28 October at 09:00, notifying a day before and at the time; snoozed to the morning.
    const insurance = worker.store.addReminder({ userId: ANA, startsOn: "2026-10-28", leadMinutes: [1440, 0] });
    worker.store.snoozeReminder(insurance.id, new Date("2026-10-28T06:00:00Z"));

    await worker.runUntil("2026-10-29T09:00:00Z");

    expect(worker.sent()).toEqual(["Due today at 09:00", "Due now"]);
  });

  it("sends one notification, not a burst, after the worker was down for a week", async () => {
    const worker = setup();
    // Monday 2 November at 09:00, a week, three days and a day before.
    const reminder = worker.store.addReminder({ userId: ANA, startsOn: "2026-11-02", leadMinutes: [10080, 4320, 1440] });
    expect(reminder.nextNotifyAt).toEqual(new Date("2026-10-26T07:00:00Z"));

    // Down from now until Sunday 1 November 10:00 local, past all three.
    worker.advance(new Date("2026-11-01T08:00:00Z").getTime() - new Date(START).getTime());
    await worker.tick();

    expect(worker.sent()).toEqual(["Due tomorrow at 09:00"]);
    expect(worker.store.reminderNotifications().map((row) => row.dedupeKey)).toEqual([
      `reminder:${reminder.id}:2026-11-01T07:00:00.000Z`,
    ]);
    expect(reminder.nextNotifyAt).toBeNull();
    await worker.runUntil("2026-11-03T09:00:00Z", 10 * MINUTE);
    expect(worker.sent()).toHaveLength(1);
  });

  it("sends each notification once when two ticks run at the same time", async () => {
    const worker = setup();
    worker.store.addReminder({ userId: ANA, startsOn: "2026-10-25", timeOfDay: "12:00" });
    worker.advance(new Date("2026-10-25T10:00:10Z").getTime() - new Date(START).getTime());
    const other = { ...worker.deps, log: memoryLog().log, state: createWorkerState() };

    const [first, second] = await Promise.all([worker.tick(), tick(other)]);

    expect(worker.store.reminderNotifications()).toHaveLength(1);
    expect(worker.sent()).toEqual(["Due now"]);
    const claims = [first, second].map((result) => (result?.pushConfigured ? result.reminders.claimed : null));
    expect(claims.sort()).toEqual([0, 1]);
  });

  it("queues a notification once when a run crashes after queueing and is run again", async () => {
    const worker = setup();
    const reminder = worker.store.addReminder({ userId: ANA, startsOn: "2026-10-25", timeOfDay: "12:00" });
    worker.advance(new Date("2026-10-25T10:00:10Z").getTime() - new Date(START).getTime());
    worker.store.beforeAdvance = () => {
      throw new Error("connection reset");
    };

    await worker.tick();
    expect(worker.lines).toContainEqual({ level: "error", event: "reminder_failed", fields: { id: reminder.id, error: "connection reset" } });
    expect(reminder.nextNotifyAt).toEqual(new Date("2026-10-25T10:00:00Z"));
    expect(reminder.lockedUntil).not.toBeNull();

    worker.store.beforeAdvance = null;
    // Still leased: the next tick leaves it alone.
    worker.advance(TICK);
    const leased = await worker.tick();
    expect(leased?.pushConfigured && leased.reminders.claimed).toBe(0);

    worker.advance(2 * MINUTE);
    const rerun = await worker.tick();
    expect(rerun?.pushConfigured && rerun.reminders).toEqual({ claimed: 1, queued: 0, duplicates: 1, changed: 0 });
    expect(reminder.nextNotifyAt).toBeNull();
    expect(worker.store.reminderNotifications()).toHaveLength(1);
    expect(worker.sent()).toEqual(["Due now"]);
  });

  it("doesn't overwrite a reminder edited between the claim and the advance", async () => {
    const worker = setup();
    // Friday 30 October at 09:00, a day before and at the time.
    const reminder = worker.store.addReminder({ userId: ANA, startsOn: "2026-10-30", leadMinutes: [1440, 0] });
    worker.advance(new Date("2026-10-29T07:00:10Z").getTime() - new Date(START).getTime());
    worker.store.beforeAdvance = () => {
      worker.store.editReminder(reminder.id, { leadMinutes: [60, 0] });
      worker.store.beforeAdvance = null;
    };

    const result = await worker.tick();

    expect(result?.pushConfigured && result.reminders).toEqual({ claimed: 1, queued: 1, duplicates: 0, changed: 1 });
    // The edit's own next notify time (an hour before), not the one the worker worked out.
    expect(reminder.leadMinutes).toEqual([60, 0]);
    expect(reminder.nextNotifyAt).toEqual(new Date("2026-10-30T06:00:00Z"));
    expect(reminder.lockedUntil).toBeNull();
  });

  it("doesn't overwrite a reminder marked done or muted between the claim and the advance", async () => {
    const worker = setup();
    // Today at 13:00 (11:00 UTC), an hour before and at the time.
    const done = worker.store.addReminder({ userId: ANA, startsOn: "2026-10-25", timeOfDay: "13:00", repeatUnit: "week", leadMinutes: [60, 0] });
    const muted = worker.store.addReminder({ userId: ANA, title: "Water plants", startsOn: "2026-10-25", timeOfDay: "13:00", leadMinutes: [60, 0] });
    worker.advance(new Date("2026-10-25T10:00:10Z").getTime() - new Date(START).getTime());
    worker.store.beforeAdvance = (claimed) => {
      if (claimed.id === done.id) worker.store.completeReminder(done.id);
      else worker.store.editReminder(muted.id, { notificationsMuted: true });
    };

    const result = await worker.tick();

    expect(result?.pushConfigured && result.reminders).toEqual({ claimed: 2, queued: 2, duplicates: 0, changed: 2 });
    expect(done.nextDueOn).toBe("2026-11-01");
    expect(done.nextNotifyAt).toEqual(new Date("2026-11-01T10:00:00Z"));
    expect(muted.nextNotifyAt).toBeNull();
    expect([done.lockedUntil, muted.lockedUntil]).toEqual([null, null]);
  });

  it("leaves due reminders unclaimed while push isn't configured", async () => {
    const worker = setup();
    const reminder = worker.store.addReminder({ userId: ANA, startsOn: "2026-10-25", timeOfDay: "12:00" });
    worker.advance(3 * HOUR);

    await tick({ ...worker.deps, push: null });

    expect(worker.store.notifications).toEqual([]);
    expect(reminder.lockedUntil).toBeNull();
    expect(reminder.nextNotifyAt).toEqual(new Date("2026-10-25T10:00:00Z"));
  });
});
