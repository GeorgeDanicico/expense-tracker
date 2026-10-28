import { describe, expect, it } from "vitest";

import {
  inScope,
  isPendingEvent,
  PENDING_ID_PREFIX,
  withEditedEvent,
  withoutEvents,
  withPendingEvents,
} from "@/lib/family-calendar/optimistic";
import { utcToZoned } from "@/lib/time-zone";
import { calendarEventEditSchema, type CalendarEventInput } from "@/lib/validation/calendar-event";
import { ANA, calendarEvents, DAN } from "@/test/calendar-events";

const local = (iso: string) => {
  const { date, time } = utcToZoned(new Date(iso), "Europe/Bucharest");
  return `${date} ${time}`;
};

/** A weekly series of six from Tuesday 3 November 2026 at 18:00. */
const swimming = () => calendarEvents({ id: "sw", start: "2026-11-03 18:00", end: "2026-11-03 19:00", repeat: { kind: "weekly", count: 6 } });

const edit = (changes: Record<string, unknown>) => calendarEventEditSchema.parse(changes);

describe("withPendingEvents", () => {
  const input: CalendarEventInput = {
    title: "Tennis", notes: "", location: "", allDay: false,
    startDate: "2026-11-04", startTime: "09:00", endDate: "2026-11-04", endTime: "10:00",
    attendeeMemberIds: ["m-ana"], repeat: { kind: "weekly", count: 6 },
  };

  it("adds every occurrence of a 6-week series, on the right days, as unconfirmed events", () => {
    const events = withPendingEvents([], input, [ANA], null, new Date("2026-10-28T12:00:00Z"));
    expect(events.map((event) => local(event.startsAt))).toEqual([
      "2026-11-04 09:00", "2026-11-11 09:00", "2026-11-18 09:00", "2026-11-25 09:00", "2026-12-02 09:00", "2026-12-09 09:00",
    ]);
    expect(events.every(isPendingEvent)).toBe(true);
    expect(events.every((event) => event.id.startsWith(PENDING_ID_PREFIX))).toBe(true);
    expect(events.map((event) => [event.seriesIndex, event.seriesLength])).toEqual([[1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6]]);
    expect(new Set(events.map((event) => event.seriesId)).size).toBe(1);
    expect(events[0].attendees).toEqual([ANA]);
  });

  it("keeps the events already there, in order of start", () => {
    const existing = calendarEvents({ id: "x", start: "2026-11-10 08:00" });
    const events = withPendingEvents(existing, { ...input, repeat: { kind: "none", count: 1 } }, [ANA], null);
    expect(events.map((event) => event.id.startsWith("x") ? "existing" : "new")).toEqual(["new", "existing"]);
  });

  it("makes one event of a one-off, and a daily repeat a day apart", () => {
    expect(withPendingEvents([], { ...input, repeat: { kind: "none", count: 1 } }, [ANA], null)).toHaveLength(1);
    const daily = withPendingEvents([], { ...input, repeat: { kind: "daily", count: 3 } }, [ANA], null);
    expect(daily.map((event) => local(event.startsAt))).toEqual(["2026-11-04 09:00", "2026-11-05 09:00", "2026-11-06 09:00"]);
  });
});

describe("inScope", () => {
  const series = swimming();

  it("reaches the one event, it and the later ones, or all", () => {
    const fourth = series[3];
    expect(series.filter((event) => inScope(event, fourth, "this")).map((event) => event.seriesIndex)).toEqual([4]);
    expect(series.filter((event) => inScope(event, fourth, "following")).map((event) => event.seriesIndex)).toEqual([4, 5, 6]);
    expect(series.filter((event) => inScope(event, fourth, "all")).map((event) => event.seriesIndex)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("never reaches another series", () => {
    const other = calendarEvents({ id: "other", start: "2026-11-03 18:00" })[0];
    expect(inScope(other, series[0], "all")).toBe(false);
  });
});

describe("withEditedEvent", () => {
  it("moves one occurrence to another day and leaves the rest", () => {
    const series = swimming();
    const events = withEditedEvent(series, "sw-3", edit({ startDate: "2026-11-18", endDate: "2026-11-18", scope: "this" }));
    expect(events.map((event) => local(event.startsAt))).toEqual([
      "2026-11-03 18:00", "2026-11-10 18:00", "2026-11-18 18:00", "2026-11-24 18:00", "2026-12-01 18:00", "2026-12-08 18:00",
    ]);
    expect(events.find((event) => event.id === "sw-3")).toMatchObject({ seriesIndex: 3 });
  });

  it("changes the time of the following ones, on each one's own day", () => {
    const events = withEditedEvent(swimming(), "sw-4", edit({ startTime: "19:00", endTime: "20:00", scope: "following" }));
    expect(events.map((event) => local(event.startsAt))).toEqual([
      "2026-11-03 18:00", "2026-11-10 18:00", "2026-11-17 18:00", "2026-11-24 19:00", "2026-12-01 19:00", "2026-12-08 19:00",
    ]);
    expect(events.map((event) => local(event.endsAt).slice(11))).toEqual(["19:00", "19:00", "19:00", "20:00", "20:00", "20:00"]);
  });

  it("shifts every occurrence by the same days for all", () => {
    const events = withEditedEvent(swimming(), "sw-2", edit({ startDate: "2026-11-11", endDate: "2026-11-11", scope: "all" }));
    expect(events.map((event) => local(event.startsAt).slice(0, 10))).toEqual([
      "2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25", "2026-12-02", "2026-12-09",
    ]);
  });

  it("sets text and people going on the occurrences reached", () => {
    const events = withEditedEvent(swimming(), "sw-5", edit({ title: "Diving", attendeeMemberIds: ["00000000-0000-4000-8000-000000000001"], scope: "following" }), [ANA, DAN]);
    expect(events.map((event) => event.title)).toEqual(["Swimming", "Swimming", "Swimming", "Swimming", "Diving", "Diving"]);
    expect(events[5].attendees).toEqual([ANA, DAN]);
    expect(events[0].attendees).toEqual([ANA]);
  });

  it("works on the occurrences it has when only some of a series is loaded", () => {
    const loaded = swimming().slice(2, 4); // the 3rd and 4th
    const events = withEditedEvent(loaded, "sw-3", edit({ startTime: "20:00", endTime: "21:00", scope: "following" }));
    expect(events.map((event) => local(event.startsAt).slice(11))).toEqual(["20:00", "20:00"]);
  });

  it("returns the events as they were when the edit is invalid or the event isn't there", () => {
    const series = swimming();
    expect(withEditedEvent(series, "sw-1", edit({ endTime: "17:00", scope: "this" }))).toEqual(series);
    expect(withEditedEvent(series, "nope", edit({ title: "x" }))).toEqual(series);
  });
});

describe("withoutEvents", () => {
  it("removes the one, the following, or the whole series", () => {
    const series = swimming();
    expect(withoutEvents(series, "sw-3", "this").map((event) => event.seriesIndex)).toEqual([1, 2, 4, 5, 6]);
    expect(withoutEvents(series, "sw-3", "following").map((event) => event.seriesIndex)).toEqual([1, 2]);
    expect(withoutEvents(series, "sw-3", "all")).toEqual([]);
  });

  it("leaves other events alone", () => {
    const other = calendarEvents({ id: "other", start: "2026-11-03 18:00" });
    expect(withoutEvents([...swimming(), ...other], "sw-1", "all")).toEqual(other);
    expect(withoutEvents(other, "nope", "all")).toEqual(other);
  });
});
