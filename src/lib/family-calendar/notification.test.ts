import { describe, expect, it } from "vitest";

import {
  eventAddedBody,
  eventAddedPayload,
  eventBody,
  eventDedupeKey,
  eventPayload,
  eventUrl,
} from "@/lib/family-calendar/notification";

const BUCHAREST = "Europe/Bucharest";
// 3 November 2026 at 18:00 in Bucharest (UTC+2 after the clock change of the 25th).
const startsAt = new Date("2026-11-03T16:00:00Z");
const timed = { allDay: false, startsAt, timezone: BUCHAREST };

describe("eventBody", () => {
  it.each([
    ["30 minutes before", "2026-11-03T15:30:00Z", "At 18:00, in 30 minutes"],
    ["a few seconds late", "2026-11-03T15:30:20Z", "At 18:00, in 30 minutes"],
    ["10 minutes late", "2026-11-03T15:40:00Z", "At 18:00, in 20 minutes"],
    ["29 minutes late", "2026-11-03T15:59:00Z", "At 18:00, in 1 minute"],
    ["at the start", "2026-11-03T16:00:10Z", "At 18:00, starting now"],
    ["after the start", "2026-11-03T16:05:00Z", "At 18:00, started 5 minutes ago"],
    ["a long lead", "2026-11-03T14:55:00Z", "At 18:00, in 1 hour 5 minutes"],
    ["an hour's lead", "2026-11-03T15:00:00Z", "At 18:00, in 1 hour"],
  ])("words a timed event %s", (_label, now, body) => {
    expect(eventBody(timed, new Date(now))).toBe(body);
  });

  it("reads the start on the event's wall clock, summer time included", () => {
    // 18:00 on 3 August in Bucharest is 15:00 UTC.
    expect(eventBody({ ...timed, startsAt: new Date("2026-08-03T15:00:00Z") }, new Date("2026-08-03T14:30:00Z")))
      .toBe("At 18:00, in 30 minutes");
  });

  it("says today, all day, for an all-day event", () => {
    // Local midnight of 4 November.
    expect(eventBody({ allDay: true, startsAt: new Date("2026-11-03T22:00:00Z"), timezone: BUCHAREST }, new Date("2026-11-04T05:30:00Z")))
      .toBe("Today, all day");
  });
});

describe("eventPayload", () => {
  it("is the title, the body, the calendar url for the event and its tag", () => {
    expect(eventPayload({ id: "e1", title: "Swimming", ...timed }, new Date("2026-11-03T15:30:00Z"))).toEqual({
      title: "Swimming",
      body: "At 18:00, in 30 minutes",
      url: "/calendar?event=e1",
      tag: "event:e1",
    });
  });
});

describe("eventUrl and eventDedupeKey", () => {
  it("opens the calendar on the event", () => {
    expect(eventUrl("e1")).toBe("/calendar?event=e1");
  });

  it("is per event, notify time and attendee", () => {
    const key = eventDedupeKey("e1", new Date("2026-11-03T15:30:00Z"), "u1");
    expect(key).toBe("event:e1:2026-11-03T15:30:00.000Z:u1");
    expect(eventDedupeKey("e1", new Date("2026-11-03T16:30:00Z"), "u1")).not.toBe(key);
    expect(eventDedupeKey("e1", new Date("2026-11-03T15:30:00Z"), "u2")).not.toBe(key);
  });
});

describe("eventAddedBody", () => {
  const now = new Date("2026-10-28T08:00:00Z");
  // Sunday 1 November 2026 at 10:00 local.
  const event = { title: "Visit my parents", startsAt: new Date("2026-11-01T08:00:00Z"), timezone: BUCHAREST };

  it("is the title and day for a one-off", () => {
    expect(eventAddedBody({ ...event, seriesRepeat: "none", seriesLength: 1 }, now)).toBe("Visit my parents, Sun 1 Nov");
  });

  it("adds how long a repeat goes on", () => {
    expect(eventAddedBody({ ...event, seriesRepeat: "weekly", seriesLength: 6 }, now))
      .toBe("Visit my parents, Sun 1 Nov, every week for 6 weeks");
    expect(eventAddedBody({ ...event, seriesRepeat: "daily", seriesLength: 10 }, now))
      .toBe("Visit my parents, Sun 1 Nov, every day for 10 days");
  });

  it("words a series of one, or an unknown repeat, as a one-off", () => {
    expect(eventAddedBody({ ...event, seriesRepeat: "weekly", seriesLength: 1 }, now)).toBe("Visit my parents, Sun 1 Nov");
    expect(eventAddedBody({ ...event, seriesRepeat: "monthly", seriesLength: 6 }, now)).toBe("Visit my parents, Sun 1 Nov");
  });

  it("gives the day on the event's own wall clock", () => {
    // 23:30 UTC on 1 November is already 2 November in Bucharest.
    expect(eventAddedBody({ ...event, startsAt: new Date("2026-11-01T23:30:00Z"), seriesRepeat: "none", seriesLength: 1 }, now))
      .toBe("Visit my parents, Mon 2 Nov");
  });
});

describe("eventAddedPayload", () => {
  const now = new Date("2026-10-28T08:00:00Z");
  const stored = {
    title: "Ana added you",
    body: "Visit my parents",
    url: "/calendar?event=e1",
    tag: "event_added:s1",
    eventId: "e1",
    eventTitle: "Visit my parents",
    startsAt: "2026-11-01T08:00:00Z",
    allDay: false,
    timezone: BUCHAREST,
    seriesRepeat: "weekly",
    seriesLength: 6,
    adderName: "Ana",
  };

  it("keeps the trigger's title, url and tag and words the body from the extra fields", () => {
    expect(eventAddedPayload(stored, now)).toEqual({
      title: "Ana added you",
      body: "Visit my parents, Sun 1 Nov, every week for 6 weeks",
      url: "/calendar?event=e1",
      tag: "event_added:s1",
    });
  });

  it.each([
    ["no event fields", { title: "Ana added you", body: "x", url: "/calendar", tag: "t" }],
    ["a bad start", { ...stored, startsAt: "soon" }],
    ["a bad time zone", { ...stored, timezone: "Mars/Olympus" }],
    ["no title", { ...stored, title: "" }],
    ["text", "text"],
    ["null", null],
  ])("is null for %s, so the stored body is sent", (_label, payload) => {
    expect(eventAddedPayload(payload, now)).toBeNull();
  });
});
