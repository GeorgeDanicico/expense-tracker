import { describe, expect, it } from "vitest";
import {
  APPLICATION_TIMEZONE,
  getApplicationCurrentMonth,
  getApplicationToday,
  isValidDate,
  isMonthAllowed,
  resolveMainExpenseMonth,
  shiftMonth,
} from "./dates";

describe("main Expenses month limits", () => {
  const now = new Date("2026-10-03T12:00:00Z");

  it("uses the Bucharest calendar around midnight and year rollover", () => {
    expect(APPLICATION_TIMEZONE).toBe("Europe/Bucharest");
    expect(getApplicationCurrentMonth(new Date("2026-12-31T21:59:59Z"))).toBe("2026-12");
    expect(getApplicationCurrentMonth(new Date("2026-12-31T22:00:00Z"))).toBe("2027-01");
    expect(getApplicationCurrentMonth(new Date("2026-09-30T21:00:00Z"))).toBe("2026-10");
  });

  it("resolves today's date on the Bucharest calendar across midnight, DST and year rollover", () => {
    expect(getApplicationToday(new Date("2026-12-31T21:59:59Z"))).toBe("2026-12-31");
    expect(getApplicationToday(new Date("2026-12-31T22:00:00Z"))).toBe("2027-01-01");
    expect(getApplicationToday(new Date("2026-07-14T20:59:59Z"))).toBe("2026-07-14");
    expect(getApplicationToday(new Date("2026-07-14T21:00:00Z"))).toBe("2026-07-15");
    expect(isValidDate(getApplicationToday())).toBe(true);
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
