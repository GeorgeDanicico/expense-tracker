import { describe, expect, it } from "vitest";

import { aiMonthAt, formatResetDay } from "@/lib/ai/month";

describe("aiMonthAt", () => {
  it("runs from midnight on the 1st to midnight on the 1st, in Bucharest", () => {
    // Summer time (UTC+3) in October until the 25th, winter time (UTC+2) from then.
    expect(aiMonthAt(new Date("2026-10-15T10:00:00Z"))).toEqual({
      key: "2026-10",
      start: new Date("2026-09-30T21:00:00Z"),
      resetsAt: new Date("2026-10-31T22:00:00Z"),
    });
  });

  it("changes month at Bucharest's midnight, not UTC's", () => {
    expect(aiMonthAt(new Date("2026-10-31T21:59:59Z")).key).toBe("2026-10");
    expect(aiMonthAt(new Date("2026-10-31T22:00:00Z")).key).toBe("2026-11");
    expect(aiMonthAt(new Date("2026-10-31T22:00:00Z")).start).toEqual(new Date("2026-10-31T22:00:00Z"));
  });

  it("rolls over the year", () => {
    expect(aiMonthAt(new Date("2026-12-20T10:00:00Z"))).toMatchObject({ key: "2026-12", resetsAt: new Date("2026-12-31T22:00:00Z") });
  });
});

describe("formatResetDay", () => {
  it("names the day in Bucharest", () => {
    expect(formatResetDay(new Date("2026-10-31T22:00:00Z"))).toBe("1 November");
    expect(formatResetDay(new Date("2026-12-31T22:00:00Z"))).toBe("1 January");
  });
});
