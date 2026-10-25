import { describe, expect, it } from "vitest";

import {
  formatDay,
  formatDueAt,
  overdueText,
  repeatLabel,
  repeatUnitName,
  snoozedText,
} from "@/lib/reminders/format";

// 12:00 in Bucharest (EEST, +3), the day before the autumn DST change.
const NOW = new Date("2026-10-24T09:00:00Z");
const TZ = "Europe/Bucharest";

describe("formatDay", () => {
  it("shows the weekday, day and month, and the year only for another year", () => {
    expect(formatDay("2026-10-31", NOW)).toBe("Sat 31 Oct");
    expect(formatDay("2027-10-29", NOW)).toBe("Fri 29 Oct 2027");
  });
});

describe("formatDueAt", () => {
  it("shows the open occurrence on the reminder's wall clock", () => {
    // 09:00 in Bucharest on 31 October is 07:00 UTC (EET, +2, after the change).
    expect(formatDueAt({ nextDueAt: "2026-10-31T07:00:00.000Z", timezone: TZ }, NOW)).toBe("Sat 31 Oct, 09:00");
    expect(formatDueAt({ nextDueAt: "2026-10-24T06:00:00.000Z", timezone: TZ }, NOW)).toBe("Sat 24 Oct, 09:00");
  });

  it("shows when a time skipped by the spring change really falls", () => {
    // 03:30 on 28 March 2027 doesn't exist in Bucharest; the occurrence moves to 04:00 (01:00 UTC).
    expect(formatDueAt({ nextDueAt: "2027-03-28T01:00:00.000Z", timezone: TZ }, NOW)).toBe("Sun 28 Mar 2027, 04:00");
  });

  it("is null once a one-off is done", () => {
    expect(formatDueAt({ nextDueAt: null, timezone: TZ }, NOW)).toBeNull();
  });
});

describe("repeatLabel", () => {
  it("names the presets", () => {
    expect(repeatLabel("none", 1)).toBe("Once");
    expect(repeatLabel("week", 1)).toBe("Weekly");
    expect(repeatLabel("month", 1)).toBe("Monthly");
    expect(repeatLabel("year", 1)).toBe("Yearly");
  });

  it("counts intervals above one", () => {
    expect(repeatLabel("week", 2)).toBe("Every 2 weeks");
    expect(repeatLabel("month", 3)).toBe("Every 3 months");
    expect(repeatLabel("year", 12)).toBe("Every 12 years");
  });

  it("gives the unit's name for the form", () => {
    expect(repeatUnitName("week", 1)).toBe("week");
    expect(repeatUnitName("month", 6)).toBe("months");
  });
});

describe("overdueText", () => {
  const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  it("says how late, rounded down, in minutes, hours or days", () => {
    expect(overdueText(at(30_000), NOW)).toBe("Just now");
    expect(overdueText(at(60_000), NOW)).toBe("1 minute late");
    expect(overdueText(at(59 * 60_000), NOW)).toBe("59 minutes late");
    expect(overdueText(at(60 * 60_000), NOW)).toBe("1 hour late");
    expect(overdueText(at(23.9 * 60 * 60_000), NOW)).toBe("23 hours late");
    expect(overdueText(at(24 * 60 * 60_000), NOW)).toBe("1 day late");
    expect(overdueText(at(10.5 * 24 * 60 * 60_000), NOW)).toBe("10 days late");
  });
});

describe("snoozedText", () => {
  it("says until when, on the reminder's wall clock", () => {
    expect(snoozedText({ snoozedUntil: "2026-10-25T07:00:00.000Z", timezone: TZ }, NOW)).toBe("Snoozed until Sun 25 Oct, 09:00");
    expect(snoozedText({ snoozedUntil: null, timezone: TZ }, NOW)).toBeNull();
  });
});
