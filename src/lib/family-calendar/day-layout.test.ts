import { describe, expect, it } from "vitest";

import {
  layoutDayColumns,
  MIN_EVENT_MINUTES,
  minutesOfTime,
  nowPosition,
  slotTimeAt,
  timeOfMinutes,
  VIEW_END_HOUR,
  VIEW_START_HOUR,
} from "@/lib/family-calendar/day-layout";
import { calendarEvent } from "@/test/calendar-events";

const DAY = "2026-10-28";

/** The layout as `[id, start, end, column, columns]` rows, to read at a glance. */
const rows = (items: ReturnType<typeof layoutDayColumns>) => items.map((item) => [
  item.event.id, timeOfMinutes(item.startMinute), timeOfMinutes(item.endMinute % 1440), item.column, item.columns,
]);

const timed = (id: string, start: string, end: string, extra: { title?: string } = {}) =>
  calendarEvent({ id, start: `${DAY} ${start}`, end: `${DAY} ${end}`, ...extra });

describe("layoutDayColumns", () => {
  it("lays out nothing for an empty day", () => {
    expect(layoutDayColumns([], DAY)).toEqual([]);
  });

  it("gives a lone event the whole width, placed by its time", () => {
    const [item] = layoutDayColumns([timed("a", "09:30", "11:00")], DAY);
    expect(item).toMatchObject({ startMinute: 570, endMinute: 660, column: 0, columns: 1 });
  });

  it("puts events that follow one another in the same single column, even when they touch", () => {
    const items = layoutDayColumns([timed("b", "10:00", "11:00"), timed("a", "09:00", "10:00")], DAY);
    expect(rows(items)).toEqual([["a", "09:00", "10:00", 0, 1], ["b", "10:00", "11:00", 0, 1]]);
  });

  it("puts two overlapping events side by side", () => {
    const items = layoutDayColumns([timed("a", "09:00", "11:00"), timed("b", "10:00", "12:00")], DAY);
    expect(rows(items)).toEqual([["a", "09:00", "11:00", 0, 2], ["b", "10:00", "12:00", 1, 2]]);
  });

  it("shares the width among three events that overlap at once", () => {
    const items = layoutDayColumns([timed("a", "09:00", "12:00"), timed("b", "10:00", "11:00"), timed("c", "10:30", "11:30")], DAY);
    expect(rows(items)).toEqual([
      ["a", "09:00", "12:00", 0, 3],
      ["b", "10:00", "11:00", 1, 3],
      ["c", "10:30", "11:30", 2, 3],
    ]);
  });

  it("reuses a freed lane inside a group, so a chain of overlaps needs only two", () => {
    // a overlaps b, b overlaps c, but a and c don't: c goes under a in lane 0.
    const items = layoutDayColumns([timed("a", "09:00", "10:00"), timed("b", "09:30", "10:30"), timed("c", "10:00", "11:00")], DAY);
    expect(rows(items)).toEqual([
      ["a", "09:00", "10:00", 0, 2],
      ["b", "09:30", "10:30", 1, 2],
      ["c", "10:00", "11:00", 0, 2],
    ]);
  });

  it("widens an event into the lanes to its right that nothing overlapping it uses", () => {
    // y takes lane 0, x lane 1 and z lane 2; w (10:30) overlaps only y, so it takes lane 1 and spreads into lane 2.
    const items = layoutDayColumns([timed("x", "09:00", "10:00"), timed("y", "09:00", "12:00"), timed("z", "09:00", "09:30"), timed("w", "10:30", "11:00")], DAY);
    const placement = Object.fromEntries(items.map((item) => [item.event.id, [item.column, item.columns, item.span]]));
    expect(placement).toEqual({ y: [0, 3, 1], x: [1, 3, 1], z: [2, 3, 1], w: [1, 3, 2] });
  });

  it("gives an event the full width when nothing overlaps it", () => {
    expect(layoutDayColumns([timed("a", "09:00", "10:00")], DAY)[0]).toMatchObject({ column: 0, columns: 1, span: 1 });
  });

  it("keeps separate groups separate: a crowded morning doesn't narrow the afternoon", () => {
    const items = layoutDayColumns([
      timed("m1", "09:00", "10:00"), timed("m2", "09:00", "10:00"), timed("p", "15:00", "16:00"),
    ], DAY);
    expect(rows(items)).toEqual([
      ["m1", "09:00", "10:00", 0, 2],
      ["m2", "09:00", "10:00", 1, 2],
      ["p", "15:00", "16:00", 0, 1],
    ]);
  });

  it("starts the longer of two events that begin together in the first lane", () => {
    const items = layoutDayColumns([timed("short", "09:00", "09:30"), timed("long", "09:00", "11:00")], DAY);
    expect(rows(items).map(([id, , , column]) => [id, column])).toEqual([["long", 0], ["short", 1]]);
  });

  it("doesn't depend on the order the events arrive in", () => {
    const events = [timed("a", "09:00", "11:00"), timed("b", "10:00", "12:00"), timed("c", "13:00", "14:00"), timed("d", "10:30", "10:45")];
    expect(rows(layoutDayColumns([...events].reverse(), DAY))).toEqual(rows(layoutDayColumns(events, DAY)));
  });

  it("draws a very short event at least half an hour tall, and counts it as that long for overlaps", () => {
    const items = layoutDayColumns([timed("blip", "09:00", "09:05"), timed("next", "09:20", "10:00")], DAY);
    expect(items[0]).toMatchObject({ startMinute: 540, endMinute: 540 + MIN_EVENT_MINUTES });
    // 09:20 is inside blip's half hour, so the two sit side by side.
    expect(rows(items).map(([id, , , column, columns]) => [id, column, columns])).toEqual([["blip", 0, 2], ["next", 1, 2]]);
  });

  it("ends an event that runs to midnight at 24:00, and doesn't cap a late short one past it", () => {
    const [late] = layoutDayColumns([calendarEvent({ id: "late", start: `${DAY} 23:00`, end: "2026-10-29 00:00" })], DAY);
    expect(late).toMatchObject({ startMinute: 23 * 60, endMinute: 24 * 60 });
    const [blip] = layoutDayColumns([timed("blip", "23:50", "23:55")], DAY);
    expect(blip.endMinute).toBe(24 * 60);
  });

  it("leaves all-day and multi-day events to the all-day row", () => {
    const events = [
      calendarEvent({ id: "birthday", start: DAY }),
      calendarEvent({ id: "trip", start: "2026-10-27", end: "2026-10-29" }),
      calendarEvent({ id: "sleepover", start: `${DAY} 20:00`, end: "2026-10-29 10:00" }),
      timed("swim", "18:00", "19:00"),
    ];
    expect(layoutDayColumns(events, DAY).map((item) => item.event.id)).toEqual(["swim"]);
  });

  it("leaves out events on other days", () => {
    expect(layoutDayColumns([calendarEvent({ id: "x", start: "2026-10-29 09:00" })], DAY)).toEqual([]);
  });
});

describe("the grid's helpers", () => {
  it("shows 07:00 to 22:00", () => {
    expect([VIEW_START_HOUR, VIEW_END_HOUR]).toEqual([7, 22]);
  });

  it("converts between times and minutes", () => {
    expect(minutesOfTime("09:30")).toBe(570);
    expect(timeOfMinutes(570)).toBe("09:30");
    expect(timeOfMinutes(0)).toBe("00:00");
  });

  it("maps a click's offset down a column to that hour's start", () => {
    expect(slotTimeAt(0, 48)).toBe("00:00");
    expect(slotTimeAt(7 * 48 + 20, 48)).toBe("07:00");
    expect(slotTimeAt(13 * 48 + 47, 48)).toBe("13:00");
    expect(slotTimeAt(23 * 48 + 10, 48)).toBe("23:00");
  });

  it("keeps an offset past either end of the grid on its first or last hour", () => {
    expect(slotTimeAt(-5, 48)).toBe("00:00");
    expect(slotTimeAt(24 * 48 + 3, 48)).toBe("23:00");
  });

  it("finds the local day and minute of now in the Europe/Bucharest zone", () => {
    // Summer time ended on 25 October 2026, so 28 October is UTC+2: 19:15 UTC is 21:15 local.
    expect(nowPosition(new Date("2026-10-28T19:15:00Z"), "Europe/Bucharest")).toEqual({ date: "2026-10-28", minute: 21 * 60 + 15 });
    // After 22:00 UTC the local day has already turned over.
    expect(nowPosition(new Date("2026-10-28T22:30:00Z"), "Europe/Bucharest")).toEqual({ date: "2026-10-29", minute: 30 });
  });
});
