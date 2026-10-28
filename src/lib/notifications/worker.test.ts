import { describe, expect, it } from "vitest";

import type { PushPayload, PushResult, PushSender, PushTarget } from "@/lib/notifications/push";
import {
  ALL_DEVICES_GONE,
  CLEANUP_INTERVAL_MS,
  NO_DEVICES,
  createWorkerState,
  kindAllowed,
  outcomeOf,
  pushPayload,
  tick,
  type LogFields,
  type TickDependencies,
  type WorkerLog,
} from "@/lib/notifications/worker";
import { FakeWorkerStore } from "@/test/fakes/worker-store";

const ANA = "10000000-0000-4000-8000-000000000001";
const BOGDAN = "20000000-0000-4000-8000-000000000002";
const START = "2026-10-25T09:00:00.000Z";
const MINUTE = 60_000;

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
function steppingClock(start = START) {
  let at = new Date(start).getTime();
  return { now: () => new Date((at += 25) - 25) };
}

/** A clock that stands still until moved. */
function manualClock(start = START) {
  let at = new Date(start).getTime();
  return {
    now: () => new Date(at),
    advance(ms: number) {
      at += ms;
    },
  };
}

/** A push sender that answers by endpoint (default: sent) and records every send. */
class FakePush implements PushSender {
  sends: { endpoint: string; payload: PushPayload }[] = [];
  answers = new Map<string, PushResult>();

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    this.sends.push({ endpoint: target.endpoint, payload });
    return this.answers.get(target.endpoint) ?? { outcome: "sent" };
  }
}

/** A worker over fakes with a manual clock that the store shares. */
function setup() {
  const clock = manualClock();
  const store = new FakeWorkerStore();
  store.now = clock.now;
  const push = new FakePush();
  const { log, lines } = memoryLog();
  const deps: TickDependencies = { store, push, clock, log, version: "v1", state: createWorkerState() };
  return { clock, store, push, log, lines, deps, run: () => tick(deps) };
}

const SERVER_ERROR: PushResult = { outcome: "retry", status: 503, error: "Push service answered 503" };

describe("tick", () => {
  it("writes the heartbeat with its start time and version, then logs what it delivered", async () => {
    const store = new FakeWorkerStore();
    const { log, lines } = memoryLog();

    const result = await tick({ store, push: new FakePush(), clock: steppingClock(), log, version: "abc1234", state: createWorkerState() });

    expect(store.heartbeats.get("worker")).toEqual({ name: "worker", beatAt: new Date(START), version: "abc1234" });
    expect(result).toEqual({
      pushConfigured: true,
      reminders: { claimed: 0, queued: 0, duplicates: 0, changed: 0 },
      events: { claimed: 0, queued: 0, duplicates: 0, changed: 0 },
      delivery: { claimed: 0, sent: 0, skipped: 0, failed: 0, retried: 0, devicesRemoved: 0 },
      cleaned: 0,
      // 11:00 in Bucharest: the first tick after 09:00 runs the day's "Due today" to-dos.
      todosDue: { date: "2026-10-25", found: 0, queued: 0, duplicates: 0, failed: 0 },
    });
    expect(lines.at(-1)).toEqual({
      level: "info",
      event: "tick",
      fields: {
        claimed: 0, sent: 0, skipped: 0, failed: 0, retried: 0, devicesRemoved: 0,
        remindersClaimed: 0, remindersQueued: 0, remindersDuplicate: 0, remindersChanged: 0,
        eventsClaimed: 0, eventsQueued: 0, eventsDuplicate: 0, eventsChanged: 0, ms: 75,
      },
    });
  });

  it("replaces the previous heartbeat on the next tick", async () => {
    const store = new FakeWorkerStore();
    const clock = steppingClock();
    const { log } = memoryLog();
    const deps = { store, push: new FakePush(), clock, log, version: "v1", state: createWorkerState() };

    await tick(deps);
    const firstEnd = clock.now();
    await tick(deps);

    expect(store.heartbeats.size).toBe(1);
    expect(store.heartbeats.get("worker")?.beatAt.getTime()).toBeGreaterThan(firstEnd.getTime());
  });

  it("logs a failure as one error line and doesn't throw", async () => {
    const store = new FakeWorkerStore();
    store.failWith = new Error("Unable to write the heartbeat: connection refused");
    const { log, lines } = memoryLog();

    await expect(tick({ store, push: new FakePush(), clock: steppingClock(), log, version: "v1", state: createWorkerState() }))
      .resolves.toBeNull();

    expect(lines).toEqual([
      { level: "error", event: "tick_failed", fields: { error: "Unable to write the heartbeat: connection refused", ms: 25 } },
    ]);
  });

  describe("without VAPID keys", () => {
    it("writes the heartbeat, logs a clear error with the waiting count and leaves every row pending", async () => {
      const { store, deps, lines } = setup();
      store.addDevice(ANA);
      const row = store.queue({ userId: ANA });
      store.due = { notifications: 1, reminders: 0 };

      const result = await tick({ ...deps, push: null });

      expect(result).toEqual({ pushConfigured: false, due: { notifications: 1, reminders: 0 } });
      expect(store.heartbeats.get("worker")).toBeDefined();
      expect(row).toMatchObject({ status: "pending", attempts: 0, lockedUntil: null });
      expect(store.cleanups).toEqual([]);
      expect(lines).toEqual([
        {
          level: "error",
          event: "push_not_configured",
          fields: {
            error: "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to send notifications; outbox rows stay pending.",
            dueNotifications: 1,
            dueReminders: 0,
          },
        },
      ]);
    });

    it("sends the waiting rows once the keys are there", async () => {
      const { store, push, deps, run } = setup();
      store.addDevice(ANA);
      const row = store.queue({ userId: ANA });

      await tick({ ...deps, push: null });
      await run();

      expect(push.sends).toHaveLength(1);
      expect(row.status).toBe("sent");
    });
  });

  describe("delivery", () => {
    it("sends a row to every device of its recipient only, with the payload's four fields", async () => {
      const { clock, store, push, run } = setup();
      const phone = store.addDevice(ANA, "https://push.example.test/phone");
      const laptop = store.addDevice(ANA, "https://push.example.test/laptop");
      store.addDevice(BOGDAN, "https://push.example.test/bogdan");
      const row = store.queue({
        userId: ANA,
        kind: "reminder",
        payload: { title: "Pay rent", body: "Due today at 09:00", url: "/reminders?focus=r1", tag: "reminder:r1", extra: "dropped" },
      });

      const result = await run();

      expect(push.sends).toEqual([
        { endpoint: phone.endpoint, payload: { title: "Pay rent", body: "Due today at 09:00", url: "/reminders?focus=r1", tag: "reminder:r1" } },
        { endpoint: laptop.endpoint, payload: { title: "Pay rent", body: "Due today at 09:00", url: "/reminders?focus=r1", tag: "reminder:r1" } },
      ]);
      expect(row).toMatchObject({ status: "sent", attempts: 1, sentAt: clock.now(), lastError: null, lockedUntil: null });
      expect(phone.lastSuccessAt).toEqual(clock.now());
      expect(laptop.lastSuccessAt).toEqual(clock.now());
      expect(store.devices.find((device) => device.userId === BOGDAN)?.lastSuccessAt).toBeNull();
      expect(result).toMatchObject({ delivery: { claimed: 1, sent: 1 } });
    });

    it("doesn't claim rows whose send_at hasn't come, or that another worker leased", async () => {
      const { clock, store, push, run } = setup();
      store.addDevice(ANA);
      store.queue({ userId: ANA, sendAt: new Date(clock.now().getTime() + MINUTE) });
      store.queue({ userId: ANA, lockedUntil: new Date(clock.now().getTime() + MINUTE) });

      expect(await run()).toMatchObject({ delivery: { claimed: 0 } });
      expect(push.sends).toEqual([]);
    });

    it.each([
      ["Browser notifications off", { pushEnabled: false, remindersEnabled: true, todosEnabled: true, calendarEnabled: true }, "test", "Skipped: Browser notifications are off."],
      ["Browser notifications off", { pushEnabled: false, remindersEnabled: true, todosEnabled: true, calendarEnabled: true }, "reminder", "Skipped: Browser notifications are off."],
      ["Reminders off", { pushEnabled: true, remindersEnabled: false, todosEnabled: true, calendarEnabled: true }, "reminder", "Skipped: reminder notifications are off."],
      ["To-dos off", { pushEnabled: true, remindersEnabled: true, todosEnabled: false, calendarEnabled: true }, "todo_assigned", "Skipped: to-do notifications are off."],
      ["To-dos off", { pushEnabled: true, remindersEnabled: true, todosEnabled: false, calendarEnabled: true }, "todo_due", "Skipped: to-do notifications are off."],
      ["Calendar off", { pushEnabled: true, remindersEnabled: true, todosEnabled: true, calendarEnabled: false }, "event", "Skipped: calendar notifications are off."],
      ["Calendar off", { pushEnabled: true, remindersEnabled: true, todosEnabled: true, calendarEnabled: false }, "event_added", "Skipped: calendar notifications are off."],
    ])("skips without sending when %s (%s)", async (_label, settings, kind, reason) => {
      const { store, push, run } = setup();
      store.settings.set(ANA, settings);
      store.addDevice(ANA);
      const row = store.queue({ userId: ANA, kind });

      expect(await run()).toMatchObject({ delivery: { claimed: 1, skipped: 1, sent: 0 } });
      expect(push.sends).toEqual([]);
      expect(row).toMatchObject({ status: "skipped", attempts: 0, lastError: reason, lockedUntil: null });
    });

    it("sends a test with the kind switches off, and other kinds whose switch is on", async () => {
      const { store, push, run } = setup();
      store.settings.set(ANA, { pushEnabled: true, remindersEnabled: false, todosEnabled: false, calendarEnabled: true });
      store.settings.set(BOGDAN, { pushEnabled: true, remindersEnabled: false, todosEnabled: true, calendarEnabled: true });
      store.addDevice(ANA);
      store.addDevice(BOGDAN);
      const test = store.queue({ userId: ANA, kind: "test" });
      const todo = store.queue({ userId: BOGDAN, kind: "todo_assigned" });

      await run();

      expect(push.sends).toHaveLength(2);
      expect([test.status, todo.status]).toEqual(["sent", "sent"]);
    });

    it("uses the defaults (everything on) for a user without a settings row", async () => {
      const { store, run } = setup();
      store.addDevice(ANA);
      const row = store.queue({ userId: ANA, kind: "reminder" });

      await run();

      expect(row.status).toBe("sent");
    });

    it("skips a user with no devices and says so in last_error", async () => {
      const { store, push, run } = setup();
      store.addDevice(BOGDAN);
      const row = store.queue({ userId: ANA });

      await run();

      expect(push.sends).toEqual([]);
      expect(row).toMatchObject({ status: "skipped", attempts: 0, lastError: NO_DEVICES, lockedUntil: null });
    });

    it("deletes a subscription the push service reports gone (410 or 404) and still delivers to the rest", async () => {
      const { store, push, run } = setup();
      const dead = store.addDevice(ANA, "https://push.example.test/dead");
      const old = store.addDevice(ANA, "https://push.example.test/old");
      const live = store.addDevice(ANA, "https://push.example.test/live");
      push.answers.set(dead.endpoint, { outcome: "gone", status: 410 });
      push.answers.set(old.endpoint, { outcome: "gone", status: 404 });
      const first = store.queue({ userId: ANA });
      const second = store.queue({ userId: ANA, kind: "reminder" });

      const result = await run();

      expect(store.devices.map((device) => device.id)).toEqual([live.id]);
      expect(first).toMatchObject({ status: "sent", lastError: null });
      expect(second.status).toBe("sent");
      // The second row of the tick doesn't try the deleted devices again.
      expect(push.sends.map((send) => send.endpoint)).toEqual([dead.endpoint, old.endpoint, live.endpoint, live.endpoint]);
      expect(result).toMatchObject({ delivery: { sent: 2, devicesRemoved: 2 } });
    });

    it("skips the row when every subscription turns out to be gone", async () => {
      const { store, push, run } = setup();
      const dead = store.addDevice(ANA);
      push.answers.set(dead.endpoint, { outcome: "gone", status: 410 });
      const row = store.queue({ userId: ANA });

      await run();

      expect(store.devices).toEqual([]);
      expect(row).toMatchObject({ status: "skipped", attempts: 1, lastError: ALL_DEVICES_GONE });
    });

    it("retries a throttled or failing push at 1, 5 and 30 minutes, then marks the row failed", async () => {
      const { clock, store, push, run } = setup();
      const device = store.addDevice(ANA);
      push.answers.set(device.endpoint, SERVER_ERROR);
      const row = store.queue({ userId: ANA });
      const start = clock.now().getTime();

      await run();
      expect(row).toMatchObject({ status: "pending", attempts: 1, sendAt: new Date(start + MINUTE), lastError: "Push service answered 503", lockedUntil: null });

      // Not before its time.
      clock.advance(MINUTE - 1);
      await run();
      expect(push.sends).toHaveLength(1);

      clock.advance(1);
      push.answers.set(device.endpoint, { outcome: "retry", status: 429, error: "Push service answered 429" });
      await run();
      expect(row).toMatchObject({ status: "pending", attempts: 2, sendAt: new Date(start + 6 * MINUTE), lastError: "Push service answered 429" });

      clock.advance(5 * MINUTE);
      push.answers.set(device.endpoint, { outcome: "retry", status: null, error: "socket hang up" });
      await run();
      expect(row).toMatchObject({ status: "pending", attempts: 3, sendAt: new Date(start + 36 * MINUTE) });

      clock.advance(30 * MINUTE);
      push.answers.set(device.endpoint, SERVER_ERROR);
      const result = await run();
      expect(row).toMatchObject({ status: "failed", attempts: 4, lastError: "Push service answered 503", lockedUntil: null });
      expect(push.sends).toHaveLength(4);
      expect(result).toMatchObject({ delivery: { failed: 1 } });

      clock.advance(60 * MINUTE);
      await run();
      expect(push.sends).toHaveLength(4);
    });

    it("sends on a retry that succeeds", async () => {
      const { clock, store, push, run } = setup();
      const device = store.addDevice(ANA);
      push.answers.set(device.endpoint, SERVER_ERROR);
      const row = store.queue({ userId: ANA });

      await run();
      push.answers.delete(device.endpoint);
      clock.advance(MINUTE);
      await run();

      expect(row).toMatchObject({ status: "sent", attempts: 2, lastError: null });
    });

    it("retries the whole row, to every device, when one device fails and another succeeds", async () => {
      const { store, push, run } = setup();
      const ok = store.addDevice(ANA);
      const flaky = store.addDevice(ANA);
      push.answers.set(flaky.endpoint, SERVER_ERROR);
      const row = store.queue({ userId: ANA });

      await run();

      expect(row).toMatchObject({ status: "pending", attempts: 1 });
      expect(store.devices.find((device) => device.id === ok.id)?.lastSuccessAt).not.toBeNull();
    });

    it("marks a row failed at once when every device refuses it for good", async () => {
      const { store, push, run } = setup();
      const device = store.addDevice(ANA);
      push.answers.set(device.endpoint, { outcome: "rejected", status: 403, error: "Push service answered 403" });
      const row = store.queue({ userId: ANA });

      await run();

      expect(row).toMatchObject({ status: "failed", attempts: 1, lastError: "Push service answered 403" });
      expect(store.devices).toHaveLength(1);
    });

    it("fails a row with an unknown kind or a payload without its fields, without sending", async () => {
      const { store, push, run } = setup();
      store.addDevice(ANA);
      const unknown = store.queue({ userId: ANA, kind: "email" });
      const broken = store.queue({ userId: ANA, payload: { title: "Hi" } });

      await run();

      expect(push.sends).toEqual([]);
      expect(unknown).toMatchObject({ status: "failed", lastError: 'Unknown notification kind "email".' });
      expect(broken).toMatchObject({ status: "failed", lastError: "Invalid payload: it needs a title, body, url and tag." });
    });

    it("logs a row it can't finish and goes on with the others", async () => {
      const { store, lines, run } = setup();
      store.addDevice(ANA);
      const first = store.queue({ userId: ANA });
      const second = store.queue({ userId: ANA });
      const finish = store.finishNotification.bind(store);
      store.finishNotification = async (id, outcome) => {
        if (id === first.id) throw new Error("Unable to update a notification: timeout");
        return finish(id, outcome);
      };

      await run();

      expect(lines).toContainEqual({ level: "error", event: "notification_failed", fields: { id: first.id, error: "Unable to update a notification: timeout" } });
      expect(first).toMatchObject({ status: "pending", lockedUntil: expect.any(Date) });
      expect(second.status).toBe("sent");
    });
  });

  describe("clean-up", () => {
    it("deletes sent and skipped rows older than 30 days on the first tick, then once a day", async () => {
      const { clock, store, run } = setup();
      const now = clock.now().getTime();
      const days = (count: number) => new Date(now - count * 24 * 60 * MINUTE);
      store.queue({ userId: ANA, status: "sent", createdAt: days(31) });
      store.queue({ userId: ANA, status: "skipped", createdAt: days(31) });
      const failed = store.queue({ userId: ANA, status: "failed", createdAt: days(31) });
      const recent = store.queue({ userId: ANA, status: "sent", createdAt: days(29) });

      const result = await run();

      expect(result).toMatchObject({ cleaned: 2 });
      expect(store.notifications).toEqual([failed, recent]);
      expect(store.cleanups).toEqual([days(30)]);

      clock.advance(CLEANUP_INTERVAL_MS - 1);
      expect(await run()).toMatchObject({ cleaned: null });
      clock.advance(1);
      await run();
      expect(store.cleanups).toHaveLength(2);
    });
  });
});

describe("outcomeOf", () => {
  const now = new Date(START);

  it("is sent when any device took it and none failed in a retryable way", () => {
    expect(outcomeOf({ attempts: 0 }, [{ outcome: "sent" }, { outcome: "gone", status: 410 }], now))
      .toEqual({ status: "sent", attempts: 1, sentAt: now, lastError: null });
    expect(outcomeOf({ attempts: 0 }, [{ outcome: "sent" }, { outcome: "rejected", status: 400, error: "Bad" }], now))
      .toEqual({ status: "sent", attempts: 1, sentAt: now, lastError: "Bad" });
  });

  it("is sent after the last retry when a device took it", () => {
    expect(outcomeOf({ attempts: 3 }, [{ outcome: "sent" }, SERVER_ERROR], now)).toMatchObject({ status: "sent", attempts: 4 });
  });
});

describe("kindAllowed", () => {
  const on = { pushEnabled: true, remindersEnabled: true, todosEnabled: true, calendarEnabled: true };

  it("answers null for a kind it doesn't know", () => {
    expect(kindAllowed("sms", on)).toBeNull();
  });

  it("maps both calendar kinds to the Calendar switch, behind Browser notifications", () => {
    for (const kind of ["event", "event_added"]) {
      expect(kindAllowed(kind, on)).toBe(true);
      expect(kindAllowed(kind, { ...on, calendarEnabled: false })).toBe(false);
      expect(kindAllowed(kind, { ...on, remindersEnabled: false, todosEnabled: false })).toBe(true);
      expect(kindAllowed(kind, { ...on, pushEnabled: false })).toBe(false);
    }
    expect(kindAllowed("reminder", { ...on, calendarEnabled: false })).toBe(true);
    expect(kindAllowed("todo_due", { ...on, calendarEnabled: false })).toBe(true);
  });
});

describe("pushPayload", () => {
  it.each([[null], ["text"], [{ title: "", body: "", url: "/", tag: "t" }], [{ title: "T", body: 1, url: "/", tag: "t" }]])(
    "refuses %j",
    (payload) => {
      expect(pushPayload(payload)).toBeNull();
    },
  );
});
