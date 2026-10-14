import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  addMonths,
  ANALYTICS_PERIOD_MONTHS,
  ANALYTICS_PERIODS,
  APPLICATION_TIMEZONE,
  dateInMonth,
  daysInMonth,
  formatMonth,
  getMonthRange,
  lastDayOfMonth,
  monthKeysBetween,
  monthsBetween,
  toIsoDate,
  toIsoMonth,
  getBucharestMonth,
  getBucharestToday,
  isValidDate,
  isMonthAllowed,
  resolveMainExpenseMonth,
  shiftMonth,
} from "./calendar";

describe("main Expenses month limits", () => {
  const now = new Date("2026-10-03T12:00:00Z");

  it("uses the Bucharest calendar around midnight and year rollover", () => {
    expect(APPLICATION_TIMEZONE).toBe("Europe/Bucharest");
    expect(getBucharestMonth(new Date("2026-12-31T21:59:59Z"))).toBe("2026-12");
    expect(getBucharestMonth(new Date("2026-12-31T22:00:00Z"))).toBe("2027-01");
    expect(getBucharestMonth(new Date("2026-09-30T21:00:00Z"))).toBe("2026-10");
  });

  it("resolves today's date on the Bucharest calendar across midnight, DST and year rollover", () => {
    expect(getBucharestToday(new Date("2026-12-31T21:59:59Z"))).toBe("2026-12-31");
    expect(getBucharestToday(new Date("2026-12-31T22:00:00Z"))).toBe("2027-01-01");
    expect(getBucharestToday(new Date("2026-07-14T20:59:59Z"))).toBe("2026-07-14");
    expect(getBucharestToday(new Date("2026-07-14T21:00:00Z"))).toBe("2026-07-15");
    expect(isValidDate(getBucharestToday())).toBe(true);
  });

  it("caps direct future URL requests and safely resolves invalid or absent values", () => {
    for (const requested of ["2026-11", "2027-01", "2026-13", "2026-1", "bad", "", null, undefined]) {
      expect(resolveMainExpenseMonth(requested, now)).toBe("2026-10");
    }
    expect(resolveMainExpenseMonth("2026-10", now)).toBe("2026-10");
    expect(resolveMainExpenseMonth("2025-12", now)).toBe("2025-12");
  });

  it("allows previous-to-current navigation but rejects future input and next destinations", () => {
    expect(isMonthAllowed(shiftMonth("2026-09", 1), "2026-10")).toBe(true);
    expect(isMonthAllowed(shiftMonth("2026-10", 1), "2026-10")).toBe(false);
    expect(isMonthAllowed("2026-11", "2026-10")).toBe(false);
    expect(isMonthAllowed("bad", "2026-10")).toBe(false);
    expect(isMonthAllowed("2026-11")).toBe(true);
  });

  it("compares complete years across December and January", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(isMonthAllowed("2027-01", "2026-12")).toBe(false);
    expect(isMonthAllowed("2026-12", "2027-01")).toBe(true);
  });
});

describe("calendar arithmetic", () => {
  it("builds zero-padded ISO months and dates", () => {
    expect(toIsoMonth(2026, 3)).toBe("2026-03");
    expect(toIsoMonth(100, 12)).toBe("0100-12");
    expect(toIsoDate(2026, 3, 7)).toBe("2026-03-07");
    expect(dateInMonth("2026-03", 9)).toBe("2026-03-09");
  });

  it("adds days across month, leap-day and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
  });

  it("knows the length and last day of every month, including leap Februaries", () => {
    expect(daysInMonth("2024-02")).toBe(29);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2026-04")).toBe(30);
    expect(lastDayOfMonth("2026-12")).toBe("2026-12-31");
    expect(lastDayOfMonth("2100-02")).toBe("2100-02-28");
  });

  it("adds and counts months across year boundaries", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -13)).toBe("2025-12");
    expect(monthsBetween("2026-01", "2026-03")).toBe(2);
    expect(monthsBetween("2025-11", "2027-01")).toBe(14);
    expect(monthsBetween("2026-03", "2026-03")).toBe(0);
  });

  it("lists month keys up to but excluding the end month", () => {
    expect(monthKeysBetween("2025-11-01", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(monthKeysBetween("2026-02-01", "2026-02-01")).toEqual([]);
  });

  it("maps every preset analytics period to its month count", () => {
    expect(ANALYTICS_PERIODS).toEqual(["3m", "6m", "1y", "2y", "custom"]);
    expect(ANALYTICS_PERIOD_MONTHS).toEqual({ "3m": 3, "6m": 6, "1y": 12, "2y": 24 });
  });

  it("computes month ranges without the process time zone", () => {
    expect(getMonthRange("2026-12")).toEqual({ month: "2026-12", start: "2026-12-01", endExclusive: "2027-01-01" });
    expect(getMonthRange("2026-03")).toEqual({ month: "2026-03", start: "2026-03-01", endExclusive: "2026-04-01" });
    expect(shiftMonth("2026-10", 1)).toBe("2026-11");
    expect(shiftMonth("2026-03", -14)).toBe("2025-01");
    expect(formatMonth("2026-01")).toBe("January 2026");
    expect(formatMonth("2026-12")).toBe("December 2026");
  });
});

describe("the application clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is already in the next Bucharest month and day while UTC is still in the previous one", () => {
    const instant = new Date("2026-10-31T22:30:00Z");
    expect(getBucharestMonth(instant)).toBe("2026-11");
    expect(getBucharestToday(instant)).toBe("2026-11-01");
  });

  it("stays on New Year's Eve until midnight in Bucharest", () => {
    const instant = new Date("2026-12-31T21:59:59Z");
    expect(getBucharestMonth(instant)).toBe("2026-12");
    expect(getBucharestToday(instant)).toBe("2026-12-31");
  });

  it("falls back to the Bucharest month for invalid months", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T22:30:00Z"));
    expect(getBucharestMonth()).toBe("2026-11");
    expect(getBucharestToday()).toBe("2026-11-01");
    expect(getMonthRange("bad")).toEqual({ month: "2026-11", start: "2026-11-01", endExclusive: "2026-12-01" });
    expect(shiftMonth("2026-13", -1)).toBe("2026-10");
    expect(formatMonth("")).toBe("November 2026");

    vi.setSystemTime(new Date("2026-12-31T21:59:59Z"));
    expect(getMonthRange("").month).toBe("2026-12");
    expect(shiftMonth("bad", 1)).toBe("2027-01");
  });
});
