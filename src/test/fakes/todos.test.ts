import { beforeEach, describe, expect, it } from "vitest";

import { PositionTakenError } from "@/lib/todos/repository";
import { aFamily, aFamilyMember, aParent } from "@/test/builders";

import { FakeFamilyRepository } from "./family";
import { FakeTodoRepository } from "./todos";

const otherFamilyId = "70000000-0000-4000-8000-000000000999";
const kid = aFamilyMember({ displayName: "Ana", color: 3, avatarUrl: "/api/avatars/a/b" });
const input = { title: "Walk the dog", notes: "", assigneeMemberId: null, dueDate: null, status: "todo" as const };

describe("FakeTodoRepository", () => {
  let family: FakeFamilyRepository;
  let todos: FakeTodoRepository;

  beforeEach(() => {
    family = new FakeFamilyRepository();
    family.membership = aParent();
    family.family = { ...aFamily(), members: [...aFamily().members, kid] };
    todos = new FakeTodoRepository(family);
  });

  it("adds cards at the top of their column, created by the caller, with the assignee joined", async () => {
    const first = await todos.create("user-1", input);
    const second = await todos.create("user-1", { ...input, assigneeMemberId: kid.memberId });

    expect(second.position < first.position).toBe(true);
    expect(second).toMatchObject({
      createdBy: "user-1",
      assignee: { memberId: kid.memberId, name: "Ana", color: 3, avatarUrl: "/api/avatars/a/b" },
    });
    expect(todos.rows.every((row) => row.familyId === aParent().familyId)).toBe(true);
  });

  it("lists only the caller's family, by status then position, with Done limited to doneSince", async () => {
    const progress = todos.seed({ status: "in_progress", position: "a0" });
    const bottom = todos.seed({ position: "a1" });
    const top = todos.seed({ position: "a0" });
    const recent = todos.seed({ status: "done", position: "a0", completedAt: "2026-10-20T00:00:00Z" });
    todos.seed({ status: "done", position: "a1", completedAt: "2026-09-01T00:00:00Z" });
    todos.seed({ familyId: otherFamilyId, position: "Zz" });

    const listed = await todos.list({ doneSince: "2026-09-24T00:00:00Z" });

    expect(listed.map((todo) => todo.id)).toEqual([top.id, bottom.id, progress.id, recent.id]);
  });

  it("treats another family's card as missing", async () => {
    const foreign = todos.seed({ familyId: otherFamilyId });

    expect(await todos.get(foreign.id)).toBeNull();
    expect(await todos.update(foreign.id, { title: "Mine now" })).toBeNull();
    expect(await todos.setPosition(foreign.id, "done", "a5")).toBeNull();
    expect(await todos.delete(foreign.id)).toBe(false);
    expect(todos.rows).toHaveLength(1);
  });

  it("refuses a caller without a family", async () => {
    family.membership = null;

    await expect(todos.list({ doneSince: "2026-09-24T00:00:00Z" })).rejects.toMatchObject({ status: 404 });
    await expect(todos.create("user-1", input)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses an assignee outside the family with a 422", async () => {
    const card = todos.seed();

    await expect(todos.create("user-1", { ...input, assigneeMemberId: "60000000-0000-4000-8000-000000000999" }))
      .rejects.toMatchObject({ status: 422 });
    await expect(todos.update(card.id, { assigneeMemberId: "60000000-0000-4000-8000-000000000999" }))
      .rejects.toMatchObject({ status: 422 });
    expect(await todos.update(card.id, { assigneeMemberId: kid.memberId, notes: "Today" }))
      .toMatchObject({ notes: "Today", assignee: { name: "Ana" } });
  });

  it("keeps positions unique within a column and family", async () => {
    const a = todos.seed({ position: "a0" });
    const b = todos.seed({ position: "a1" });
    todos.seed({ familyId: otherFamilyId, status: "in_progress", position: "a2" });

    await expect(todos.setPosition(b.id, "todo", "a0")).rejects.toBeInstanceOf(PositionTakenError);
    expect(await todos.setPosition(a.id, "todo", "a0")).toMatchObject({ position: "a0" });
    expect(await todos.setPosition(b.id, "in_progress", "a2")).toMatchObject({ status: "in_progress", position: "a2" });
  });

  it("fails the next writes on request, to test retries", async () => {
    todos.failNextWrite = 1;

    await expect(todos.create("user-1", input)).rejects.toBeInstanceOf(PositionTakenError);
    await expect(todos.create("user-1", input)).resolves.toMatchObject({ title: "Walk the dog" });
  });

  it("sets and clears completedAt and completedBy as a card enters and leaves Done", async () => {
    const card = todos.seed();

    const done = await todos.setPosition(card.id, "done", "a0");
    expect(done).toMatchObject({ completedBy: family.caller.userId });
    expect(done?.completedAt).not.toBeNull();

    expect(await todos.setPosition(card.id, "todo", "a0")).toMatchObject({ completedAt: null, completedBy: null });
  });

  it("finds adjacent neighbours, ignoring the moving card and other families", async () => {
    const a = todos.seed({ position: "a0" });
    const moving = todos.seed({ position: "a1" });
    const b = todos.seed({ position: "a2" });
    todos.seed({ familyId: otherFamilyId, position: "a3" });
    const c = todos.seed({ position: "a4" });

    expect(await todos.getNeighbours("todo", a.id, b.id, moving.id)).toEqual({ before: "a0", after: "a2", adjacent: true });
    expect(await todos.getNeighbours("todo", a.id, b.id)).toMatchObject({ adjacent: false });
    expect(await todos.getNeighbours("todo", b.id, c.id)).toMatchObject({ adjacent: true });
    expect(await todos.getNeighbours("todo", c.id, null)).toEqual({ before: "a4", after: null, adjacent: true });
    expect(await todos.getNeighbours("todo", null, a.id)).toMatchObject({ adjacent: true });
    expect(await todos.getNeighbours("in_progress", null, null)).toMatchObject({ adjacent: true });
    expect(await todos.getNeighbours("todo", null, null)).toMatchObject({ adjacent: false });
    expect(await todos.getNeighbours("todo", b.id, a.id)).toMatchObject({ adjacent: false });
  });

  it("returns null for a neighbour that is missing, foreign, in another column or the moving card", async () => {
    const a = todos.seed({ position: "a0" });
    const foreign = todos.seed({ familyId: otherFamilyId, position: "a1" });

    expect(await todos.getNeighbours("done", a.id, null)).toBeNull();
    expect(await todos.getNeighbours("todo", foreign.id, null)).toBeNull();
    expect(await todos.getNeighbours("todo", null, "missing")).toBeNull();
    expect(await todos.getNeighbours("todo", a.id, null, a.id)).toBeNull();
  });
});
