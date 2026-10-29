import { describe, expect, it } from "vitest";

import { parseStatementDate } from "@/lib/imports/date";

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
