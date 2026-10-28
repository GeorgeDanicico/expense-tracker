import { describe, expect, it } from "vitest";

import { MAX_RANGE_DAYS } from "@/lib/family-calendar/types";
import {
  calendarHref,
  dayHeading,
  longDate,
  monthGridDays,
  monthGridStart,
  monthGridWeeks,
  neighbourRanges,
  parseCalendarParams,
  periodTitle,
  rangeInstants,
  shiftCalendarDate,
  startOfWeek,
  viewRange,
  weekdayIndex,
} from "@/lib/family-calendar/view";

const TODAY = "2026-10-28";
/** What the service allows a range to cover: 92 days and an hour (see `MAX_RANGE_MS`). */
const MAX_RANGE_MS = MAX_RANGE_DAYS * 24 * 60 * 60_000 + 60 * 60_000;
const params = (query: string) => new URLSearchParams(query);

describe("parseCalendarParams", () => {
  it("is the month around today without parameters", () => {
    expect(parseCalendarParams(params(""), TODAY)).toEqual({ view: "month", date: TODAY });
  });

  it("reads the view and date from the URL", () => {
    expect(parseCalendarParams(params("view=agenda&date=2026-12-01"), TODAY)).toEqual({ view: "agenda", date: "2026-12-01" });
    expect(parseCalendarParams(params("view=week"), TODAY)).toEqual({ view: "week", date: TODAY });
  });

  it("ignores an unknown view and a date that doesn't exist", () => {
    expect(parseCalendarParams(params("view=year&date=2026-02-30"), TODAY)).toEqual({ view: "month", date: TODAY });
    expect(parseCalendarParams(params("date=tomorrow"), TODAY)).toEqual({ view: "month", date: TODAY });
  });
});

describe("calendarHref", () => {
  it("leaves the URL clean for Month and today", () => {
    expect(calendarHref("/calendar", "", { view: "month", date: TODAY }, TODAY)).toBe("/calendar");
  });

  it("writes the view and the date when they aren't the defaults", () => {
    expect(calendarHref("/calendar", "", { view: "agenda", date: "2026-11-28" }, TODAY)).toBe("/calendar?view=agenda&date=2026-11-28");
  });

  it("keeps other parameters and drops the ones that went back to the defaults", () => {
    expect(calendarHref("/calendar", "member=me&view=week&date=2026-11-02", { view: "month", date: TODAY }, TODAY)).toBe("/calendar?member=me");
  });
});

describe("weeks start on Monday", () => {
  it("numbers the weekdays from Monday", () => {
    expect(weekdayIndex("2026-10-26")).toBe(0);
    expect(weekdayIndex("2026-11-01")).toBe(6);
    expect(startOfWeek("2026-11-01")).toBe("2026-10-26");
    expect(startOfWeek("2026-10-26")).toBe("2026-10-26");
  });

  it("starts the grid on the Monday on or before the 1st", () => {
    expect(monthGridStart("2026-10-28")).toBe("2026-09-28"); // 1 October 2026 is a Thursday
    expect(monthGridStart("2026-06-15")).toBe("2026-06-01"); // 1 June 2026 is a Monday
    expect(monthGridStart("2027-01-10")).toBe("2026-12-28");
  });
});

describe("the month grid", () => {
  it("always has six weeks of seven days", () => {
    for (const month of ["2026-02", "2026-06", "2026-10", "2027-05"]) {
      const weeks = monthGridWeeks(`${month}-15`);
      expect(weeks).toHaveLength(6);
      expect(weeks.every((week) => week.length === 7)).toBe(true);
      expect(weeks.every((week) => weekdayIndex(week[0]) === 0)).toBe(true);
    }
  });

  it("covers the whole month and runs on into the next", () => {
    const days = monthGridDays("2026-10-28");
    expect(days[0]).toBe("2026-09-28");
    expect(days[41]).toBe("2026-11-08");
    expect(days).toContain("2026-10-01");
    expect(days).toContain("2026-10-31");
  });

  it("steps across a year end", () => {
    const days = monthGridDays("2026-12-05");
    expect(days[0]).toBe("2026-11-30");
    expect(days[41]).toBe("2027-01-10");
  });
});

describe("viewRange", () => {
  it("is the grid for Month, the week for Week and 60 days from the date for the Agenda", () => {
    expect(viewRange("month", "2026-10-28")).toEqual({ start: "2026-09-28", endExclusive: "2026-11-09" });
    expect(viewRange("week", "2026-10-28")).toEqual({ start: "2026-10-26", endExclusive: "2026-11-02" });
    expect(viewRange("agenda", "2026-10-28")).toEqual({ start: "2026-10-28", endExclusive: "2026-12-27" });
  });

  it("is within what the API lists in one request", () => {
    for (const view of ["month", "week", "agenda"] as const) {
      const { from, to } = rangeInstants(viewRange(view, "2026-10-28"));
      expect(Date.parse(to) - Date.parse(from)).toBeLessThanOrEqual(MAX_RANGE_MS);
    }
  });
});

describe("rangeInstants", () => {
  it("runs from local midnight to local midnight, across the October clock change", () => {
    // Bucharest is UTC+3 until 25 October 2026 and UTC+2 after.
    expect(rangeInstants({ start: "2026-09-28", endExclusive: "2026-11-09" })).toEqual({
      from: "2026-09-27T21:00:00.000Z",
      to: "2026-11-08T22:00:00.000Z",
    });
  });
});

describe("shiftCalendarDate", () => {
  it("moves a month, keeping the day where the month has it", () => {
    expect(shiftCalendarDate("month", "2026-10-28", 1)).toBe("2026-11-28");
    expect(shiftCalendarDate("month", "2026-10-31", 1)).toBe("2026-11-30");
    expect(shiftCalendarDate("month", "2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftCalendarDate("month", "2026-12-15", 1)).toBe("2027-01-15");
    expect(shiftCalendarDate("month", "2026-01-15", -1)).toBe("2025-12-15");
  });

  it("moves a week, and an Agenda window of 60 days", () => {
    expect(shiftCalendarDate("week", "2026-10-28", 1)).toBe("2026-11-04");
    expect(shiftCalendarDate("week", "2026-10-28", -1)).toBe("2026-10-21");
    expect(shiftCalendarDate("agenda", "2026-10-28", 1)).toBe("2026-12-27");
    expect(shiftCalendarDate("agenda", "2026-10-28", -1)).toBe("2026-08-29");
  });

  it("gives the ranges Previous and Next lead to", () => {
    const [previous, next] = neighbourRanges("month", "2026-10-28");
    expect(previous).toEqual(viewRange("month", "2026-09-28"));
    expect(next).toEqual(viewRange("month", "2026-11-28"));
  });
});

describe("periodTitle", () => {
  it("names the month", () => {
    expect(periodTitle("month", "2026-10-28", TODAY)).toBe("October 2026");
    expect(periodTitle("month", "2027-01-03", TODAY)).toBe("January 2027");
  });

  it("names the week by its first and last day", () => {
    expect(periodTitle("week", "2026-10-28", TODAY)).toBe("Oct 26 – Nov 1, 2026");
    expect(periodTitle("week", "2026-12-30", TODAY)).toBe("Dec 28, 2026 – Jan 3, 2027");
  });

  it("calls the Agenda from today the next 60 days, and from another day its dates", () => {
    expect(periodTitle("agenda", TODAY, TODAY)).toBe("Next 60 days");
    expect(periodTitle("agenda", "2026-12-27", TODAY)).toBe("Dec 27, 2026 – Feb 24, 2027");
  });
});

describe("day names", () => {
  it("writes a short heading and a long date", () => {
    expect(dayHeading("2026-11-04")).toBe("Wed 4 Nov");
    expect(longDate("2026-11-04")).toBe("Wednesday 4 November 2026");
  });
});
