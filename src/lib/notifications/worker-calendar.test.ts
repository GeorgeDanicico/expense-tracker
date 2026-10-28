import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEvent, updateEvent } from "@/lib/family-calendar/service";
import type { PushPayload, PushResult, PushSender, PushTarget } from "@/lib/notifications/push";
import { createWorkerState, tick, type LogFields, type TickDependencies, type WorkerLog } from "@/lib/notifications/worker";
import { calendarEventEditSchema, calendarEventSchema } from "@/lib/validation/calendar-event";
import { aFamily, aFamilyMember, aParent } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { FakeWorkerStore } from "@/test/fakes/worker-store";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

// C7: the worker turns due calendar events into outbox rows and sends them, and words "added you"
// rows, on a fake clock. The events are written by the calendar service over the fake repository,
// as the API does, so `notify_at` and `notified_at` are the ones the service works out.
// The attendee trigger itself (once per series, nothing for yourself) is SQL, tested in
// supabase/tests/notifications_rls.sql; here its rows are queued as the trigger writes them.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TICK = 30_000;

const parent = aParent();
const kid = aFamilyMember({ displayName: "Ana" });
const ME = "10000000-0000-4000-8000-000000000001";
const ANA = kid.userId;

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

let repositories: FakeRepositories;

/** 3 November 2026 at 09:00 to 10:00 in Bucharest (UTC+2): 07:00 to 08:00 UTC, notifying at 06:30 UTC. */
function newEvent(fields: Record<string, unknown> = {}) {
  return calendarEventSchema.parse({
    title: "Swimming",
    startDate: "2026-11-03",
    startTime: "09:00",
    endTime: "10:00",
    attendeeMemberIds: [parent.memberId, kid.memberId],
    ...fields,
  });
}

/** A worker over the fake store starting at `start`, with a device for each of the two members. */
function setup(start: string) {
  let at = new Date(start).getTime();
  const clock = { now: () => new Date(at) };
  const store = new FakeWorkerStore();
  store.now = clock.now;
  store.useCalendar(repositories.calendar, (memberId) => (memberId === parent.memberId ? ME : memberId === kid.memberId ? ANA : undefined));
  store.addDevice(ME, "https://push.example.test/me");
  store.addDevice(ANA, "https://push.example.test/ana");
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
    clock,
    runUntil,
    tick: () => tick(deps),
    /** Moves the clock without ticking, as a worker that was down. */
    jumpTo: (instant: string) => {
      at = new Date(instant).getTime();
    },
    /** Who got which body, for the `event` notifications sent so far. */
    sent: () =>
      push.sends
        .filter((send) => send.payload.tag.startsWith("event:"))
        .map((send) => `${send.endpoint.endsWith("/me") ? "me" : "ana"}: ${send.payload.body}`)
        .toSorted(),
  };
}

describe("tick, for calendar events", () => {
  beforeEach(() => {
    repositories = resetFakeRepositories();
    repositories.family.membership = parent;
    repositories.family.family = { ...aFamily(), members: [...aFamily().members, kid] };
  });

  it("notifies each attendee once, 30 minutes before a timed event", async () => {
    const worker = setup("2026-11-02T09:00:00Z");
    const [event] = await createEvent(newEvent({ location: "The pool" }), new Date("2026-11-02T09:00:00Z"));
    const row = repositories.calendar.rows[0];
    expect(row.notifyAt).toBe("2026-11-03T06:30:00.000Z");

    await worker.runUntil("2026-11-03T06:29:30Z");
    expect(worker.sent()).toEqual([]);
    expect(row.notifiedAt).toBeNull();

    await worker.runUntil("2026-11-03T06:31:00Z");
    expect(worker.sent()).toEqual(["ana: At 09:00, in 30 minutes", "me: At 09:00, in 30 minutes"]);
    expect(row.notifiedAt).toMatch(/^2026-11-03T06:30:/);

    const rows = worker.store.eventNotifications();
    expect(rows.map((notification) => notification.dedupeKey).toSorted()).toEqual([
      `event:${event.id}:2026-11-03T06:30:00.000Z:${ME}`,
      `event:${event.id}:2026-11-03T06:30:00.000Z:${ANA}`,
    ].toSorted());
    expect(rows.every((notification) => notification.status === "sent")).toBe(true);
    expect(rows[0].payload).toEqual({
      title: "Swimming",
      body: "At 09:00, in 30 minutes",
      url: `/calendar?event=${event.id}`,
      tag: `event:${event.id}`,
    });

    // However long the worker keeps ticking, through the event and past its end: nothing more.
    await worker.runUntil("2026-11-03T09:00:00Z", 10 * MINUTE);
    expect(worker.sent()).toHaveLength(2);
  });

  it("notifies at 07:30 local for an all-day event, today, all day", async () => {
    const worker = setup("2026-11-03T08:00:00Z");
    await createEvent(newEvent({ allDay: true, startTime: null, endTime: null, startDate: "2026-11-05" }), new Date("2026-11-03T08:00:00Z"));
    // 07:30 on 5 November in Bucharest is 05:30 UTC.
    expect(repositories.calendar.rows[0].notifyAt).toBe("2026-11-05T05:30:00.000Z");

    await worker.runUntil("2026-11-05T05:29:30Z");
    expect(worker.sent()).toEqual([]);
    await worker.runUntil("2026-11-05T05:31:00Z");
    expect(worker.sent()).toEqual(["ana: Today, all day", "me: Today, all day"]);
  });

  it("notifies again, at the new time, when the event is moved an hour later", async () => {
    const worker = setup("2026-11-02T09:00:00Z");
    const [event] = await createEvent(newEvent(), new Date("2026-11-02T09:00:00Z"));
    const row = repositories.calendar.rows[0];

    await worker.runUntil("2026-11-03T06:35:00Z");
    expect(worker.sent()).toHaveLength(2);
    expect(row.notifiedAt).not.toBeNull();

    await updateEvent(event.id, calendarEventEditSchema.parse({ startTime: "10:00", endTime: "11:00" }), new Date("2026-11-03T06:40:00Z"));
    expect(row).toMatchObject({ notifyAt: "2026-11-03T07:30:00.000Z", notifiedAt: null });

    await worker.runUntil("2026-11-03T07:29:30Z");
    expect(worker.sent()).toHaveLength(2);
    await worker.runUntil("2026-11-03T07:31:00Z");
    expect(worker.sent()).toEqual([
      "ana: At 09:00, in 30 minutes",
      "ana: At 10:00, in 30 minutes",
      "me: At 09:00, in 30 minutes",
      "me: At 10:00, in 30 minutes",
    ]);
    expect(worker.store.eventNotifications().map((notification) => notification.dedupeKey)).toContain(
      `event:${event.id}:2026-11-03T07:30:00.000Z:${ME}`,
    );
  });

  it("notifies once, at the new time, for an event moved before its first notify time", async () => {
    const worker = setup("2026-11-02T09:00:00Z");
    const [event] = await createEvent(newEvent(), new Date("2026-11-02T09:00:00Z"));
    await worker.runUntil("2026-11-03T06:00:00Z", HOUR);

    await updateEvent(event.id, calendarEventEditSchema.parse({ startTime: "10:00", endTime: "11:00" }), new Date("2026-11-03T06:00:00Z"));
    await worker.runUntil("2026-11-03T08:00:00Z");

    expect(worker.sent()).toEqual(["ana: At 10:00, in 30 minutes", "me: At 10:00, in 30 minutes"]);
  });

  it("doesn't lose the new time of an event moved between the claim and the mark", async () => {
    const worker = setup("2026-11-02T09:00:00Z");
    await createEvent(newEvent(), new Date("2026-11-02T09:00:00Z"));
    const row = repositories.calendar.rows[0];
    await worker.runUntil("2026-11-03T06:29:30Z");

    // An edit lands after the worker claimed the event and queued its rows, before it marked it:
    // what `updateEvent` stores for a move an hour later.
    worker.store.beforeMarkEvent = () => {
      worker.store.beforeMarkEvent = null;
      row.notifyAt = "2026-11-03T07:30:00.000Z";
      row.notifiedAt = null;
    };
    worker.jumpTo("2026-11-03T06:30:30Z");
    expect(await worker.tick()).toMatchObject({ events: { claimed: 1, queued: 2, changed: 1 } });
    expect(row).toMatchObject({ notifyAt: "2026-11-03T07:30:00.000Z", notifiedAt: null });

    // The old notify time went out; the new one is still to come.
    expect(worker.sent()).toEqual(["ana: At 09:00, in 30 minutes", "me: At 09:00, in 30 minutes"]);
    await worker.runUntil("2026-11-03T07:31:00Z");
    expect(worker.sent()).toHaveLength(4);
    expect(row.notifiedAt).not.toBeNull();
  });

  it("doesn't notify for an event created 10 minutes before it starts", async () => {
    const worker = setup("2026-11-03T06:50:00Z");
    await createEvent(newEvent(), new Date("2026-11-03T06:50:00Z"));
    expect(repositories.calendar.rows[0].notifyAt).toBeNull();

    await worker.runUntil("2026-11-03T09:00:00Z", 5 * MINUTE);

    expect(worker.sent()).toEqual([]);
    expect(worker.push.sends).toEqual([]);
  });

  it("sends nothing for an event that ended while the worker was down, and marks it notified", async () => {
    const worker = setup("2026-11-02T09:00:00Z");
    await createEvent(newEvent(), new Date("2026-11-02T09:00:00Z"));
    const row = repositories.calendar.rows[0];

    // The event ran 07:00 to 08:00 UTC; the worker comes back at 08:30.
    worker.jumpTo("2026-11-03T08:30:00Z");
    const result = await worker.tick();

    expect(result).toMatchObject({ events: { claimed: 0, queued: 0 } });
    expect(worker.push.sends).toEqual([]);
    expect(worker.store.eventNotifications()).toEqual([]);
    expect(row.notifiedAt).toBe("2026-11-03T08:30:00.000Z");
  });

  it("words a late notification by how far off the start really is", async () => {
    const worker = setup("2026-11-02T09:00:00Z");
    await createEvent(newEvent(), new Date("2026-11-02T09:00:00Z"));

    // Down since the evening before: back 20 minutes after the notify time.
    worker.jumpTo("2026-11-03T06:50:00Z");
    await worker.tick();
    expect(worker.sent()).toEqual(["ana: At 09:00, in 10 minutes", "me: At 09:00, in 10 minutes"]);
  });

  it("notifies only the attendees who have Calendar on", async () => {
    const worker = setup("2026-11-02T09:00:00Z");
    worker.store.settings.set(ANA, { pushEnabled: true, remindersEnabled: true, todosEnabled: true, calendarEnabled: false });
    await createEvent(newEvent(), new Date("2026-11-02T09:00:00Z"));

    await worker.runUntil("2026-11-03T06:31:00Z");

    expect(worker.sent()).toEqual(["me: At 09:00, in 30 minutes"]);
    expect(worker.store.eventNotifications().find((row) => row.userId === ANA)).toMatchObject({
      status: "skipped",
      lastError: "Skipped: calendar notifications are off.",
    });
  });

  it("notifies only the attendees of the event, not the rest of the family", async () => {
    const worker = setup("2026-11-02T09:00:00Z");
    await createEvent(newEvent({ attendeeMemberIds: [kid.memberId] }), new Date("2026-11-02T09:00:00Z"));

    await worker.runUntil("2026-11-03T06:31:00Z");

    expect(worker.sent()).toEqual(["ana: At 09:00, in 30 minutes"]);
  });

  it("notifies each occurrence of a series at its own time, 09:00 local across the clock change", async () => {
    const worker = setup("2026-10-20T09:00:00Z");
    // Weekly from Thursday 22 October (UTC+3, 06:00 UTC), crossing the change on Sunday 25 October.
    await createEvent(newEvent({ startDate: "2026-10-22", repeat: { kind: "weekly", count: 2 } }), new Date("2026-10-20T09:00:00Z"));
    expect(repositories.calendar.rows.map((row) => row.notifyAt)).toEqual(["2026-10-22T05:30:00.000Z", "2026-10-29T06:30:00.000Z"]);

    await worker.runUntil("2026-10-29T08:00:00Z", 5 * MINUTE);

    expect(worker.sent()).toEqual([
      "ana: At 09:00, in 30 minutes",
      "ana: At 09:00, in 30 minutes",
      "me: At 09:00, in 30 minutes",
      "me: At 09:00, in 30 minutes",
    ]);
    expect(worker.store.eventNotifications()).toHaveLength(4);
  });

  it("marks an event with no attendees notified and queues nothing", async () => {
    const worker = setup("2026-11-02T09:00:00Z");
    await createEvent(newEvent(), new Date("2026-11-02T09:00:00Z"));
    repositories.calendar.rows[0].memberIds = [];

    await worker.runUntil("2026-11-03T06:31:00Z");

    expect(worker.store.eventNotifications()).toEqual([]);
    expect(repositories.calendar.rows[0].notifiedAt).not.toBeNull();
  });

  it("queues a row an earlier run already queued only once, and still marks the event", async () => {
    const worker = setup("2026-11-02T09:00:00Z");
    const [event] = await createEvent(newEvent(), new Date("2026-11-02T09:00:00Z"));
    // A crash after queueing Ana's row left the event unmarked; its lease then ran out.
    worker.store.queue({
      userId: ANA,
      kind: "event",
      payload: { title: "Swimming", body: "At 09:00, in 30 minutes", url: `/calendar?event=${event.id}`, tag: `event:${event.id}` },
      dedupeKey: `event:${event.id}:2026-11-03T06:30:00.000Z:${ANA}`,
    });

    worker.jumpTo("2026-11-03T06:30:30Z");
    const result = await worker.tick();

    expect(result).toMatchObject({ events: { claimed: 1, queued: 1, duplicates: 1, changed: 0 } });
    expect(worker.store.eventNotifications()).toHaveLength(2);
    expect(repositories.calendar.rows[0].notifiedAt).not.toBeNull();
    expect(worker.sent()).toHaveLength(2);
  });

  it("leaves a claimed event leased for 2 minutes and unmarked when queueing fails, then retries it", async () => {
    const worker = setup("2026-11-02T09:00:00Z");
    await createEvent(newEvent(), new Date("2026-11-02T09:00:00Z"));
    const real = worker.store.enqueueNotification.bind(worker.store);
    let fail = true;
    worker.store.enqueueNotification = async (notification) => {
      if (fail) throw new Error("Unable to queue a notification: connection refused");
      return real(notification);
    };

    worker.jumpTo("2026-11-03T06:30:30Z");
    await worker.tick();
    expect(worker.lines.filter((line) => line.event === "event_failed")).toHaveLength(1);
    expect(repositories.calendar.rows[0].notifiedAt).toBeNull();

    // Within the lease nothing claims it again; after it, it goes out.
    fail = false;
    worker.jumpTo("2026-11-03T06:31:00Z");
    expect(await worker.tick()).toMatchObject({ events: { claimed: 0 } });
    worker.jumpTo("2026-11-03T06:32:40Z");
    expect(await worker.tick()).toMatchObject({ events: { claimed: 1, queued: 2 } });
    expect(repositories.calendar.rows[0].notifiedAt).not.toBeNull();
  });

  it("still queues reminders and delivers the outbox when the event claim fails", async () => {
    const worker = setup("2026-11-03T06:00:00Z");
    worker.store.failEventClaimWith = new Error(
      "Unable to claim due calendar events: Could not find the function public.claim_due_calendar_events(p_batch) in the schema cache",
    );
    const waiting = worker.store.queue({ userId: ME, kind: "todo_assigned", payload: { title: "Ana assigned you", body: "Buy milk", url: "/todos?card=t1", tag: "todo:t1" } });
    // A one-off reminder due at 09:00 Bucharest time on 3 November (07:00 UTC), due by the time of the tick.
    const reminder = worker.store.addReminder({ userId: ME, startsOn: "2026-11-03", timeOfDay: "09:00" });
    worker.jumpTo("2026-11-03T07:00:30Z");

    const result = await worker.tick();

    expect(result).toMatchObject({
      pushConfigured: true,
      events: { claimed: 0, queued: 0, duplicates: 0, changed: 0 },
      reminders: { claimed: 1, queued: 1 },
      delivery: { claimed: 2, sent: 2 },
    });
    expect(waiting.status).toBe("sent");
    expect(worker.store.reminderNotifications()).toHaveLength(1);
    expect(reminder.nextNotifyAt).toBeNull();
    expect(worker.lines.filter((line) => line.event === "event_claim_failed")).toEqual([
      expect.objectContaining({ level: "error", fields: { error: expect.stringContaining("claim_due_calendar_events") } }),
    ]);
    expect(worker.lines.some((line) => line.event === "tick_failed")).toBe(false);
    expect(worker.lines.at(-1)).toMatchObject({ event: "tick", fields: { eventsClaimed: 0, sent: 2 } });
  });

  it("picks the events up again once the claim works", async () => {
    const worker = setup("2026-11-02T09:00:00Z");
    await createEvent(newEvent(), new Date("2026-11-02T09:00:00Z"));
    worker.store.failEventClaimWith = new Error("claim_due_calendar_events doesn't exist");

    worker.jumpTo("2026-11-03T06:30:30Z");
    await worker.tick();
    expect(worker.sent()).toEqual([]);

    worker.store.failEventClaimWith = null;
    worker.jumpTo("2026-11-03T06:31:00Z");
    await worker.tick();
    expect(worker.sent()).toHaveLength(2);
  });

  it("doesn't claim events without a push sender", async () => {
    const worker = setup("2026-11-02T09:00:00Z");
    await createEvent(newEvent(), new Date("2026-11-02T09:00:00Z"));
    worker.jumpTo("2026-11-03T06:31:00Z");

    await tick({ store: worker.store, push: null, clock: worker.clock, log: memoryLog().log, version: "v1", state: createWorkerState() });

    expect(repositories.calendar.rows[0].notifiedAt).toBeNull();
    expect(worker.store.eventNotifications()).toEqual([]);
  });
});

describe("tick, for event_added rows", () => {
  beforeEach(() => {
    repositories = resetFakeRepositories();
    repositories.family.membership = parent;
    repositories.family.family = { ...aFamily(), members: [...aFamily().members, kid] };
  });

  it("sends the trigger's title with the event and its first day as the body", async () => {
    const worker = setup("2026-10-28T08:00:00Z");
    // Sunday 1 November 2026 at 10:00 local.
    const [event] = await createEvent(newEvent({ title: "Visit my parents", startDate: "2026-11-01", startTime: "10:00", endTime: "12:00" }));
    const added = worker.store.eventAdded(repositories.calendar.rows[0], ANA, "Ana")!;

    const result = await worker.tick();

    expect(result).toMatchObject({ delivery: { claimed: 1, sent: 1 } });
    expect(added.status).toBe("sent");
    expect(worker.push.sends).toEqual([{
      endpoint: "https://push.example.test/ana",
      payload: {
        title: "Ana added you",
        body: "Visit my parents, Sun 1 Nov",
        url: `/calendar?event=${event.id}`,
        tag: `event_added:${event.seriesId}`,
      },
    }]);
  });

  it("says how long a repeat goes on", async () => {
    const worker = setup("2026-10-28T08:00:00Z");
    await createEvent(newEvent({ title: "Swimming", startDate: "2026-11-03", repeat: { kind: "weekly", count: 6 } }));
    worker.store.eventAdded(repositories.calendar.rows[0], ANA, "Ana", 6);

    await worker.tick();

    expect(worker.push.sends.map((send) => send.payload.body)).toEqual(["Swimming, Tue 3 Nov, every week for 6 weeks"]);
  });

  it("sends a 10-day series as one notification, however many of its events add the attendee", async () => {
    const worker = setup("2026-10-28T08:00:00Z");
    await createEvent(newEvent({ title: "Course", startDate: "2026-11-03", repeat: { kind: "daily", count: 10 } }));
    // The trigger fires for each of the 10 rows; its dedupe key keeps one.
    const queued = repositories.calendar.rows.map((row) => worker.store.eventAdded(row, ANA, "Ana", 10));
    expect(queued.filter((row) => row !== null)).toHaveLength(1);

    await worker.tick();

    expect(worker.push.sends.map((send) => send.payload.body)).toEqual(["Course, Tue 3 Nov, every day for 10 days"]);
  });

  it("sends the stored body when the payload lacks the event fields", async () => {
    const worker = setup("2026-10-28T08:00:00Z");
    worker.store.queue({
      userId: ANA,
      kind: "event_added",
      payload: { title: "Ana added you", body: "Visit my parents", url: "/calendar?event=e1", tag: "event_added:s1" },
    });

    await worker.tick();

    expect(worker.push.sends.map((send) => send.payload)).toEqual([
      { title: "Ana added you", body: "Visit my parents", url: "/calendar?event=e1", tag: "event_added:s1" },
    ]);
  });

  it("skips it when Calendar is off", async () => {
    const worker = setup("2026-10-28T08:00:00Z");
    worker.store.settings.set(ANA, { pushEnabled: true, remindersEnabled: true, todosEnabled: true, calendarEnabled: false });
    await createEvent(newEvent());
    const added = worker.store.eventAdded(repositories.calendar.rows[0], ANA, "Ana")!;

    await worker.tick();

    expect(worker.push.sends).toEqual([]);
    expect(added).toMatchObject({ status: "skipped", lastError: "Skipped: calendar notifications are off." });
  });
});
