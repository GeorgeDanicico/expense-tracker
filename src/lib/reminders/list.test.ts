import { describe, expect, it } from "vitest";

import {
  completeLocally,
  doneEntries,
  groupReminders,
  pendingCompletion,
  snoozeLocally,
  upsertReminder,
  withCurrentState,
  type ListedReminder,
} from "@/lib/reminders/list";
import type { ReminderCompletion } from "@/lib/reminders/repository";
import { dueAt, stateOf } from "@/lib/reminders/schedule";

// 12:00 in Bucharest on Saturday 24 October 2026.
const NOW = new Date("2026-10-24T09:00:00Z");

function reminder(overrides: Partial<ListedReminder> & Pick<ListedReminder, "id">): ListedReminder {
  const base = {
    title: overrides.id, notes: "", startsOn: "2026-10-24", timeOfDay: "18:00", timezone: "Europe/Bucharest",
    repeatUnit: "none" as const, repeatInterval: 1, leadMinutes: [0], notificationsMuted: false,
    nextDueOn: "2026-10-24", snoozedUntil: null, nextNotifyAt: null, expenseTemplate: null, createdAt: "", updatedAt: "",
    ...overrides,
  };
  const nextDueAt = base.nextDueOn === null ? null : dueAt(base, base.nextDueOn).toISOString();
  return { ...base, nextDueAt, state: stateOf(base, NOW) };
}

function completion(id: string, reminderId: string, doneAt: string): ReminderCompletion {
  return { id, reminderId, occurrenceOn: doneAt.slice(0, 10), doneAt, expenseId: null };
}

describe("groupReminders", () => {
  const dueToday = reminder({ id: "due" });
  const tomorrow = reminder({ id: "tomorrow", nextDueOn: "2026-10-25", timeOfDay: "08:00" });
  const nextWeek = reminder({ id: "next-week", nextDueOn: "2026-10-31" });
  const snoozed = reminder({ id: "snoozed", nextDueOn: "2026-10-22", snoozedUntil: "2026-10-25T07:00:00.000Z" });
  const lateTwoDays = reminder({ id: "late-2d", nextDueOn: "2026-10-22" });
  const lateThisMorning = reminder({ id: "late-am", timeOfDay: "08:00" });
  const finished = reminder({ id: "finished", nextDueOn: null });

  it("puts due today first in Upcoming, then upcoming and snoozed ones by due time", () => {
    const { upcoming } = groupReminders([nextWeek, tomorrow, snoozed, dueToday, finished, lateTwoDays]);
    expect(upcoming.map((item) => item.id)).toEqual(["due", "snoozed", "tomorrow", "next-week"]);
  });

  it("lists the overdue ones, the most late first, and leaves done one-offs out", () => {
    const { overdue } = groupReminders([lateThisMorning, finished, lateTwoDays, dueToday]);
    expect(overdue.map((item) => item.id)).toEqual(["late-2d", "late-am"]);
  });
});

describe("withCurrentState", () => {
  it("moves a reminder on as time passes, keeping unchanged ones as they were", () => {
    const due = reminder({ id: "due" });
    const later = withCurrentState([due], new Date("2026-10-24T16:00:00Z"));
    expect(later[0].state).toBe("overdue");
    const same = withCurrentState([due], NOW);
    expect(same[0]).toBe(due);
  });
});

describe("completeLocally", () => {
  it("moves a monthly reminder to the next month", () => {
    const rent = reminder({ id: "rent", startsOn: "2026-01-31", nextDueOn: "2026-10-31", repeatUnit: "month", timeOfDay: "09:00" });
    const next = completeLocally(rent, NOW);
    expect(next.nextDueOn).toBe("2026-11-30");
    expect(next.nextDueAt).toBe("2026-11-30T07:00:00.000Z");
    expect(next.state).toBe("upcoming");
  });

  it("finishes a one-off and drops a snooze", () => {
    const once = reminder({ id: "once", snoozedUntil: "2026-10-25T07:00:00.000Z" });
    const next = completeLocally(once, NOW);
    expect(next).toMatchObject({ nextDueOn: null, nextDueAt: null, snoozedUntil: null, nextNotifyAt: null, state: "done" });
  });

  it("adds a pending completion for the open occurrence", () => {
    expect(pendingCompletion(reminder({ id: "a" }), NOW)).toMatchObject({ reminderId: "a", occurrenceOn: "2026-10-24", doneAt: NOW.toISOString() });
    expect(pendingCompletion(reminder({ id: "b", nextDueOn: null }), NOW)).toBeNull();
  });
});

describe("snoozeLocally", () => {
  it("snoozes an overdue reminder for an hour or until tomorrow 09:00", () => {
    const late = reminder({ id: "late", nextDueOn: "2026-10-22" });
    expect(snoozeLocally(late, { kind: "hour" }, NOW)).toMatchObject({ snoozedUntil: "2026-10-24T10:00:00.000Z", state: "snoozed" });
    // Tomorrow is after the autumn change: 09:00 EET is 07:00 UTC.
    expect(snoozeLocally(late, { kind: "tomorrow" }, NOW).snoozedUntil).toBe("2026-10-25T07:00:00.000Z");
  });
});

describe("doneEntries", () => {
  it("joins completions to their reminders, newest first, skipping deleted reminders", () => {
    const a = reminder({ id: "a" });
    const entries = doneEntries([
      completion("c1", "a", "2026-10-01T08:00:00.000Z"),
      completion("c2", "gone", "2026-10-20T08:00:00.000Z"),
      completion("c3", "a", "2026-10-10T08:00:00.000Z"),
    ], [a]);
    expect(entries.map((entry) => entry.completion.id)).toEqual(["c3", "c1"]);
    expect(entries[0].reminder).toBe(a);
  });
});

describe("upsertReminder", () => {
  it("replaces by id or adds", () => {
    const a = reminder({ id: "a" });
    const renamed = { ...a, title: "Renamed" };
    expect(upsertReminder([a], renamed)).toEqual([renamed]);
    expect(upsertReminder([a], reminder({ id: "b" })).map((item) => item.id)).toEqual(["a", "b"]);
  });
});
