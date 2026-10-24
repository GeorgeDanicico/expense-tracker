import { describe, expect, it } from "vitest";

import { DEFAULT_TODO_FILTERS, filterTodos, isDueToday, isOverdue, matchesAssignee } from "@/lib/todos/filters";
import type { Todo, TodoStatus } from "@/lib/todos/types";

const ME = "11111111-1111-4111-8111-111111111111";
const ANA = "22222222-2222-4222-8222-222222222222";

function todo(id: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id, title: id, notes: "", status: "todo", position: "a0", assignee: null, dueDate: null,
    createdBy: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    completedAt: null, completedBy: null, ...overrides,
  };
}

const assigned = (memberId: string) => ({ memberId, name: null, color: null, avatarUrl: null });

// 2026-10-24 22:30 UTC is already 2026-10-25 in Bucharest (UTC+3 in summer time).
const LATE_EVENING_UTC = new Date("2026-10-24T22:30:00Z");
// 2026-10-24 12:00 UTC is 2026-10-24 in Bucharest.
const NOON_UTC = new Date("2026-10-24T12:00:00Z");

describe("assignee filter", () => {
  const mine = todo("mine", { assignee: assigned(ME) });
  const anas = todo("anas", { assignee: assigned(ANA) });
  const nobodys = todo("nobodys");

  it("shows everyone's cards", () => {
    expect([mine, anas, nobodys].every((card) => matchesAssignee(card, "all", ME))).toBe(true);
  });

  it("resolves me to the caller's member id", () => {
    expect([mine, anas, nobodys].filter((card) => matchesAssignee(card, "me", ME))).toEqual([mine]);
    expect([mine, anas, nobodys].filter((card) => matchesAssignee(card, "me", ANA))).toEqual([anas]);
  });

  it("matches nothing for me without a member id", () => {
    expect([mine, anas, nobodys].some((card) => matchesAssignee(card, "me", null))).toBe(false);
  });

  it("filters by a member id", () => {
    expect([mine, anas, nobodys].filter((card) => matchesAssignee(card, ANA, ME))).toEqual([anas]);
  });

  it("shows unassigned cards", () => {
    expect([mine, anas, nobodys].filter((card) => matchesAssignee(card, "unassigned", ME))).toEqual([nobodys]);
  });
});

describe("due filters", () => {
  it("uses the Bucharest date for today", () => {
    expect(isDueToday(todo("a", { dueDate: "2026-10-24" }), NOON_UTC)).toBe(true);
    expect(isDueToday(todo("a", { dueDate: "2026-10-24" }), LATE_EVENING_UTC)).toBe(false);
    expect(isDueToday(todo("a", { dueDate: "2026-10-25" }), LATE_EVENING_UTC)).toBe(true);
  });

  it("counts done cards due today", () => {
    expect(isDueToday(todo("a", { dueDate: "2026-10-24", status: "done" }), NOON_UTC)).toBe(true);
  });

  it("never matches a card without a due date", () => {
    expect(isDueToday(todo("a"), NOON_UTC)).toBe(false);
    expect(isOverdue(todo("a"), NOON_UTC)).toBe(false);
  });

  it.each<[TodoStatus, string, boolean]>([
    ["todo", "2026-10-23", true],
    ["in_progress", "2026-10-01", true],
    ["done", "2026-10-23", false],
    ["todo", "2026-10-24", false],
    ["todo", "2026-10-25", false],
  ])("overdue: %s due %s is %s", (status, dueDate, expected) => {
    expect(isOverdue(todo("a", { status, dueDate }), NOON_UTC)).toBe(expected);
  });

  it("uses the Bucharest date for overdue", () => {
    expect(isOverdue(todo("a", { dueDate: "2026-10-24" }), LATE_EVENING_UTC)).toBe(true);
  });
});

describe("filterTodos", () => {
  const cards = [
    todo("mine-overdue", { assignee: assigned(ME), dueDate: "2026-10-20" }),
    todo("mine-today", { assignee: assigned(ME), dueDate: "2026-10-24" }),
    todo("anas-overdue", { assignee: assigned(ANA), dueDate: "2026-10-20" }),
    todo("nobodys-today", { dueDate: "2026-10-24" }),
    todo("mine-done", { assignee: assigned(ME), dueDate: "2026-10-20", status: "done" }),
  ];
  const ids = (list: Todo[]) => list.map((card) => card.id);

  it("returns every card by default, in order", () => {
    expect(filterTodos(cards, DEFAULT_TODO_FILTERS, ME, NOON_UTC)).toEqual(cards);
  });

  it("combines the assignee and due filters", () => {
    expect(ids(filterTodos(cards, { assignee: "me", due: "overdue" }, ME, NOON_UTC))).toEqual(["mine-overdue"]);
    expect(ids(filterTodos(cards, { assignee: "me", due: "today" }, ME, NOON_UTC))).toEqual(["mine-today"]);
    expect(ids(filterTodos(cards, { assignee: "unassigned", due: "today" }, ME, NOON_UTC))).toEqual(["nobodys-today"]);
    expect(ids(filterTodos(cards, { assignee: "all", due: "overdue" }, ME, NOON_UTC)))
      .toEqual(["mine-overdue", "anas-overdue"]);
    expect(ids(filterTodos(cards, { assignee: ANA, due: "any" }, ME, NOON_UTC))).toEqual(["anas-overdue"]);
  });
});
