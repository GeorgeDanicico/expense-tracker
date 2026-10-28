import { describe, expect, it } from "vitest";

import { layoutMonthWeek, MONTH_MAX_LANES } from "@/lib/family-calendar/month-layout";
import { calendarEvent } from "@/test/calendar-events";

// The week of Monday 26 October to Sunday 1 November 2026.
const WEEK = "2026-10-26";

const placed = (layout: ReturnType<typeof layoutMonthWeek>) => layout.segments.map((segment) => [
  segment.event.id, segment.column, segment.span, segment.lane,
]);

describe("layoutMonthWeek", () => {
  it("lays nothing for an empty week", () => {
    expect(layoutMonthWeek([], WEEK)).toEqual({ segments: [], moreByDay: [0, 0, 0, 0, 0, 0, 0], laneCount: 0 });
  });

  it("puts events on different days in the first lane", () => {
    const layout = layoutMonthWeek([
      calendarEvent({ id: "mon", start: "2026-10-26 09:00" }),
      calendarEvent({ id: "wed", start: "2026-10-28 09:00" }),
    ], WEEK);
    expect(placed(layout)).toEqual([["mon", 0, 1, 0], ["wed", 2, 1, 0]]);
    expect(layout.laneCount).toBe(1);
  });

  it("stacks events on the same day in order of start time", () => {
    const layout = layoutMonthWeek([
      calendarEvent({ id: "pm", start: "2026-10-28 18:00" }),
      calendarEvent({ id: "am", start: "2026-10-28 08:00" }),
    ], WEEK);
    expect(placed(layout)).toEqual([["am", 2, 1, 0], ["pm", 2, 1, 1]]);
  });

  it("spans a multi-day event across the days it covers, in one lane", () => {
    const layout = layoutMonthWeek([
      calendarEvent({ id: "trip", start: "2026-10-27", end: "2026-10-29" }),
      calendarEvent({ id: "dentist", start: "2026-10-28 10:00" }),
    ], WEEK);
    expect(placed(layout)).toEqual([["trip", 1, 3, 0], ["dentist", 2, 1, 1]]);
  });

  it("puts the longest event first when several start on the same day", () => {
    const layout = layoutMonthWeek([
      calendarEvent({ id: "short", start: "2026-10-27", end: "2026-10-27" }),
      calendarEvent({ id: "long", start: "2026-10-27", end: "2026-10-30" }),
    ], WEEK);
    expect(placed(layout)).toEqual([["long", 1, 4, 0], ["short", 1, 1, 1]]);
  });

  it("lets a later event reuse a lane the earlier ones have left", () => {
    const layout = layoutMonthWeek([
      calendarEvent({ id: "mon-tue", start: "2026-10-26", end: "2026-10-27" }),
      calendarEvent({ id: "wed", start: "2026-10-28 09:00" }),
    ], WEEK);
    expect(placed(layout)).toEqual([["mon-tue", 0, 2, 0], ["wed", 2, 1, 0]]);
  });

  it("opens the edges of an event that began before the week or goes on after it", () => {
    const layout = layoutMonthWeek([
      calendarEvent({ id: "before", start: "2026-10-23", end: "2026-10-27" }),
      calendarEvent({ id: "after", start: "2026-10-31", end: "2026-11-03" }),
    ], WEEK);
    expect(layout.segments.map((segment) => [segment.event.id, segment.column, segment.span, segment.startsBeforeWeek, segment.endsAfterWeek])).toEqual([
      ["before", 0, 2, true, false],
      ["after", 5, 2, false, true],
    ]);
  });

  it("ignores events outside the week", () => {
    const layout = layoutMonthWeek([
      calendarEvent({ id: "earlier", start: "2026-10-20 09:00" }),
      calendarEvent({ id: "later", start: "2026-11-02 09:00" }),
      calendarEvent({ id: "ends-on-monday", start: "2026-10-25 22:00", end: "2026-10-26 00:00" }),
    ], WEEK);
    expect(layout.segments).toEqual([]);
  });

  it("counts what doesn't fit in the lanes as 'more' on each of its days", () => {
    const events = [1, 2, 3, 4, 5].map((hour) => calendarEvent({ id: `e${hour}`, start: `2026-10-28 0${hour}:00` }));
    const layout = layoutMonthWeek(events, WEEK);
    expect(layout.segments.map((segment) => segment.event.id)).toEqual(["e1", "e2", "e3"]);
    expect(layout.moreByDay).toEqual([0, 0, 2, 0, 0, 0, 0]);
    expect(layout.laneCount).toBe(MONTH_MAX_LANES);
  });

  it("counts a hidden multi-day event on every day it covers", () => {
    const events = [
      ...[1, 2, 3].map((hour) => calendarEvent({ id: `d${hour}`, start: `2026-10-27 0${hour}:00` })),
      calendarEvent({ id: "trip", start: "2026-10-27", end: "2026-10-29" }),
    ];
    // The trip is longest, so it takes the first lane and the third day-event is the one pushed out.
    const layout = layoutMonthWeek(events, WEEK);
    expect(layout.segments.map((segment) => segment.event.id)).toEqual(["trip", "d1", "d2"]);
    expect(layout.moreByDay).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });

  it("gives the same layout whatever order the events arrive in", () => {
    const events = [
      calendarEvent({ id: "a", start: "2026-10-27 09:00" }),
      calendarEvent({ id: "b", start: "2026-10-26", end: "2026-10-28" }),
      calendarEvent({ id: "c", start: "2026-10-27 08:00" }),
    ];
    expect(layoutMonthWeek([...events].reverse(), WEEK)).toEqual(layoutMonthWeek(events, WEEK));
  });

  it("honours another number of lanes", () => {
    const events = [1, 2].map((hour) => calendarEvent({ id: `e${hour}`, start: `2026-10-28 0${hour}:00` }));
    const layout = layoutMonthWeek(events, WEEK, 1);
    expect(layout.segments).toHaveLength(1);
    expect(layout.moreByDay[2]).toBe(1);
  });
});

describe("layoutMonthWeek over fewer days", () => {
  it("lays out a three-day row from any date, with a bar clipped at its edges", () => {
    const layout = layoutMonthWeek([
      calendarEvent({ id: "trip", start: "2026-10-27", end: "2026-10-30" }),
      calendarEvent({ id: "out", start: "2026-11-02" }),
    ], "2026-10-29", 3, 3);
    expect(layout.moreByDay).toEqual([0, 0, 0]);
    expect(layout.segments).toHaveLength(1);
    expect(layout.segments[0]).toMatchObject({ column: 0, span: 2, startsBeforeWeek: true, endsAfterWeek: false });
  });

  it("counts the events behind '+N more' per day of the shorter row", () => {
    const events = ["a", "b", "c"].map((id) => calendarEvent({ id, start: "2026-10-30" }));
    expect(layoutMonthWeek(events, "2026-10-29", 2, 3).moreByDay).toEqual([0, 1, 0]);
  });
});
