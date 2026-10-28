import { describe, expect, it } from "vitest";

import { notifyAt } from "@/lib/family-calendar/notify";

const BUCHAREST = "Europe/Bucharest";

const iso = (value: Date | null) => value?.toISOString() ?? null;
const event = (startsAt: string, allDay = false) => ({ startsAt, allDay, timezone: BUCHAREST });

describe("notifyAt", () => {
  it("notifies a timed event 30 minutes before it starts", () => {
    // 18:00 local in winter (UTC+2).
    expect(iso(notifyAt(event("2026-11-03T16:00:00.000Z"), new Date("2026-11-01T00:00:00Z"))))
      .toBe("2026-11-03T15:30:00.000Z");
  });

  it("notifies an all-day event at 07:30 local on its first day", () => {
    // Local midnight of 3 November (UTC+2).
    expect(iso(notifyAt(event("2026-11-02T22:00:00.000Z", true), new Date("2026-11-01T00:00:00Z"))))
      .toBe("2026-11-03T05:30:00.000Z");
    // Local midnight of 15 July (UTC+3).
    expect(iso(notifyAt(event("2026-07-14T21:00:00.000Z", true), new Date("2026-07-01T00:00:00Z"))))
      .toBe("2026-07-15T04:30:00.000Z");
  });

  it("is null when the notify time has passed", () => {
    expect(notifyAt(event("2026-11-03T16:00:00.000Z"), new Date("2026-11-03T15:31:00Z"))).toBeNull();
    expect(notifyAt(event("2026-11-02T22:00:00.000Z", true), new Date("2026-11-03T05:31:00Z"))).toBeNull();
    expect(notifyAt(event("2026-11-03T16:00:00.000Z"), new Date("2026-11-04T00:00:00Z"))).toBeNull();
  });

  it("is null at exactly the notify time and set a moment before it", () => {
    expect(notifyAt(event("2026-11-03T16:00:00.000Z"), new Date("2026-11-03T15:30:00Z"))).toBeNull();
    expect(iso(notifyAt(event("2026-11-03T16:00:00.000Z"), new Date("2026-11-03T15:29:59Z"))))
      .toBe("2026-11-03T15:30:00.000Z");
  });

  it("is null for an event saved 10 minutes before it starts", () => {
    expect(notifyAt(event("2026-11-03T16:00:00.000Z"), new Date("2026-11-03T15:50:00Z"))).toBeNull();
  });

  describe("on a day the clocks change", () => {
    it("notifies an all-day event at 07:30 local on the spring change (29 March 2026, UTC+3 by then)", () => {
      // Local midnight is still UTC+2: 28 March 22:00 UTC.
      expect(iso(notifyAt(event("2026-03-28T22:00:00.000Z", true), new Date("2026-03-01T00:00:00Z"))))
        .toBe("2026-03-29T04:30:00.000Z");
    });

    it("notifies an all-day event at 07:30 local on the autumn change (25 October 2026, UTC+2 by then)", () => {
      // Local midnight is still UTC+3: 24 October 21:00 UTC.
      expect(iso(notifyAt(event("2026-10-24T21:00:00.000Z", true), new Date("2026-10-01T00:00:00Z"))))
        .toBe("2026-10-25T05:30:00.000Z");
    });

    it("subtracts 30 elapsed minutes from a timed event, not 30 wall-clock minutes", () => {
      // 04:00 local on the spring change is 01:00 UTC; the clock jumped over 03:00-04:00, so 30
      // minutes before is 02:30 local, not 03:30.
      expect(iso(notifyAt(event("2026-03-29T01:00:00.000Z"), new Date("2026-03-28T00:00:00Z"))))
        .toBe("2026-03-29T00:30:00.000Z");
    });
  });
});
