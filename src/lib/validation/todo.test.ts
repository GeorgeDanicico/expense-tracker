import { describe, expect, it } from "vitest";

import { moveSchema, todoPatchSchema, todoSchema } from "@/lib/validation/todo";

const MEMBER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("todoSchema", () => {
  it("trims text and fills defaults", () => {
    expect(todoSchema.parse({ title: "  Buy milk  ", notes: "  2 litres \n" })).toEqual({
      title: "Buy milk", notes: "2 litres", assigneeMemberId: null, dueDate: null, status: "todo",
    });
  });

  it("accepts an assignee, a due date and a status", () => {
    expect(todoSchema.parse({
      title: "Pay rent", assigneeMemberId: MEMBER, dueDate: "2026-11-01", status: "in_progress",
    })).toEqual({ title: "Pay rent", notes: "", assigneeMemberId: MEMBER, dueDate: "2026-11-01", status: "in_progress" });
  });

  it("accepts the length limits", () => {
    expect(todoSchema.safeParse({ title: "x".repeat(200), notes: "y".repeat(2000) }).success).toBe(true);
  });

  it.each([
    {},
    { title: "   " },
    { title: "x".repeat(201) },
    { title: "Ok", notes: "y".repeat(2001) },
    { title: "Ok", assigneeMemberId: "ana" },
    { title: "Ok", dueDate: "2026-02-30" },
    { title: "Ok", dueDate: "24/10/2026" },
    { title: "Ok", status: "archived" },
  ])("rejects %j", (input) => {
    expect(todoSchema.safeParse(input).success).toBe(false);
  });
});

describe("todoPatchSchema", () => {
  it("accepts any subset of fields, trimmed", () => {
    expect(todoPatchSchema.parse({ title: " New " })).toEqual({ title: "New" });
    expect(todoPatchSchema.parse({ assigneeMemberId: null, dueDate: null }))
      .toEqual({ assigneeMemberId: null, dueDate: null });
  });

  it.each([
    {},
    { title: " " },
    { status: "done" },
    { position: "a0" },
    { notes: "y".repeat(2001) },
  ])("rejects %j", (input) => {
    expect(todoPatchSchema.safeParse(input).success).toBe(false);
  });
});

describe("moveSchema", () => {
  it.each([
    { status: "todo", beforeId: null, afterId: null },
    { status: "in_progress", beforeId: MEMBER, afterId: null },
    { status: "done", beforeId: null, afterId: MEMBER },
    { status: "done", beforeId: MEMBER, afterId: OTHER },
  ])("accepts %j", (input) => {
    expect(moveSchema.parse(input)).toEqual(input);
  });

  it.each([
    { status: "todo" },
    { status: "later", beforeId: null, afterId: null },
    { status: "todo", beforeId: "a0", afterId: null },
    { status: "todo", beforeId: MEMBER, afterId: MEMBER },
  ])("rejects %j", (input) => {
    expect(moveSchema.safeParse(input).success).toBe(false);
  });
});
