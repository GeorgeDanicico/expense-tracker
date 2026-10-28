import { describe, expect, it } from "vitest";

import {
  compareEvents,
  coversDay,
  dayTimeLabel,
  eventDays,
  eventLengthInDays,
  eventsOnDay,
  groupEventsByDay,
  timeLabel,
} from "@/lib/family-calendar/days";
import { calendarEvent } from "@/test/calendar-events";

describe("eventDays", () => {
  it("is the one day of an event within a day", () => {
    expect(eventDays(calendarEvent({ start: "2026-11-03 09:00", end: "2026-11-03 10:30" }))).toEqual({ first: "2026-11-03", last: "2026-11-03" });
  });

  it("reads days on the Bucharest wall clock, not UTC", () => {
    // 00:30 local on the 4th is 22:30 UTC on the 3rd.
    expect(eventDays(calendarEvent({ start: "2026-11-04 00:30", end: "2026-11-04 01:30" }))).toEqual({ first: "2026-11-04", last: "2026-11-04" });
  });

  it("reaches the next day for an event across midnight", () => {
    expect(eventDays(calendarEvent({ start: "2026-11-03 20:00", end: "2026-11-04 10:00" }))).toEqual({ first: "2026-11-03", last: "2026-11-04" });
  });

  it("stops at the evening before when an event ends exactly at midnight", () => {
    expect(eventDays(calendarEvent({ start: "2026-11-03 20:00", end: "2026-11-04 00:00" }))).toEqual({ first: "2026-11-03", last: "2026-11-03" });
  });

  it("covers every day of an all-day event, the last one included", () => {
    const trip = calendarEvent({ start: "2026-11-07", end: "2026-11-10" });
    expect(eventDays(trip)).toEqual({ first: "2026-11-07", last: "2026-11-10" });
    expect(eventLengthInDays(trip)).toBe(4);
    expect(coversDay(trip, "2026-11-10")).toBe(true);
    expect(coversDay(trip, "2026-11-11")).toBe(false);
    expect(coversDay(trip, "2026-11-06")).toBe(false);
  });
});

describe("labels", () => {
  it("shows the start and end time, or All day", () => {
    expect(timeLabel(calendarEvent({ start: "2026-11-03 09:00", end: "2026-11-03 10:30" }))).toBe("09:00 – 10:30");
    expect(timeLabel(calendarEvent({ start: "2026-11-03" }))).toBe("All day");
  });

  it("numbers the days of a multi-day all-day event", () => {
    const trip = calendarEvent({ start: "2026-11-07", end: "2026-11-09" });
    expect(dayTimeLabel(trip, "2026-11-07")).toBe("All day · day 1 of 3");
    expect(dayTimeLabel(trip, "2026-11-09")).toBe("All day · day 3 of 3");
  });

  it("says when a timed event begins and ends on the days it crosses", () => {
    const sleepover = calendarEvent({ start: "2026-11-03 20:00", end: "2026-11-04 10:00" });
    expect(dayTimeLabel(sleepover, "2026-11-03")).toBe("from 20:00");
    expect(dayTimeLabel(sleepover, "2026-11-04")).toBe("until 10:00");
    expect(dayTimeLabel(calendarEvent({ start: "2026-11-03 09:00", end: "2026-11-03 10:00" }), "2026-11-03")).toBe("09:00 – 10:00");
  });
});

describe("ordering within a day", () => {
  it("puts all-day and multi-day events first, then by start time", () => {
    const events = [
      calendarEvent({ id: "late", title: "Late", start: "2026-11-03 18:00" }),
      calendarEvent({ id: "early", title: "Early", start: "2026-11-03 08:00" }),
      calendarEvent({ id: "trip", title: "Trip", start: "2026-11-03", end: "2026-11-05" }),
      calendarEvent({ id: "all", title: "Birthday", start: "2026-11-03" }),
    ];
    expect(eventsOnDay(events, "2026-11-03").map((event) => event.id)).toEqual(["trip", "all", "early", "late"]);
  });

  it("breaks ties by title and then id, so the order never depends on arrival", () => {
    const a = calendarEvent({ id: "1", title: "A", start: "2026-11-03 09:00" });
    const b = calendarEvent({ id: "2", title: "B", start: "2026-11-03 09:00" });
    expect([b, a].sort(compareEvents).map((event) => event.title)).toEqual(["A", "B"]);
  });

  it("groups events under each day they cover, empty days included", () => {
    const events = [calendarEvent({ id: "trip", start: "2026-11-03", end: "2026-11-04" })];
    expect(groupEventsByDay(events, ["2026-11-02", "2026-11-03", "2026-11-04"]).map((group) => group.events.length)).toEqual([0, 1, 1]);
  });
});
