import { describe, expect, it } from "vitest";

import { DomainError } from "@/lib/errors";
import {
  editedRows,
  seriesRows,
  timingProblem,
  type EventTiming,
  type SeriesRepeatInput,
  type StoredRow,
} from "@/lib/family-calendar/series";
import { utcToZoned } from "@/lib/time-zone";

const BUCHAREST = "Europe/Bucharest";

const ONE_OFF: SeriesRepeatInput = { kind: "none", count: 1 };

function event(overrides: Partial<EventTiming & { repeat: SeriesRepeatInput }> = {}) {
  return {
    allDay: false,
    startDate: "2026-10-20",
    startTime: "09:00",
    endDate: "2026-10-20",
    endTime: "10:00",
    repeat: ONE_OFF,
    ...overrides,
  };
}

const local = (value: Date) => {
  const { date, time } = utcToZoned(value, BUCHAREST);
  return `${date} ${time}`;
};
const starts = (rows: { startsAt: Date }[]) => rows.map((row) => local(row.startsAt));
const iso = (value: Date) => value.toISOString();

/** A stored series from `seriesRows`, with ids `r1`, `r2`, … */
function stored(input: ReturnType<typeof event>): StoredRow[] {
  return seriesRows(input, BUCHAREST).map((row) => ({
    id: `r${row.seriesIndex}`,
    seriesIndex: row.seriesIndex,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    allDay: input.allDay,
  }));
}

describe("seriesRows", () => {
  it("makes one row for a one-off", () => {
    const rows = seriesRows(event({ startDate: "2026-11-03", endDate: "2026-11-03" }), BUCHAREST);
    expect(rows).toHaveLength(1);
    expect(rows[0].seriesIndex).toBe(1);
    expect(iso(rows[0].startsAt)).toBe("2026-11-03T07:00:00.000Z");
    expect(iso(rows[0].endsAt)).toBe("2026-11-03T08:00:00.000Z");
  });

  it("keeps 09:00 local through a daily series of 10 across the October change (25 October 2026)", () => {
    const rows = seriesRows(event({ startDate: "2026-10-21", endDate: "2026-10-21", repeat: { kind: "daily", count: 10 } }), BUCHAREST);

    expect(rows.map((row) => row.seriesIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(starts(rows)).toEqual([
      "2026-10-21 09:00", "2026-10-22 09:00", "2026-10-23 09:00", "2026-10-24 09:00", "2026-10-25 09:00",
      "2026-10-26 09:00", "2026-10-27 09:00", "2026-10-28 09:00", "2026-10-29 09:00", "2026-10-30 09:00",
    ]);
    // The offset moves from UTC+3 to UTC+2, so the instant moves an hour later on the 25th.
    expect(iso(rows[3].startsAt)).toBe("2026-10-24T06:00:00.000Z");
    expect(iso(rows[4].startsAt)).toBe("2026-10-25T07:00:00.000Z");
    expect(rows.map((row) => local(row.endsAt))).toEqual(starts(rows).map((value) => value.replace("09:00", "10:00")));
  });

  it("keeps 09:00 local through a weekly series of 10 across the October change", () => {
    const rows = seriesRows(event({ startDate: "2026-10-20", endDate: "2026-10-20", repeat: { kind: "weekly", count: 10 } }), BUCHAREST);

    expect(starts(rows)).toEqual([
      "2026-10-20 09:00", "2026-10-27 09:00", "2026-11-03 09:00", "2026-11-10 09:00", "2026-11-17 09:00",
      "2026-11-24 09:00", "2026-12-01 09:00", "2026-12-08 09:00", "2026-12-15 09:00", "2026-12-22 09:00",
    ]);
    expect(iso(rows[0].startsAt)).toBe("2026-10-20T06:00:00.000Z");
    expect(iso(rows[1].startsAt)).toBe("2026-10-27T07:00:00.000Z");
  });

  it("repeats weekly across the end of a month", () => {
    const rows = seriesRows(event({ startDate: "2026-01-28", endDate: "2026-01-28", repeat: { kind: "weekly", count: 3 } }), BUCHAREST);
    expect(starts(rows)).toEqual(["2026-01-28 09:00", "2026-02-04 09:00", "2026-02-11 09:00"]);
  });

  it("repeats weekly across the end of a year", () => {
    const rows = seriesRows(event({ startDate: "2026-12-24", endDate: "2026-12-24", repeat: { kind: "weekly", count: 3 } }), BUCHAREST);
    expect(starts(rows)).toEqual(["2026-12-24 09:00", "2026-12-31 09:00", "2027-01-07 09:00"]);
    expect(iso(rows[2].startsAt)).toBe("2027-01-07T07:00:00.000Z");
  });

  it("repeats daily across the end of a leap February", () => {
    const rows = seriesRows(event({ startDate: "2028-02-28", endDate: "2028-02-28", repeat: { kind: "daily", count: 3 } }), BUCHAREST);
    expect(starts(rows)).toEqual(["2028-02-28 09:00", "2028-02-29 09:00", "2028-03-01 09:00"]);
  });

  it("stores an all-day event from local midnight to local midnight after its last day", () => {
    // Three days: 3 to 5 November, UTC+2.
    const [row] = seriesRows(event({ allDay: true, startDate: "2026-11-03", startTime: null, endDate: "2026-11-05", endTime: null }), BUCHAREST);
    expect(iso(row.startsAt)).toBe("2026-11-02T22:00:00.000Z");
    expect(iso(row.endsAt)).toBe("2026-11-05T22:00:00.000Z");
  });

  it("repeats a three-day all-day event, each occurrence three days long", () => {
    const rows = seriesRows(
      event({ allDay: true, startDate: "2026-10-23", startTime: null, endDate: "2026-10-25", endTime: null, repeat: { kind: "weekly", count: 2 } }),
      BUCHAREST,
    );
    // 23-25 October ends at midnight on the 26th, after the clock change (UTC+2 by then);
    // 30 October-1 November ends on 2 November.
    expect(rows.map((row) => `${local(row.startsAt)} → ${local(row.endsAt)}`)).toEqual([
      "2026-10-23 00:00 → 2026-10-26 00:00",
      "2026-10-30 00:00 → 2026-11-02 00:00",
    ]);
    expect(iso(rows[0].startsAt)).toBe("2026-10-22T21:00:00.000Z");
    expect(iso(rows[0].endsAt)).toBe("2026-10-25T22:00:00.000Z");
  });

  it("ends a timed event across midnight on the next day", () => {
    const [row] = seriesRows(event({ startDate: "2026-11-03", startTime: "22:00", endDate: "2026-11-04", endTime: "01:30" }), BUCHAREST);
    expect(iso(row.startsAt)).toBe("2026-11-03T20:00:00.000Z");
    expect(iso(row.endsAt)).toBe("2026-11-03T23:30:00.000Z");
  });

  it("repeats a timed event across midnight, keeping its length on the wall clock", () => {
    const rows = seriesRows(
      event({ startDate: "2026-10-24", startTime: "22:00", endDate: "2026-10-25", endTime: "01:30", repeat: { kind: "daily", count: 3 } }),
      BUCHAREST,
    );
    expect(rows.map((row) => `${local(row.startsAt)} → ${local(row.endsAt)}`)).toEqual([
      "2026-10-24 22:00 → 2026-10-25 01:30",
      "2026-10-25 22:00 → 2026-10-26 01:30",
      "2026-10-26 22:00 → 2026-10-27 01:30",
    ]);
  });

  it("moves a 03:30 start on the spring change day (29 March 2026) to 04:00, the end of the gap", () => {
    const [row] = seriesRows(event({ startDate: "2026-03-29", startTime: "03:30", endDate: "2026-03-29", endTime: "05:00" }), BUCHAREST);
    expect(iso(row.startsAt)).toBe("2026-03-29T01:00:00.000Z");
    expect(local(row.startsAt)).toBe("2026-03-29 04:00");
    expect(iso(row.endsAt)).toBe("2026-03-29T02:00:00.000Z");
  });

  it("keeps a 03:30 daily series' later days at 03:30", () => {
    const rows = seriesRows(event({ startDate: "2026-03-28", startTime: "03:30", endDate: "2026-03-28", endTime: "04:30", repeat: { kind: "daily", count: 3 } }), BUCHAREST);
    expect(starts(rows)).toEqual(["2026-03-28 03:30", "2026-03-29 04:00", "2026-03-30 03:30"]);
  });

  it("throws for a timed event without times and for a repeat outside 1 to 10", () => {
    expect(() => seriesRows(event({ startTime: null }), BUCHAREST)).toThrow(RangeError);
    expect(() => seriesRows(event({ repeat: { kind: "daily", count: 11 } }), BUCHAREST)).toThrow(RangeError);
    expect(() => seriesRows(event({ repeat: { kind: "weekly", count: 0 } }), BUCHAREST)).toThrow(RangeError);
  });
});

describe("timingProblem", () => {
  it("accepts a timed event up to 30 days and an all-day event of 30 days", () => {
    expect(timingProblem(event({ endDate: "2026-11-19", endTime: "09:00", startTime: "09:00" }))).toBeNull();
    expect(timingProblem(event({ allDay: true, startTime: null, endTime: null, startDate: "2026-11-01", endDate: "2026-11-30" }))).toBeNull();
  });

  it("rejects an end that isn't after the start", () => {
    expect(timingProblem(event({ startTime: "10:00", endTime: "10:00" }))?.field).toBe("endTime");
    expect(timingProblem(event({ endTime: "08:00" }))?.field).toBe("endTime");
    expect(timingProblem(event({ allDay: true, startTime: null, endTime: null, endDate: "2026-10-19" }))?.field).toBe("endDate");
  });

  it("rejects an event longer than 30 days", () => {
    expect(timingProblem(event({ endDate: "2026-11-20", endTime: "09:01", startTime: "09:00" }))?.field).toBe("endDate");
    expect(timingProblem(event({ allDay: true, startTime: null, endTime: null, startDate: "2026-11-01", endDate: "2026-12-01" }))?.field).toBe("endDate");
  });
});

describe("editedRows", () => {
  const weekly6 = () => stored(event({ startDate: "2026-10-06", endDate: "2026-10-06", repeat: { kind: "weekly", count: 6 } }));
  const timesOf = (rows: { startsAt: Date; endsAt: Date }[]) =>
    rows.map((row) => `${local(row.startsAt)} → ${local(row.endsAt).slice(11)}`);

  it("returns the stored instants when the edit changes no timing", () => {
    const rows = weekly6();
    const edited = editedRows(rows, {}, BUCHAREST, "r4");
    expect(edited.map((row) => iso(row.startsAt))).toEqual(rows.map((row) => row.startsAt));
    expect(edited.map((row) => iso(row.endsAt))).toEqual(rows.map((row) => row.endsAt));
    expect(editedRows(rows, { startTime: null, endTime: null }, BUCHAREST, "r1")).toHaveLength(6);
  });

  it("moves the time from the 4th of 6 on, leaving the first three alone", () => {
    // 6 and 13 October are UTC+3; the series crosses the change on 25 October.
    const touched = weekly6().slice(3);
    const edited = editedRows(touched, { startTime: "18:00", endTime: "19:30" }, BUCHAREST, "r4");

    expect(edited.map((row) => row.id)).toEqual(["r4", "r5", "r6"]);
    expect(timesOf(edited)).toEqual([
      "2026-10-27 18:00 → 19:30",
      "2026-11-03 18:00 → 19:30",
      "2026-11-10 18:00 → 19:30",
    ]);
    expect(iso(edited[0].startsAt)).toBe("2026-10-27T16:00:00.000Z");
  });

  it("changes only the end time and keeps each row's own start", () => {
    const edited = editedRows(weekly6().slice(0, 2), { endTime: "11:15" }, BUCHAREST, "r1");
    expect(timesOf(edited)).toEqual(["2026-10-06 09:00 → 11:15", "2026-10-13 09:00 → 11:15"]);
  });

  it("shifts every row by the days the anchor moved on 'all'", () => {
    // Opened on the 4th occurrence (27 October) and moved to 29 October: two days later.
    const edited = editedRows(weekly6(), { startDate: "2026-10-29" }, BUCHAREST, "r4");
    expect(timesOf(edited)).toEqual([
      "2026-10-08 09:00 → 10:00",
      "2026-10-15 09:00 → 10:00",
      "2026-10-22 09:00 → 10:00",
      "2026-10-29 09:00 → 10:00",
      "2026-11-05 09:00 → 10:00",
      "2026-11-12 09:00 → 10:00",
    ]);
  });

  it("shifts earlier across a month end, keeping the time through the clock change", () => {
    const edited = editedRows(weekly6().slice(3), { startDate: "2026-10-26" }, BUCHAREST, "r4");
    expect(timesOf(edited)).toEqual([
      "2026-10-26 09:00 → 10:00",
      "2026-11-02 09:00 → 10:00",
      "2026-11-09 09:00 → 10:00",
    ]);
    expect(iso(edited[0].startsAt)).toBe("2026-10-26T07:00:00.000Z");
  });

  it("keeps the length when the start date moves, and moves the end with its own date", () => {
    const rows = stored(event({ startDate: "2026-10-30", startTime: "22:00", endDate: "2026-10-31", endTime: "01:00", repeat: { kind: "daily", count: 2 } }));
    const edited = editedRows(rows, { startDate: "2026-11-02" }, BUCHAREST, "r1");
    expect(edited.map((row) => `${local(row.startsAt)} → ${local(row.endsAt)}`)).toEqual([
      "2026-11-02 22:00 → 2026-11-03 01:00",
      "2026-11-03 22:00 → 2026-11-04 01:00",
    ]);
  });

  it("lets the end date move on its own, lengthening each occurrence", () => {
    const rows = stored(event({ allDay: true, startDate: "2026-11-03", startTime: null, endDate: "2026-11-03", endTime: null, repeat: { kind: "daily", count: 2 } }));
    const edited = editedRows(rows, { endDate: "2026-11-05" }, BUCHAREST, "r1");
    expect(edited.map((row) => `${local(row.startsAt)} → ${local(row.endsAt)}`)).toEqual([
      "2026-11-03 00:00 → 2026-11-06 00:00",
      "2026-11-04 00:00 → 2026-11-07 00:00",
    ]);
  });

  it("switches to all-day keeping each row's dates", () => {
    const rows = stored(event({ startDate: "2026-11-03", endDate: "2026-11-03", repeat: { kind: "daily", count: 2 } }));
    const edited = editedRows(rows, { allDay: true }, BUCHAREST, "r1");
    expect(edited.every((row) => row.allDay)).toBe(true);
    expect(edited.map((row) => `${local(row.startsAt)} → ${local(row.endsAt)}`)).toEqual([
      "2026-11-03 00:00 → 2026-11-04 00:00",
      "2026-11-04 00:00 → 2026-11-05 00:00",
    ]);
  });

  it("switches from all-day to timed with the given times on each row's dates", () => {
    const rows = stored(event({ allDay: true, startDate: "2026-11-03", startTime: null, endDate: "2026-11-03", endTime: null, repeat: { kind: "daily", count: 2 } }));
    const edited = editedRows(rows, { allDay: false, startTime: "09:00", endTime: "10:00" }, BUCHAREST, "r2");
    expect(edited.every((row) => !row.allDay)).toBe(true);
    expect(timesOf(edited)).toEqual(["2026-11-03 09:00 → 10:00", "2026-11-04 09:00 → 10:00"]);
  });

  it("refuses a switch to timed without both times", () => {
    const rows = stored(event({ allDay: true, startDate: "2026-11-03", startTime: null, endDate: "2026-11-03", endTime: null }));
    expect(() => editedRows(rows, { allDay: false, startTime: "09:00" }, BUCHAREST, "r1")).toThrow(DomainError);
    expect(() => editedRows(rows, { allDay: false }, BUCHAREST, "r1")).toThrow(DomainError);
  });

  it("refuses an edit that makes a row end before it starts, with the field named", () => {
    const rows = stored(event());
    try {
      editedRows(rows, { startTime: "11:00" }, BUCHAREST, "r1");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).status).toBe(422);
      expect((error as DomainError).fieldErrors).toEqual({ endTime: ["The event must end after it starts."] });
    }
  });

  it("refuses an edit that makes an event longer than 30 days", () => {
    expect(() => editedRows(stored(event()), { endDate: "2026-12-01" }, BUCHAREST, "r1")).toThrow(DomainError);
  });

  it("throws when the anchor isn't among the rows", () => {
    expect(() => editedRows(weekly6().slice(0, 2), { startTime: "10:00" }, BUCHAREST, "r5")).toThrow(RangeError);
  });
});
