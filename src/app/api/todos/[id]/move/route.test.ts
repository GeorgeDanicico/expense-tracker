import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import type { TodoStatus } from "@/lib/todos/types";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import type { FakeTodoRow } from "@/test/fakes/todos";
import { callRoute } from "@/test/route";
import { asKid, asLoner, asOutsider, asParent, kidUser, parentUser } from "@/test/todo-board";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET } from "@/app/api/todos/route";
import { POST } from "@/app/api/todos/[id]/move/route";

const missingId = "90000000-0000-4000-8000-000000000404";
const STALE = "The board changed. Refresh it and try again.";

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  vi.stubEnv("FAMILY_ENABLED", "true");
  asParent(repositories);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type Move = { status: TodoStatus; beforeId: string | null; afterId: string | null };

function move(id: string, body: Move | Record<string, unknown>) {
  return callRoute(POST, { method: "POST", body, params: { id } });
}

/** The ids of a column's cards in board order, hidden ones included. */
function column(status: TodoStatus) {
  return repositories.todos.rows
    .filter((row) => row.status === status)
    .toSorted((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
    .map((row) => row.id);
}

describe("POST /api/todos/[id]/move", () => {
  let card: FakeTodoRow;

  beforeEach(() => {
    card = repositories.todos.seed({ title: "Pay the bills", position: "a0", createdBy: parentUser.id });
  });

  it("answers 404 without moving while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    expect((await move(card.id, { status: "done", beforeId: null, afterId: null })).status).toBe(404);
    expect(card.status).toBe("todo");
  });

  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await move(card.id, { status: "done", beforeId: null, afterId: null })).status).toBe(401);
    expect(card.status).toBe("todo");
  });

  it("moves a card to the top of an empty column", async () => {
    const response = await move(card.id, { status: "in_progress", beforeId: null, afterId: null });

    expect(response).toMatchObject({ status: 200, body: { todo: { id: card.id, status: "in_progress" } } });
    expect(column("in_progress")).toEqual([card.id]);
    expect(column("todo")).toEqual([]);
  });

  it("moves a card between two others in another column", async () => {
    const top = repositories.todos.seed({ status: "in_progress", position: "a0" });
    const bottom = repositories.todos.seed({ status: "in_progress", position: "a1" });

    const response = await move(card.id, { status: "in_progress", beforeId: top.id, afterId: bottom.id });

    expect(response.status).toBe(200);
    expect(column("in_progress")).toEqual([top.id, card.id, bottom.id]);
  });

  it("moves a card to the bottom and to the top of its own column", async () => {
    const second = repositories.todos.seed({ position: "a1" });
    const third = repositories.todos.seed({ position: "a2" });

    expect((await move(card.id, { status: "todo", beforeId: third.id, afterId: null })).status).toBe(200);
    expect(column("todo")).toEqual([second.id, third.id, card.id]);

    expect((await move(card.id, { status: "todo", beforeId: null, afterId: second.id })).status).toBe(200);
    expect(column("todo")).toEqual([card.id, second.id, third.id]);
  });

  it("lets a kid move a parent's card into Done, recording who completed it", async () => {
    asKid(repositories);

    const response = await move(card.id, { status: "done", beforeId: null, afterId: null });

    expect(response.status).toBe(200);
    expect(response.body.todo).toMatchObject({ status: "done", completedBy: kidUser.id, completedAt: expect.any(String) });
  });

  it("drops into Done directly below the visible card above, past hidden older Done cards", async () => {
    const recentTop = repositories.todos.seed({ status: "done", position: "a0", completedAt: new Date().toISOString() });
    const hiddenOld = repositories.todos.seed({ status: "done", position: "a1", completedAt: "2025-01-01T00:00:00.000Z" });
    const recentBottom = repositories.todos.seed({ status: "done", position: "a2", completedAt: new Date().toISOString() });
    // The client's Done column shows only the recent cards, so it anchors between them.
    const board = await callRoute(GET, { url: "/api/todos" });
    expect(board.body.todos.filter((todo: { status: string }) => todo.status === "done").map((todo: { id: string }) => todo.id))
      .toEqual([recentTop.id, recentBottom.id]);

    const response = await move(card.id, { status: "done", beforeId: recentTop.id, afterId: recentBottom.id });

    expect(response.status).toBe(200);
    expect(column("done")).toEqual([recentTop.id, card.id, hiddenOld.id, recentBottom.id]);
  });

  it("drops above the visible card below when there is no card above, past hidden cards", async () => {
    const hiddenOld = repositories.todos.seed({ status: "done", position: "a0", completedAt: "2025-01-01T00:00:00.000Z" });
    const recent = repositories.todos.seed({ status: "done", position: "a1", completedAt: new Date().toISOString() });

    const response = await move(card.id, { status: "done", beforeId: null, afterId: recent.id });

    expect(response.status).toBe(200);
    expect(column("done")).toEqual([hiddenOld.id, card.id, recent.id]);
  });

  it("gives a card dropped where it already sits a key between its neighbours", async () => {
    const above = repositories.todos.seed({ position: "Zz" });
    const below = repositories.todos.seed({ position: "a1" });

    const response = await move(card.id, { status: "todo", beforeId: above.id, afterId: below.id });

    expect(response.status).toBe(200);
    expect(column("todo")).toEqual([above.id, card.id, below.id]);
  });

  it("answers 409 to an anchor that was deleted", async () => {
    const response = await move(card.id, { status: "in_progress", beforeId: missingId, afterId: null });

    expect(response).toMatchObject({ status: 409, body: { error: STALE } });
    expect(card).toMatchObject({ status: "todo", position: "a0" });
  });

  it("answers 409 to an anchor that moved to another column", async () => {
    const anchor = repositories.todos.seed({ status: "done", position: "a0" });

    const response = await move(card.id, { status: "in_progress", beforeId: null, afterId: anchor.id });

    expect(response).toMatchObject({ status: 409, body: { error: STALE } });
    expect(card.status).toBe("todo");
  });

  it("answers 409 to an anchor from another family", async () => {
    const foreign = repositories.todos.seed({ familyId: "70000000-0000-4000-8000-000000000999", status: "in_progress" });

    expect((await move(card.id, { status: "in_progress", beforeId: foreign.id, afterId: null })).status).toBe(409);
  });

  it("answers 409 when the card is its own anchor", async () => {
    expect((await move(card.id, { status: "todo", beforeId: card.id, afterId: null })).status).toBe(409);
  });

  it("answers 422 to an invalid move", async () => {
    const response = await move(card.id, { status: "later", beforeId: "nope" });

    expect(response.status).toBe(422);
    expect(Object.keys(response.body.fieldErrors).sort()).toEqual(["afterId", "beforeId", "status"]);
  });

  it("answers 400 to an identifier that isn't a UUID", async () => {
    expect((await move("not-a-uuid", { status: "done", beforeId: null, afterId: null })).status).toBe(400);
  });

  it("answers 404 to a card that doesn't exist", async () => {
    expect(await move(missingId, { status: "done", beforeId: null, afterId: null }))
      .toMatchObject({ status: 404, body: { error: "To-do not found." } });
  });

  it("answers 404 to another family's member", async () => {
    asOutsider(repositories);

    expect((await move(card.id, { status: "done", beforeId: null, afterId: null })).status).toBe(404);
    expect(card.status).toBe("todo");
  });

  it("answers 404 to a user with no family", async () => {
    asLoner(repositories);

    expect((await move(card.id, { status: "done", beforeId: null, afterId: null })).status).toBe(404);
    expect(card.status).toBe("todo");
  });

  describe("racing moves", () => {
    let top: FakeTodoRow;
    let bottom: FakeTodoRow;
    let other: FakeTodoRow;

    beforeEach(() => {
      top = repositories.todos.seed({ status: "in_progress", position: "a0" });
      bottom = repositories.todos.seed({ status: "in_progress", position: "a1" });
      other = repositories.todos.seed({ title: "Walk the dog", position: "a1" });
    });

    it("retries a move that lost the slot to a racing move, and both end up ordered", async () => {
      const slotSpy = vi.spyOn(repositories.todos, "slotNear");
      const anchors = { status: "in_progress", beforeId: top.id, afterId: bottom.id } as const;

      expect((await move(card.id, anchors)).status).toBe(200);
      // The racing write wins first: this move's first setPosition fails as if its key was taken.
      repositories.todos.failNextWrite = 1;
      const response = await move(other.id, anchors);

      expect(response.status).toBe(200);
      expect(slotSpy).toHaveBeenCalledTimes(3);
      expect(column("in_progress")).toEqual([top.id, other.id, card.id, bottom.id]);
      expect(new Set(column("in_progress").map((id) => repositories.todos.rows.find((row) => row.id === id)?.position)).size).toBe(4);
    });

    it("orders two concurrent moves into the same slot", async () => {
      const slotSpy = vi.spyOn(repositories.todos, "slotNear");
      const anchors = { status: "in_progress", beforeId: top.id, afterId: bottom.id } as const;

      const responses = await Promise.all([move(card.id, anchors), move(other.id, anchors)]);

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const order = column("in_progress");
      expect(order[0]).toBe(top.id);
      expect(order[3]).toBe(bottom.id);
      expect(order.slice(1, 3).sort()).toEqual([card.id, other.id].sort());
      // Both looked up the same slot before either wrote, so the loser looked it up again.
      expect(slotSpy).toHaveBeenCalledTimes(3);
    });

    it("answers 409 once three attempts have lost the race", async () => {
      repositories.todos.failNextWrite = 3;
      const setSpy = vi.spyOn(repositories.todos, "setPosition");

      const response = await move(card.id, { status: "in_progress", beforeId: top.id, afterId: bottom.id });

      expect(response).toMatchObject({ status: 409, body: { error: "Another change took that spot on the board. Please try again." } });
      expect(setSpy).toHaveBeenCalledTimes(3);
      expect(card.status).toBe("todo");
    });
  });
});
