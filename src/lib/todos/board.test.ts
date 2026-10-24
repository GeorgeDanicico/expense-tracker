import { describe, expect, it } from "vitest";

import {
  applyMove,
  columnOf,
  columnsOf,
  groupTodos,
  isSamePlace,
  moveFor,
  movedAnnouncement,
  moveWithin,
  overAnnouncement,
  upsertTodo,
  type BoardColumns,
} from "@/lib/todos/board";
import type { Todo, TodoStatus } from "@/lib/todos/types";

function card(id: string, status: TodoStatus, position: string, title = id): Todo {
  return {
    id, title, notes: "", status, position, assignee: null, dueDate: null,
    createdBy: null, createdAt: "", updatedAt: "", completedAt: null, completedBy: null,
  };
}

// Keys from fractional-indexing: a0 < a1 < a2 < a3.
const TODOS = [
  card("c", "todo", "a2"),
  card("a", "todo", "a0", "Buy milk"),
  card("b", "todo", "a1"),
  card("x", "in_progress", "a0"),
  card("y", "in_progress", "a1"),
];

const COLUMNS: BoardColumns = { todo: ["a", "b", "c"], in_progress: ["x", "y"], done: [] };

describe("grouping", () => {
  it("sorts each column by position byte by byte", () => {
    expect(columnsOf(TODOS)).toEqual(COLUMNS);
    // "Z" sorts before "a" byte by byte, though localeCompare would put it after.
    const groups = groupTodos([card("lower", "done", "a0"), card("upper", "done", "Zz")]);
    expect(groups.done.map((todo) => todo.id)).toEqual(["upper", "lower"]);
  });

  it("finds the column of a card or of a column id", () => {
    expect(columnOf(COLUMNS, "y")).toBe("in_progress");
    expect(columnOf(COLUMNS, "done")).toBe("done");
    expect(columnOf(COLUMNS, "missing")).toBeNull();
  });
});

describe("moveWithin", () => {
  it("reorders within a column like arrayMove", () => {
    expect(moveWithin(COLUMNS, "a", "c").todo).toEqual(["b", "c", "a"]);
    expect(moveWithin(COLUMNS, "c", "a").todo).toEqual(["c", "a", "b"]);
  });

  it("moves into another column above or below the card it's over", () => {
    expect(moveWithin(COLUMNS, "b", "y")).toEqual({ todo: ["a", "c"], in_progress: ["x", "b", "y"], done: [] });
    expect(moveWithin(COLUMNS, "b", "y", true).in_progress).toEqual(["x", "y", "b"]);
  });

  it("moves to the end of a column dropped on the column itself, empty or not", () => {
    expect(moveWithin(COLUMNS, "a", "done").done).toEqual(["a"]);
    expect(moveWithin(COLUMNS, "a", "in_progress").in_progress).toEqual(["x", "y", "a"]);
  });

  it("returns the same columns when nothing moves", () => {
    expect(moveWithin(COLUMNS, "a", "a")).toBe(COLUMNS);
    expect(moveWithin(COLUMNS, "missing", "a")).toBe(COLUMNS);
    expect(moveWithin(COLUMNS, "c", "todo")).toBe(COLUMNS);
  });
});

describe("moveFor", () => {
  it("names the visible cards above and below", () => {
    expect(moveFor(COLUMNS, "b")).toEqual({ status: "todo", beforeId: "a", afterId: "c" });
  });

  it("uses null at the top, the bottom and in an empty column", () => {
    expect(moveFor(COLUMNS, "a")).toEqual({ status: "todo", beforeId: null, afterId: "b" });
    expect(moveFor(COLUMNS, "y")).toEqual({ status: "in_progress", beforeId: "x", afterId: null });
    expect(moveFor(moveWithin(COLUMNS, "a", "done"), "a")).toEqual({ status: "done", beforeId: null, afterId: null });
  });

  it("is null for a card that isn't on the board", () => {
    expect(moveFor(COLUMNS, "missing")).toBeNull();
  });

  it("knows a drop where the card already sits", () => {
    expect(isSamePlace(COLUMNS, "b", { status: "todo", beforeId: "a", afterId: "c" })).toBe(true);
    expect(isSamePlace(COLUMNS, "b", moveFor(moveWithin(COLUMNS, "b", "c"), "b")!)).toBe(false);
  });
});

describe("applyMove (the optimistic board)", () => {
  const order = (todos: Todo[], status: TodoStatus) => columnsOf(todos)[status];

  it("puts the card between its new neighbours in another column", () => {
    const next = applyMove(TODOS, "b", { status: "in_progress", beforeId: "x", afterId: "y" });
    expect(order(next, "in_progress")).toEqual(["x", "b", "y"]);
    expect(order(next, "todo")).toEqual(["a", "c"]);
  });

  it("puts the card at the top or bottom of a column", () => {
    expect(order(applyMove(TODOS, "c", { status: "todo", beforeId: null, afterId: "a" }), "todo")).toEqual(["c", "a", "b"]);
    expect(order(applyMove(TODOS, "a", { status: "todo", beforeId: "c", afterId: null }), "todo")).toEqual(["b", "c", "a"]);
    expect(order(applyMove(TODOS, "a", { status: "done", beforeId: null, afterId: null }), "done")).toEqual(["a"]);
  });

  it("anchors on the card above like the server: directly below it, before the next card", () => {
    // Only `beforeId` given while the column has a card below it.
    const next = applyMove(TODOS, "x", { status: "todo", beforeId: "a", afterId: null });
    expect(order(next, "todo")).toEqual(["a", "x", "b", "c"]);
  });

  it("anchors on the card below when there's none above", () => {
    const next = applyMove(TODOS, "x", { status: "todo", beforeId: null, afterId: "c" });
    expect(order(next, "todo")).toEqual(["a", "b", "x", "c"]);
  });

  it("leaves the board alone when an anchor is gone", () => {
    const next = applyMove(TODOS, "a", { status: "todo", beforeId: "gone", afterId: null });
    expect(next).toEqual(TODOS);
    expect(next).not.toBe(TODOS);
  });

  it("doesn't mutate the list it's given", () => {
    const copy = structuredClone(TODOS);
    applyMove(TODOS, "b", { status: "done", beforeId: null, afterId: null });
    expect(TODOS).toEqual(copy);
  });
});

describe("upsertTodo", () => {
  it("replaces a card by id or adds a new one", () => {
    const renamed = { ...TODOS[0], title: "Renamed" };
    expect(upsertTodo(TODOS, renamed).find((todo) => todo.id === "c")?.title).toBe("Renamed");
    expect(upsertTodo(TODOS, card("n", "todo", "Zz"))).toHaveLength(TODOS.length + 1);
  });
});

describe("announcements", () => {
  it("say where the card landed", () => {
    const columns = moveWithin(COLUMNS, "a", "y");
    expect(movedAnnouncement("Buy milk", columns, "a")).toBe("Moved Buy milk to In progress, position 2 of 3.");
    expect(overAnnouncement("Buy milk", columns, "a")).toBe("Buy milk is in In progress, position 2 of 3.");
  });
});
