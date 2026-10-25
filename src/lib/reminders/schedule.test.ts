import { describe, expect, it } from "vitest";

import {
  dueAt,
  nextNotifyAt,
  nextOccurrenceAfter,
  notifyTimes,
  occurrenceOn,
  snoozeEnd,
  stateOf,
} from "@/lib/reminders/schedule";
import type { ReminderSchedule } from "@/lib/reminders/types";

const BUCHAREST = "Europe/Bucharest";

function reminder(overrides: Partial<ReminderSchedule> = {}): ReminderSchedule {
  return {
    startsOn: "2026-01-01",
    timeOfDay: "09:00",
    timezone: BUCHAREST,
    repeatUnit: "none",
    repeatInterval: 1,
    leadMinutes: [0],
    notificationsMuted: false,
    nextDueOn: "2026-01-01",
    snoozedUntil: null,
    ...overrides,
  };
}

const at = (value: string) => new Date(value);
const isoOrNull = (value: Date | null) => value?.toISOString() ?? null;
const occurrences = (schedule: ReminderSchedule, count: number) =>
  Array.from({ length: count }, (_, k) => occurrenceOn(schedule, k));

describe("occurrenceOn", () => {
  it("clamps a monthly 31st to the month's last day through a leap February and back", () => {
    expect(occurrences(reminder({ startsOn: "2024-01-31", repeatUnit: "month" }), 6)).toEqual([
      "2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30", "2024-05-31", "2024-06-30",
    ]);
  });

  it("uses 28 February in a common year", () => {
    expect(occurrences(reminder({ startsOn: "2026-01-31", repeatUnit: "month" }), 3))
      .toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("counts every N months from the first date", () => {
    expect(occurrences(reminder({ startsOn: "2024-11-30", repeatUnit: "month", repeatInterval: 3 }), 4))
      .toEqual(["2024-11-30", "2025-02-28", "2025-05-30", "2025-08-30"]);
  });

  it("clamps a yearly 29 February to 28 February and returns in leap years", () => {
    expect(occurrences(reminder({ startsOn: "2024-02-29", repeatUnit: "year" }), 5))
      .toEqual(["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
    expect(occurrences(reminder({ startsOn: "2024-02-29", repeatUnit: "year", repeatInterval: 4 }), 3))
      .toEqual(["2024-02-29", "2028-02-29", "2032-02-29"]);
  });

  it("repeats every 2 weeks, across a year end", () => {
    expect(occurrences(reminder({ startsOn: "2026-11-22", repeatUnit: "week", repeatInterval: 2 }), 4))
      .toEqual(["2026-11-22", "2026-12-06", "2026-12-20", "2027-01-03"]);
  });

  it("has a single occurrence for a one-off", () => {
    const once = reminder({ startsOn: "2026-11-01" });
    expect(occurrenceOn(once, 0)).toBe("2026-11-01");
    expect(occurrenceOn(once, 1)).toBeNull();
  });

  it("has nothing before the first date or at a fractional step", () => {
    const monthly = reminder({ repeatUnit: "month" });
    expect(occurrenceOn(monthly, -1)).toBeNull();
    expect(occurrenceOn(monthly, 0.5)).toBeNull();
  });
});

describe("nextOccurrenceAfter", () => {
  const monthly31 = reminder({ startsOn: "2024-01-31", repeatUnit: "month" });

  it("returns the first date for any date before it", () => {
    expect(nextOccurrenceAfter(monthly31, "2023-12-01")).toBe("2024-01-31");
    expect(nextOccurrenceAfter(monthly31, "2024-01-30")).toBe("2024-01-31");
  });

  it("returns the occurrence strictly after the date", () => {
    expect(nextOccurrenceAfter(monthly31, "2024-01-31")).toBe("2024-02-29");
    expect(nextOccurrenceAfter(monthly31, "2024-02-15")).toBe("2024-02-29");
    expect(nextOccurrenceAfter(monthly31, "2024-02-29")).toBe("2024-03-31");
    expect(nextOccurrenceAfter(monthly31, "2024-03-30")).toBe("2024-03-31");
  });

  it("never drifts when chained from the previous occurrence", () => {
    const chained: string[] = ["2024-01-31"];
    for (let index = 0; index < 24; index += 1) {
      chained.push(nextOccurrenceAfter(monthly31, chained[chained.length - 1])!);
    }
    expect(chained).toEqual(occurrences(monthly31, 25));
    expect(chained.at(-1)).toBe("2026-01-31");
  });

  it("skips to the next leap day only every fourth year", () => {
    const yearly = reminder({ startsOn: "2024-02-29", repeatUnit: "year" });
    expect(nextOccurrenceAfter(yearly, "2024-02-29")).toBe("2025-02-28");
    expect(nextOccurrenceAfter(yearly, "2027-02-28")).toBe("2028-02-29");
    expect(nextOccurrenceAfter(yearly, "2027-03-01")).toBe("2028-02-29");
  });

  it("steps every 2 weeks", () => {
    const fortnightly = reminder({ startsOn: "2026-10-25", repeatUnit: "week", repeatInterval: 2 });
    expect(nextOccurrenceAfter(fortnightly, "2026-10-25")).toBe("2026-11-08");
    expect(nextOccurrenceAfter(fortnightly, "2026-11-07")).toBe("2026-11-08");
    expect(nextOccurrenceAfter(fortnightly, "2026-11-08")).toBe("2026-11-22");
    expect(nextOccurrenceAfter(fortnightly, "2026-11-09")).toBe("2026-11-22");
  });

  it("has none after a one-off's date", () => {
    const once = reminder({ startsOn: "2026-11-01" });
    expect(nextOccurrenceAfter(once, "2026-10-31")).toBe("2026-11-01");
    expect(nextOccurrenceAfter(once, "2026-11-01")).toBeNull();
    expect(nextOccurrenceAfter(once, "2027-01-01")).toBeNull();
  });
});

describe("dueAt", () => {
  it("is the local time of day as an instant, on either side of a DST change", () => {
    const daily = reminder({ timeOfDay: "09:00" });
    expect(dueAt(daily, "2026-03-28").toISOString()).toBe("2026-03-28T07:00:00.000Z");
    expect(dueAt(daily, "2026-03-29").toISOString()).toBe("2026-03-29T06:00:00.000Z");
    expect(dueAt(daily, "2026-10-25").toISOString()).toBe("2026-10-25T07:00:00.000Z");
  });

  it("moves 03:30 on the spring change day to 04:00, and back to 03:30 the week after", () => {
    const weekly = reminder({ startsOn: "2026-03-22", timeOfDay: "03:30", repeatUnit: "week" });
    expect(dueAt(weekly, occurrenceOn(weekly, 0)!).toISOString()).toBe("2026-03-22T01:30:00.000Z");
    expect(dueAt(weekly, occurrenceOn(weekly, 1)!).toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(dueAt(weekly, occurrenceOn(weekly, 2)!).toISOString()).toBe("2026-04-05T00:30:00.000Z");
  });

  it("uses the earlier 03:30 on the autumn change day", () => {
    expect(dueAt(reminder({ timeOfDay: "03:30" }), "2026-10-25").toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("notifyTimes", () => {
  const times = (schedule: ReminderSchedule) => notifyTimes(schedule).map((time) => time.toISOString());

  it("subtracts lead times in local time across the March change", () => {
    expect(times(reminder({ nextDueOn: "2026-03-29", leadMinutes: [0, 1440] }))).toEqual([
      "2026-03-28T07:00:00.000Z", // 09:00 the day before, UTC+2: 23 hours earlier
      "2026-03-29T06:00:00.000Z",
    ]);
    expect(times(reminder({ nextDueOn: "2026-04-01", leadMinutes: [10080, 60, 0] }))).toEqual([
      "2026-03-25T07:00:00.000Z",
      "2026-04-01T05:00:00.000Z",
      "2026-04-01T06:00:00.000Z",
    ]);
  });

  it("subtracts lead times in local time across the October change", () => {
    expect(times(reminder({ nextDueOn: "2026-10-25", leadMinutes: [0, 1440, 4320] }))).toEqual([
      "2026-10-22T06:00:00.000Z",
      "2026-10-24T06:00:00.000Z", // 09:00 the day before, UTC+3: 25 hours earlier
      "2026-10-25T07:00:00.000Z",
    ]);
  });

  it("handles a 03:30 reminder on the spring change day", () => {
    expect(times(reminder({ nextDueOn: "2026-03-29", timeOfDay: "03:30", leadMinutes: [0, 60, 1440] }))).toEqual([
      "2026-03-28T01:30:00.000Z", // 03:30 the day before
      "2026-03-29T00:30:00.000Z", // 02:30, before the gap
      "2026-03-29T01:00:00.000Z", // 03:30 doesn't exist: 04:00
    ]);
  });

  it("moves a lead time that lands in the spring gap to its end", () => {
    expect(times(reminder({ nextDueOn: "2026-03-29", timeOfDay: "04:30", leadMinutes: [0, 60] }))).toEqual([
      "2026-03-29T01:00:00.000Z", // 03:30 → 04:00
      "2026-03-29T01:30:00.000Z",
    ]);
  });

  it("is empty once a one-off is done, or without lead times", () => {
    expect(notifyTimes(reminder({ nextDueOn: null }))).toEqual([]);
    expect(notifyTimes(reminder({ leadMinutes: [] }))).toEqual([]);
  });
});

describe("nextNotifyAt", () => {
  // Due Mon 30 November 2026 09:00 (07:00Z); notifies on the 27th, the 29th and the 30th.
  const rent = reminder({
    startsOn: "2026-01-30", repeatUnit: "month", nextDueOn: "2026-11-30", leadMinutes: [0, 1440, 4320],
  });
  const before = (value: string) => new Date(at(value).getTime() - 1);

  it("returns the first notify time after a save", () => {
    expect(isoOrNull(nextNotifyAt(rent, at("2026-11-01T00:00:00Z")))).toBe("2026-11-27T07:00:00.000Z");
  });

  it("skips the times already passed when saved", () => {
    expect(isoOrNull(nextNotifyAt(rent, at("2026-11-28T00:00:00Z")))).toBe("2026-11-29T07:00:00.000Z");
  });

  it("steps through each notify time, then nothing until the reminder changes", () => {
    expect(isoOrNull(nextNotifyAt(rent, at("2026-11-27T07:00:00Z")))).toBe("2026-11-29T07:00:00.000Z");
    expect(isoOrNull(nextNotifyAt(rent, at("2026-11-29T07:00:00Z")))).toBe("2026-11-30T07:00:00.000Z");
    expect(nextNotifyAt(rent, at("2026-11-30T07:00:00Z"))).toBeNull();
  });

  it("returns only the latest of several missed times", () => {
    const now = at("2026-12-07T10:00:00Z");
    expect(isoOrNull(nextNotifyAt(rent, before("2026-11-27T07:00:00Z"), now))).toBe("2026-11-30T07:00:00.000Z");
    expect(nextNotifyAt(rent, now)).toBeNull();
  });

  it("returns the latest missed time and then the next future one", () => {
    const now = at("2026-11-29T12:00:00Z");
    expect(isoOrNull(nextNotifyAt(rent, before("2026-11-27T07:00:00Z"), now))).toBe("2026-11-29T07:00:00.000Z");
    expect(isoOrNull(nextNotifyAt(rent, now))).toBe("2026-11-30T07:00:00.000Z");
  });

  it("returns the claimed time itself when it's the only one missed", () => {
    const now = at("2026-11-27T07:00:30Z");
    expect(isoOrNull(nextNotifyAt(rent, before("2026-11-27T07:00:00Z"), now))).toBe("2026-11-27T07:00:00.000Z");
  });

  it("notifies at the end of a snooze after the occurrence", () => {
    const snoozed = { ...rent, snoozedUntil: "2026-11-30T10:00:00.000Z" };
    expect(isoOrNull(nextNotifyAt(snoozed, at("2026-11-30T08:00:00Z")))).toBe("2026-11-30T10:00:00.000Z");
    expect(nextNotifyAt(snoozed, at("2026-11-30T10:00:00Z"))).toBeNull();
  });

  it("drops the notify times a snooze covers", () => {
    const snoozed = { ...rent, snoozedUntil: "2026-11-29T12:00:00.000Z" };
    expect(isoOrNull(nextNotifyAt(snoozed, at("2026-11-27T08:00:00Z")))).toBe("2026-11-29T12:00:00.000Z");
    expect(isoOrNull(nextNotifyAt(snoozed, at("2026-11-29T12:00:00Z")))).toBe("2026-11-30T07:00:00.000Z");
  });

  it("is null when muted, snoozed or not", () => {
    expect(nextNotifyAt({ ...rent, notificationsMuted: true }, at("2026-11-01T00:00:00Z"))).toBeNull();
    expect(nextNotifyAt(
      { ...rent, notificationsMuted: true, snoozedUntil: "2026-12-01T10:00:00.000Z" },
      at("2026-11-30T08:00:00Z"),
    )).toBeNull();
  });

  it("is null once a one-off is done or without lead times", () => {
    expect(nextNotifyAt({ ...rent, nextDueOn: null }, at("2026-11-01T00:00:00Z"))).toBeNull();
    expect(nextNotifyAt({ ...rent, leadMinutes: [] }, at("2026-11-01T00:00:00Z"))).toBeNull();
  });

  it("drives a worker that ticks every 30 minutes: one notification per lead time", () => {
    const sent: string[] = [];
    let stored = nextNotifyAt(rent, at("2026-11-01T00:00:00Z"));
    for (let now = at("2026-11-01T00:00:00Z"); now < at("2026-12-15T00:00:00Z"); now = new Date(now.getTime() + 1_800_000)) {
      if (stored === null || stored > now) continue;
      const sendAt = nextNotifyAt(rent, new Date(stored.getTime() - 1), now)!;
      sent.push(sendAt.toISOString());
      stored = nextNotifyAt(rent, now);
    }
    expect(sent).toEqual(["2026-11-27T07:00:00.000Z", "2026-11-29T07:00:00.000Z", "2026-11-30T07:00:00.000Z"]);
  });
});

describe("stateOf", () => {
  const due = reminder({ nextDueOn: "2026-11-30" }); // 09:00 Bucharest is 07:00Z

  it("is upcoming before the due day, in local time", () => {
    expect(stateOf(due, at("2026-11-20T12:00:00Z"))).toBe("upcoming");
    expect(stateOf(due, at("2026-11-29T21:59:00Z"))).toBe("upcoming"); // 23:59 on the 29th
  });

  it("is due on the day before its time", () => {
    expect(stateOf(due, at("2026-11-29T22:00:00Z"))).toBe("due"); // 00:00 on the 30th
    expect(stateOf(due, at("2026-11-30T06:59:59Z"))).toBe("due");
  });

  it("is overdue from its time until marked done", () => {
    expect(stateOf(due, at("2026-11-30T07:00:00Z"))).toBe("overdue");
    expect(stateOf(due, at("2027-02-01T00:00:00Z"))).toBe("overdue");
  });

  it("is snoozed while a snooze lasts, then overdue again", () => {
    const snoozed = { ...due, snoozedUntil: "2026-11-30T10:00:00.000Z" };
    expect(stateOf(snoozed, at("2026-11-30T08:00:00Z"))).toBe("snoozed");
    expect(stateOf(snoozed, at("2026-11-30T10:00:00Z"))).toBe("overdue");
  });

  it("is done without an open occurrence", () => {
    expect(stateOf(reminder({ nextDueOn: null }), at("2026-11-30T08:00:00Z"))).toBe("done");
  });
});

describe("snoozeEnd", () => {
  it("snoozes an hour", () => {
    expect(snoozeEnd({ kind: "hour" }, at("2026-11-30T08:15:00Z"), BUCHAREST).toISOString())
      .toBe("2026-11-30T09:15:00.000Z");
  });

  it("snoozes until 09:00 tomorrow in local time, across the autumn change", () => {
    // 01:30 on 25 October in Bucharest (UTC+3); tomorrow 09:00 is UTC+2.
    expect(snoozeEnd({ kind: "tomorrow" }, at("2026-10-24T22:30:00Z"), BUCHAREST).toISOString())
      .toBe("2026-10-26T07:00:00.000Z");
    expect(snoozeEnd({ kind: "tomorrow" }, at("2026-10-25T21:00:00Z"), BUCHAREST).toISOString())
      .toBe("2026-10-26T07:00:00.000Z");
  });

  it("snoozes until a chosen time", () => {
    expect(snoozeEnd({ kind: "until", until: "2026-12-01T10:00:00.000Z" }, at("2026-11-30T08:00:00Z"), BUCHAREST)
      .toISOString()).toBe("2026-12-01T10:00:00.000Z");
  });
});
