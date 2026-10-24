import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { ASSIGNEE_OUTSIDE_FAMILY_MESSAGE, NO_FAMILY_MESSAGE, PositionTakenError } from "@/lib/todos/repository";
import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { supabaseTodoRepository as todos, translateTodoWriteError } from "@/lib/supabase/repositories/todos";

const familyId = "70000000-0000-4000-8000-000000000161";
const userId = "10000000-0000-4000-8000-000000000161";
const kidUserId = "10000000-0000-4000-8000-000000000162";
const kidMemberId = "60000000-0000-4000-8000-000000000162";
const avatarFile = "90000000-0000-4000-8000-000000000162";

const familyJson = {
  family: { id: familyId, name: "The Smiths", createdAt: "2026-10-01T09:00:00Z" },
  members: [
    {
      memberId: "60000000-0000-4000-8000-000000000161", userId, role: "parent", isCreator: true,
      displayName: "Mum", username: null, currency: "EUR", color: null, avatarPath: null, joinedAt: "2026-10-01T09:00:00Z",
    },
    {
      memberId: kidMemberId, userId: kidUserId, role: "kid", isCreator: false,
      displayName: "Ana", username: "ana", currency: "EUR", color: 3, avatarPath: `${kidUserId}/${avatarFile}.webp`,
      joinedAt: "2026-10-02T09:00:00Z",
    },
  ],
};

let nextId = 1;
function aRow(overrides: Record<string, unknown> = {}) {
  return {
    id: `40000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    family_id: familyId,
    title: "Buy milk",
    notes: "",
    status: "todo",
    position: "a0",
    assignee_member_id: null,
    due_date: null,
    created_by: userId,
    created_at: "2026-10-20T09:00:00Z",
    updated_at: "2026-10-20T09:00:00Z",
    completed_at: null,
    completed_by: null,
    ...overrides,
  };
}

/** `todos` rows behind RLS (the caller's family only), and get_family answering `family` (null: no family). */
function useDatabase(rows: Record<string, unknown>[], options: FakeSupabaseOptions & { family?: unknown } = {}) {
  const { family = familyJson, ...rest } = options;
  const database = fakeSupabase({ todos: rows }, {
    rpc: (fn) => (fn === "get_family" ? { data: family, error: null } : { data: null, error: null }),
    ...rest,
  });
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

describe("Supabase to-do repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    nextId = 1;
  });

  describe("list", () => {
    it("returns open cards and recent Done cards by status then position, with assignees from one get_family", async () => {
      const progress = aRow({ status: "in_progress", position: "a0" });
      const second = aRow({ position: "a1", assignee_member_id: kidMemberId });
      const first = aRow({ position: "Zz" });
      const recent = aRow({ status: "done", position: "a0", completed_at: "2026-10-20T00:00:00Z", completed_by: userId });
      const old = aRow({ status: "done", position: "a1", completed_at: "2026-09-01T00:00:00Z", completed_by: userId });
      const { rpcs, queries } = useDatabase([recent, progress, second, old, first]);

      const listed = await todos.list({ doneSince: "2026-09-24T00:00:00Z" });

      expect(listed.map((todo) => todo.id)).toEqual([first.id, second.id, progress.id, recent.id]);
      expect(listed[1].assignee).toEqual({
        memberId: kidMemberId, name: "Ana", color: 3, avatarUrl: `/api/avatars/${kidUserId}/${avatarFile}`,
      });
      expect(listed[0]).toMatchObject({ assignee: null, title: "Buy milk", status: "todo", createdBy: userId });
      expect(rpcs).toEqual([{ fn: "get_family", args: {} }]);
      expect(queries).toHaveLength(2);
      expect(queries[1].filters).toEqual([["eq", "status", "done"], ["gte", "completed_at", "2026-09-24T00:00:00Z"]]);
    });

    it("refuses a caller without a family with a 404", async () => {
      useDatabase([], { family: null });

      await expect(todos.list({ doneSince: "2026-09-24T00:00:00Z" })).rejects.toMatchObject({
        status: 404, message: NO_FAMILY_MESSAGE,
      });
    });

    it("keeps database failures private", async () => {
      useDatabase([], { fail: () => true });

      await expect(todos.list({ doneSince: "2026-09-24T00:00:00Z" })).rejects.toThrow("Unable to load the to-do board.");
    });
  });

  describe("get", () => {
    it("returns the card, or null when RLS hides it", async () => {
      const row = aRow();
      useDatabase([row]);

      expect(await todos.get(row.id)).toMatchObject({ id: row.id, position: "a0" });
      expect(await todos.get("40000000-0000-4000-8000-000000000999")).toBeNull();
    });
  });

  describe("create", () => {
    const input = { title: "Walk the dog", notes: "", assigneeMemberId: kidMemberId, dueDate: "2026-10-25", status: "todo" as const };

    it("puts the card at the top of its column, in the caller's family, created by the caller", async () => {
      const top = aRow({ position: "a0" });
      const { queries, tables } = useDatabase([top, aRow({ status: "in_progress", position: "Zz" })]);

      const created = await todos.create(userId, input);

      expect(created.position < "a0").toBe(true);
      expect(created).toMatchObject({ title: "Walk the dog", dueDate: "2026-10-25", assignee: { name: "Ana" } });
      expect(queries[0]).toMatchObject({
        operation: "select", filters: [["eq", "family_id", familyId], ["eq", "status", "todo"]], orders: ["position"], limits: ["1"],
      });
      expect(queries[1].values).toEqual({
        family_id: familyId, created_by: userId, title: "Walk the dog", notes: "", status: "todo",
        position: created.position, assignee_member_id: kidMemberId, due_date: "2026-10-25",
      });
      expect(tables.todos).toHaveLength(3);
    });

    it("starts an empty column at the first key", async () => {
      const { queries } = useDatabase([]);

      await todos.create(userId, { ...input, status: "done" });

      expect(queries[1].values).toMatchObject({ position: "a0", status: "done" });
    });

    it("refuses a caller without a family before writing", async () => {
      const { queries } = useDatabase([], { family: null });

      await expect(todos.create(userId, input)).rejects.toMatchObject({ status: 404 });
      expect(queries).toHaveLength(0);
    });

    it("surfaces a racing write on the same slot as PositionTakenError", async () => {
      useDatabase([], { fail: (query) => query.operation === "insert" && { code: "23505", message: "duplicate key" } });

      await expect(todos.create(userId, input)).rejects.toBeInstanceOf(PositionTakenError);
    });

    it("answers an assignee outside the family with a 422", async () => {
      useDatabase([], {
        fail: (query) => query.operation === "insert" &&
          { code: "23514", message: "A to-do can only be assigned to a member of its family." },
      });

      await expect(todos.create(userId, input)).rejects.toMatchObject({
        status: 422, fieldErrors: { assigneeMemberId: [ASSIGNEE_OUTSIDE_FAMILY_MESSAGE] },
      });
    });
  });

  describe("update", () => {
    it("writes only the patched fields and joins the new assignee", async () => {
      const row = aRow();
      const { queries } = useDatabase([row]);

      const updated = await todos.update(row.id, { assigneeMemberId: kidMemberId, notes: "Semi-skimmed" });

      expect(queries[0]).toMatchObject({
        operation: "update", values: { notes: "Semi-skimmed", assignee_member_id: kidMemberId }, filters: [["eq", "id", row.id]],
      });
      expect(updated).toMatchObject({ notes: "Semi-skimmed", assignee: { memberId: kidMemberId, name: "Ana" } });
    });

    it("clears the assignee and due date with null", async () => {
      const row = aRow({ assignee_member_id: kidMemberId, due_date: "2026-10-25" });
      const { queries } = useDatabase([row]);

      const updated = await todos.update(row.id, { assigneeMemberId: null, dueDate: null });

      expect(queries[0].values).toEqual({ assignee_member_id: null, due_date: null });
      expect(updated).toMatchObject({ assignee: null, dueDate: null });
    });

    it("returns null for a card RLS hides", async () => {
      useDatabase([]);

      expect(await todos.update("40000000-0000-4000-8000-000000000999", { title: "New" })).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes the card, and reports a hidden one as missing", async () => {
      const row = aRow();
      const { tables } = useDatabase([row]);

      expect(await todos.delete(row.id)).toBe(true);
      expect(tables.todos).toEqual([]);
      expect(await todos.delete(row.id)).toBe(false);
    });
  });

  describe("getNeighbours", () => {
    it("reports two adjacent cards with their positions", async () => {
      const a = aRow({ position: "a0" });
      const b = aRow({ position: "a1" });
      useDatabase([a, b, aRow({ position: "a2" })]);

      expect(await todos.getNeighbours("todo", a.id, b.id)).toEqual({ before: "a0", after: "a1", adjacent: true });
    });

    it("reports a card between the neighbours, ignoring the moving card", async () => {
      const a = aRow({ position: "a0" });
      const moving = aRow({ position: "a1" });
      const b = aRow({ position: "a2" });
      const c = aRow({ position: "a3" });
      useDatabase([a, moving, b, c]);

      expect(await todos.getNeighbours("todo", a.id, b.id, moving.id)).toMatchObject({ adjacent: true });
      expect(await todos.getNeighbours("todo", a.id, c.id, moving.id)).toMatchObject({ adjacent: false });
    });

    it("checks the top, the bottom and an empty column", async () => {
      const a = aRow({ position: "a0" });
      const b = aRow({ position: "a1" });
      useDatabase([a, b]);

      expect(await todos.getNeighbours("todo", null, a.id)).toEqual({ before: null, after: "a0", adjacent: true });
      expect(await todos.getNeighbours("todo", null, b.id)).toMatchObject({ adjacent: false });
      expect(await todos.getNeighbours("todo", b.id, null)).toEqual({ before: "a1", after: null, adjacent: true });
      expect(await todos.getNeighbours("todo", a.id, null)).toMatchObject({ adjacent: false });
      expect(await todos.getNeighbours("in_progress", null, null)).toEqual({ before: null, after: null, adjacent: true });
      expect(await todos.getNeighbours("todo", null, null)).toMatchObject({ adjacent: false });
      expect(await todos.getNeighbours("todo", null, null, a.id)).toMatchObject({ adjacent: false });
    });

    it("returns null for a neighbour in another column, hidden by RLS, or the moving card itself", async () => {
      const a = aRow({ position: "a0" });
      const moving = aRow({ position: "a1" });
      useDatabase([a, moving]);

      expect(await todos.getNeighbours("done", a.id, null)).toBeNull();
      expect(await todos.getNeighbours("todo", null, "40000000-0000-4000-8000-000000000999")).toBeNull();
      expect(await todos.getNeighbours("todo", moving.id, null, moving.id)).toBeNull();
    });

    it("reports neighbours given out of order as not adjacent", async () => {
      const a = aRow({ position: "a0" });
      const b = aRow({ position: "a1" });
      useDatabase([a, b]);

      expect(await todos.getNeighbours("todo", b.id, a.id)).toEqual({ before: "a1", after: "a0", adjacent: false });
    });
  });

  describe("setPosition", () => {
    it("writes the status and position only", async () => {
      const row = aRow();
      const { queries } = useDatabase([row]);

      const moved = await todos.setPosition(row.id, "in_progress", "a5");

      expect(queries[0]).toMatchObject({ values: { status: "in_progress", position: "a5" }, filters: [["eq", "id", row.id]] });
      expect(moved).toMatchObject({ status: "in_progress", position: "a5" });
    });

    it("surfaces a taken slot as PositionTakenError and a hidden card as null", async () => {
      useDatabase([aRow()], { fail: (query) => query.operation === "update" && { code: "23505", message: "duplicate key" } });
      await expect(todos.setPosition(aRow().id, "todo", "a1")).rejects.toBeInstanceOf(PositionTakenError);

      useDatabase([]);
      expect(await todos.setPosition("40000000-0000-4000-8000-000000000999", "todo", "a1")).toBeNull();
    });
  });

  describe("translateTodoWriteError", () => {
    it("maps the database's codes", () => {
      expect(translateTodoWriteError({ code: "23505", message: "duplicate" }, "fallback")).toBeInstanceOf(PositionTakenError);
      expect(translateTodoWriteError({ code: "23514", message: "A to-do can only be assigned to a member of its family." }, "fallback"))
        .toMatchObject({ status: 422 });
      const check = translateTodoWriteError({ code: "23514", message: "violates check constraint \"todos_title_check\"" }, "fallback");
      expect(check).not.toBeInstanceOf(DomainError);
      expect(check.message).toBe("fallback");
      expect(translateTodoWriteError({ code: "42501", message: "A to-do can't move to another family." }, "fallback"))
        .toMatchObject({ status: 403 });
      expect(translateTodoWriteError({ message: "private" }, "fallback")).not.toBeInstanceOf(DomainError);
    });
  });
});
