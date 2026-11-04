import { describe, expect, it } from "vitest";

import type { DashboardData } from "@/lib/expenses/types";
import { dueReminders, greeting, monthSoFar, openTodosFor, relativeDay, todayLabel } from "@/lib/home/today";
import type { ListedReminder } from "@/lib/reminders/list";
import type { Todo } from "@/lib/todos/types";

// 4 Nov 2026, 11:00 in Bucharest (UTC+2).
const NOW = new Date("2026-11-04T09:00:00Z");

const reminder = (id: string, state: ListedReminder["state"], nextDueOn: string, timeOfDay = "09:00"): ListedReminder => ({
  id, title: id, notes: "", startsOn: nextDueOn, timeOfDay, timezone: "Europe/Bucharest", repeatUnit: "none", repeatInterval: 1,
  leadMinutes: [0], notificationsMuted: false, nextDueOn, nextDueAt: `${nextDueOn}T07:00:00.000Z`, snoozedUntil: null, nextNotifyAt: null,
  expenseTemplate: null, createdAt: "", updatedAt: "", state,
});

describe("the greeting and the date", () => {
  it("follows the app's clock", () => {
    expect(greeting(new Date("2026-11-04T03:00:00Z"))).toBe("Good morning");
    expect(greeting(NOW)).toBe("Good morning");
    expect(greeting(new Date("2026-11-04T10:00:00Z"))).toBe("Good afternoon");
    expect(greeting(new Date("2026-11-04T17:00:00Z"))).toBe("Good evening");
    // 01:00 in Bucharest: still the evening before.
    expect(greeting(new Date("2026-11-03T23:00:00Z"))).toBe("Good evening");
  });

  it("names today's date on the app's calendar", () => {
    expect(todayLabel(NOW)).toBe("Wednesday 4 November");
    // 23:30 UTC is already tomorrow in Bucharest.
    expect(todayLabel(new Date("2026-11-04T23:30:00Z"))).toBe("Thursday 5 November");
  });

  it("dates a day as Today, Yesterday or by weekday", () => {
    expect(relativeDay("2026-11-04", NOW)).toBe("Today");
    expect(relativeDay("2026-11-03", NOW)).toBe("Yesterday");
    expect(relativeDay("2026-11-02", NOW)).toBe("Mon 2 Nov");
  });
});

describe("dueReminders", () => {
  const late = reminder("late", "overdue", "2026-11-01");
  const later = reminder("later", "overdue", "2026-11-03");
  const today = reminder("today", "due", "2026-11-04");
  const soon = reminder("soon", "upcoming", "2026-11-06");
  const snoozed = reminder("snoozed", "snoozed", "2026-11-03");

  it("lists overdue ones, the most late first, then those due today", () => {
    expect(dueReminders([today, later, soon, late]).shown.map((item) => item.id)).toEqual(["late", "later", "today"]);
  });

  it("leaves upcoming and snoozed reminders out, and names the next one that is upcoming", () => {
    const { shown, next } = dueReminders([snoozed, soon]);
    expect(shown).toEqual([]);
    expect(next?.id).toBe("soon");
  });

  it("shows three and counts the rest", () => {
    const four = dueReminders([late, later, today, reminder("also", "due", "2026-11-04")]);
    expect(four.shown).toHaveLength(3);
    expect(four.more).toBe(1);
    expect(dueReminders([late]).more).toBe(0);
  });

  it("has nothing to show or name without reminders", () => {
    expect(dueReminders([])).toEqual({ shown: [], more: 0, next: null });
  });
});

describe("monthSoFar", () => {
  const dashboard = (currentTotal: number, series: { key: string; total: number }[]): Pick<DashboardData, "currentMonth" | "currentTotal" | "analytics"> => ({
    currentMonth: "2026-11",
    currentTotal,
    analytics: { label: "", total: 0, count: 0, monthlyAverage: 0, topCategory: "", categoryTotals: [], series: series.map((point) => ({ ...point, label: "" })) },
  });
  const series = [{ key: "2026-09", total: 2215.75 }, { key: "2026-10", total: 1000 }];

  it("measures this month against the whole of last month", () => {
    expect(monthSoFar(dashboard(250, series))).toMatchObject({ previousMonth: "2026-10", previousTotal: 1000, share: 0.25, over: 0 });
  });

  it("caps the meter and reports how far over last month this month is", () => {
    expect(monthSoFar(dashboard(1300, series))).toMatchObject({ share: 1, over: 300 });
  });

  it("has no baseline when last month is missing or empty", () => {
    expect(monthSoFar(dashboard(80, [{ key: "2026-09", total: 5 }]))).toMatchObject({ previousTotal: 0, share: 0, over: 0 });
    expect(monthSoFar(dashboard(80, [{ key: "2026-10", total: 0 }]))).toMatchObject({ previousTotal: 0, share: 0, over: 0 });
  });
});

describe("openTodosFor", () => {
  const todo = (id: string, memberId: string | null, status: Todo["status"], dueDate: string | null, position = id): Todo => ({
    id, title: id, notes: "", status, position, dueDate, createdBy: null, createdAt: "", updatedAt: "", completedAt: null, completedBy: null,
    assignee: memberId ? { memberId, name: memberId, color: null, avatarUrl: null } : null,
  });

  it("keeps the member's open cards, nearest due date first and undated last", () => {
    const todos = [
      todo("undated", "me", "todo", null),
      todo("later", "me", "in_progress", "2026-11-20"),
      todo("done", "me", "done", "2026-11-01"),
      todo("theirs", "you", "todo", "2026-11-02"),
      todo("nobody", null, "todo", "2026-11-02"),
      todo("soon", "me", "todo", "2026-11-05"),
    ];
    expect(openTodosFor(todos, "me").shown.map((item) => item.id)).toEqual(["soon", "later", "undated"]);
  });

  it("shows three and counts the rest", () => {
    const todos = ["a", "b", "c", "d", "e"].map((id) => todo(id, "me", "todo", null));
    expect(openTodosFor(todos, "me")).toMatchObject({ shown: expect.any(Array), more: 2 });
    expect(openTodosFor(todos, "me").shown).toHaveLength(3);
  });
});
