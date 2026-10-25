import { describe, expect, it } from "vitest";

import { utcToZoned, zonedTimeToUtc } from "@/lib/time-zone";

const BUCHAREST = "Europe/Bucharest";

const iso = (date: Date) => date.toISOString();

describe("zonedTimeToUtc", () => {
  it("converts winter (UTC+2) and summer (UTC+3) times", () => {
    expect(iso(zonedTimeToUtc("2026-01-15", "09:00", BUCHAREST))).toBe("2026-01-15T07:00:00.000Z");
    expect(iso(zonedTimeToUtc("2026-07-15", "09:00", BUCHAREST))).toBe("2026-07-15T06:00:00.000Z");
  });

  it("accepts seconds", () => {
    expect(iso(zonedTimeToUtc("2026-07-15", "09:00:30", BUCHAREST))).toBe("2026-07-15T06:00:30.000Z");
  });

  it("crosses midnight into the previous UTC day", () => {
    expect(iso(zonedTimeToUtc("2027-01-01", "00:30", BUCHAREST))).toBe("2026-12-31T22:30:00.000Z");
  });

  describe("on the spring change (29 March 2026, 03:00 jumps to 04:00)", () => {
    it.each([
      ["02:59", "2026-03-29T00:59:00.000Z"],
      ["03:00", "2026-03-29T01:00:00.000Z"],
      ["03:30", "2026-03-29T01:00:00.000Z"],
      ["03:59", "2026-03-29T01:00:00.000Z"],
      ["04:00", "2026-03-29T01:00:00.000Z"],
      ["04:01", "2026-03-29T01:01:00.000Z"],
      ["09:00", "2026-03-29T06:00:00.000Z"],
    ])("moves a skipped time forward to the first valid minute: %s", (time, expected) => {
      expect(iso(zonedTimeToUtc("2026-03-29", time, BUCHAREST))).toBe(expected);
    });
  });

  describe("on the autumn change (25 October 2026, 04:00 falls back to 03:00)", () => {
    it.each([
      ["02:59", "2026-10-24T23:59:00.000Z"],
      ["03:00", "2026-10-25T00:00:00.000Z"],
      ["03:30", "2026-10-25T00:30:00.000Z"],
      ["03:59", "2026-10-25T00:59:00.000Z"],
      ["04:00", "2026-10-25T02:00:00.000Z"],
      ["09:00", "2026-10-25T07:00:00.000Z"],
    ])("uses the earlier instant of a repeated time: %s", (time, expected) => {
      expect(iso(zonedTimeToUtc("2026-10-25", time, BUCHAREST))).toBe(expected);
    });
  });

  it("works in other zones", () => {
    expect(iso(zonedTimeToUtc("2026-03-08", "02:30", "America/New_York"))).toBe("2026-03-08T07:00:00.000Z");
    expect(iso(zonedTimeToUtc("2026-11-01", "01:30", "America/New_York"))).toBe("2026-11-01T05:30:00.000Z");
    expect(iso(zonedTimeToUtc("2026-06-01", "12:00", "UTC"))).toBe("2026-06-01T12:00:00.000Z");
    expect(iso(zonedTimeToUtc("2026-06-01", "12:00", "Asia/Kolkata"))).toBe("2026-06-01T06:30:00.000Z");
  });

  it("rejects malformed input", () => {
    expect(() => zonedTimeToUtc("2026-6-1", "09:00", BUCHAREST)).toThrow(RangeError);
    expect(() => zonedTimeToUtc("2026-06-01", "24:00", BUCHAREST)).toThrow(RangeError);
  });
});

describe("utcToZoned", () => {
  it("reads the local wall clock", () => {
    expect(utcToZoned(new Date("2026-01-15T07:00:00Z"), BUCHAREST)).toEqual({ date: "2026-01-15", time: "09:00" });
    expect(utcToZoned(new Date("2026-12-31T22:30:00Z"), BUCHAREST)).toEqual({ date: "2027-01-01", time: "00:30" });
    expect(utcToZoned(new Date("2026-10-25T00:00:00Z"), BUCHAREST)).toEqual({ date: "2026-10-25", time: "03:00" });
  });

  it("shows the repeated autumn hour twice and skips the spring one", () => {
    expect(utcToZoned(new Date("2026-10-25T00:30:00Z"), BUCHAREST).time).toBe("03:30");
    expect(utcToZoned(new Date("2026-10-25T01:30:00Z"), BUCHAREST).time).toBe("03:30");
    expect(utcToZoned(new Date("2026-03-29T00:59:00Z"), BUCHAREST).time).toBe("02:59");
    expect(utcToZoned(new Date("2026-03-29T01:00:00Z"), BUCHAREST).time).toBe("04:00");
  });

  it("round-trips every quarter hour across both change days", () => {
    for (const date of ["2026-03-29", "2026-10-25"]) {
      const start = Date.parse(`${date}T00:00:00Z`) - 3 * 3_600_000;
      for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
        const instant = new Date(start + minutes * 60_000);
        const local = utcToZoned(instant, BUCHAREST);
        const back = zonedTimeToUtc(local.date, local.time, BUCHAREST);
        // The second pass through the repeated autumn hour maps back to the first.
        const secondPass = local.time.startsWith("03:") && instant >= new Date("2026-10-25T01:00:00Z")
          && instant < new Date("2026-10-25T02:00:00Z");
        expect(back.getTime()).toBe(instant.getTime() - (secondPass ? 3_600_000 : 0));
      }
    }
  });
});
