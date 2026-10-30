import { describe, expect, it } from "vitest";

import { parseStatementDate, parseYearlessStatementDate, resolveYearlessDate } from "@/lib/imports/date";

describe("parseStatementDate", () => {
  it.each([
    ["2026-10-03", "2026-10-03"],
    ["03.10.2026", "2026-10-03"],
    ["03/10/2026", "2026-10-03"],
    ["03-10-2026", "2026-10-03"],
    ["3.10.2026", "2026-10-03"],
    ["3/1/2026", "2026-01-03"],
    ["2026-1-5", "2026-01-05"],
    ["  03.10.2026  ", "2026-10-03"],
    ["29.02.2028", "2028-02-29"],
    ["31.12.2026", "2026-12-31"],
    ["01.01.2026", "2026-01-01"],
  ])("reads %j", (text, expected) => {
    expect(parseStatementDate(text)).toBe(expected);
  });

  it("reads day first: 03/04/2026 is the third of April", () => {
    expect(parseStatementDate("03/04/2026")).toBe("2026-04-03");
    expect(parseStatementDate("10/03/2026")).toBe("2026-03-10");
  });

  it.each([
    ["2026-10-03T14:05:09Z", "2026-10-03"],
    ["2026-10-03T23:59:59+03:00", "2026-10-03"],
    ["2026-10-03T23:59:59.123-0500", "2026-10-03"],
    ["2026-10-03 14:05:09", "2026-10-03"],
    ["2026-10-03 14:05", "2026-10-03"],
    ["03.10.2026 14:05", "2026-10-03"],
    ["03/10/2026 14:05:09", "2026-10-03"],
    ["03-10-2026 9:05:09", "2026-10-03"],
  ])("keeps only the date of the timestamp %j", (text, expected) => {
    expect(parseStatementDate(text)).toBe(expected);
  });

  it.each([
    "31.02.2026",
    "30.02.2026",
    "29.02.2026",
    "31.04.2026",
    "00.10.2026",
    "32.10.2026",
    "03.13.2026",
    "03.00.2026",
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
  ])("rejects the impossible date %j", (text) => {
    expect(parseStatementDate(text)).toBeNull();
  });

  it.each([
    "",
    "   ",
    "tomorrow",
    "03.10.26",
    "03.10",
    "2026-10",
    "20261003",
    "03.10-2026",
    "2026/10/03",
    "2026.10.03",
    "03.10.2026 25:00x",
    "03.10.2026 and more",
    "1 Oct 2026",
    "-03.10.2026",
  ])("rejects %j", (text) => {
    expect(parseStatementDate(text)).toBeNull();
  });
});

describe("parseYearlessStatementDate", () => {
  it.each([
    ["12.10", { day: 12, month: 10 }],
    ["12/10", { day: 12, month: 10 }],
    ["12-10", { day: 12, month: 10 }],
    ["2.1", { day: 2, month: 1 }],
    ["12.10.", { day: 12, month: 10 }],
    ["12 Oct", { day: 12, month: 10 }],
    ["12 oct.", { day: 12, month: 10 }],
    ["  3  OCTOMBRIE ", { day: 3, month: 10 }],
    ["5 mai", { day: 5, month: 5 }],
    ["5 May", { day: 5, month: 5 }],
    ["1 Sept.", { day: 1, month: 9 }],
    ["14 Februarie", { day: 14, month: 2 }],
    ["7 Iun", { day: 7, month: 6 }],
    ["29.02", { day: 29, month: 2 }],
    ["31.12", { day: 31, month: 12 }],
  ])("reads %j", (text, expected) => {
    expect(parseYearlessStatementDate(text)).toEqual(expected);
  });

  it("reads day first, as parseStatementDate does: 10/25 is no date, never the 25th of October", () => {
    expect(parseYearlessStatementDate("03/04")).toEqual({ day: 3, month: 4 });
    expect(parseYearlessStatementDate("10/25")).toBeNull();
  });

  it.each(["31.11", "30.02", "31.04", "32.10", "0.10", "12.00", "12.13", "12 Foo", "12 Octomb", "Oct 12", "12", "12.10.2026", "2026-10-12", "12.10.26", "12,10", "", "tomorrow"])(
    "rejects %j",
    (text) => {
      expect(parseYearlessStatementDate(text)).toBeNull();
    },
  );
});

describe("resolveYearlessDate", () => {
  const TODAY = "2026-10-30";
  const resolve = (day: number, month: number, fullDates: string[] = [], today = TODAY) =>
    resolveYearlessDate({ day, month }, { fullDates, today });

  describe("with the statement's own dates", () => {
    it("takes the year that puts the date inside the period", () => {
      expect(resolve(12, 10, ["2026-10-01", "2026-10-31"])).toBe("2026-10-12");
      expect(resolve(12, 10, ["2025-10-01", "2025-10-31"])).toBe("2025-10-12");
    });

    it("handles a statement that runs over New Year, taking each year from the period", () => {
      const period = ["2026-12-05", "2027-01-04"];

      expect(resolve(28, 12, period)).toBe("2026-12-28");
      expect(resolve(2, 1, period)).toBe("2027-01-02");
      expect(resolve(5, 12, period)).toBe("2026-12-05");
      expect(resolve(4, 1, period)).toBe("2027-01-04");
    });

    it("takes the nearest year when the date falls just outside the period", () => {
      // A payment on 30 September on a statement that starts on 1 October.
      expect(resolve(30, 9, ["2026-10-01", "2026-10-31"])).toBe("2026-09-30");
      // 2 January on a statement for December: the next year is nearer than the one before.
      expect(resolve(2, 1, ["2026-12-01", "2026-12-31"])).toBe("2027-01-02");
    });

    it("uses one date as a point and ignores the order of the dates", () => {
      expect(resolve(12, 10, ["2026-10-30"])).toBe("2026-10-12");
      expect(resolve(12, 10, ["2026-10-31", "2026-10-01"])).toBe("2026-10-12");
    });

    it("does not look at today, even when the date would be in the future", () => {
      expect(resolve(12, 11, ["2026-11-01", "2026-11-30"], "2026-10-30")).toBe("2026-11-12");
    });

    it("refuses a tie rather than guess: two years inside a wide period, or two equally near", () => {
      expect(resolve(12, 10, ["2025-01-01", "2026-12-31"])).toBeNull();
      // 1 January is exactly 183 days from 2 July 2028 on either side.
      expect(resolve(1, 1, ["2028-07-02"])).toBeNull();
    });

    it("finds no year for 29 February when none in reach is a leap year", () => {
      expect(resolve(29, 2, ["2026-02-01", "2026-03-01"])).toBeNull();
      expect(resolve(29, 2, ["2028-02-01", "2028-03-01"])).toBe("2028-02-29");
    });
  });

  describe("without any", () => {
    it("takes the most recent occurrence that is not after today", () => {
      expect(resolve(12, 10)).toBe("2026-10-12");
      expect(resolve(30, 10)).toBe("2026-10-30");
      expect(resolve(31, 10)).toBe("2025-10-31");
      expect(resolve(1, 1)).toBe("2026-01-01");
      expect(resolve(31, 12)).toBe("2025-12-31");
    });

    it("goes back to the last leap year for 29 February", () => {
      expect(resolve(29, 2, [], "2026-10-30")).toBe("2024-02-29");
      expect(resolve(29, 2, [], "2028-03-01")).toBe("2028-02-29");
    });

    it("ignores dates in the context that are not real dates", () => {
      expect(resolve(12, 10, ["2026-02-31"])).toBe("2026-10-12");
    });
  });
});
