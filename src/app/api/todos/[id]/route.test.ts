import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import type { FakeTodoRow } from "@/test/fakes/todos";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute } from "@/test/route";
import {
  asKid,
  asLoner,
  asOutsider,
  asParent,
  kidMember,
  otherFamilyMemberId,
  parentUser,
  secondParentMember,
} from "@/test/todo-board";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { DELETE, PATCH } from "@/app/api/todos/[id]/route";

const missingId = "90000000-0000-4000-8000-000000000404";

let repositories: FakeRepositories;
/** A card the parent (`parentUser`) added. */
let parentCard: FakeTodoRow;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  vi.stubEnv("FAMILY_ENABLED", "true");
  asParent(repositories);
  parentCard = repositories.todos.seed({ title: "Pay the bills", createdBy: parentUser.id });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function edit(id: string, body: unknown) {
  return callRoute(PATCH, { method: "PATCH", body, params: { id } });
}

function remove(id: string) {
  return callRoute(DELETE, { method: "DELETE", params: { id } });
}

describe("PATCH /api/todos/[id]", () => {
  it("answers 404 without saving while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    expect(await edit(parentCard.id, { title: "Changed" })).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(parentCard.title).toBe("Pay the bills");
  });

  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await edit(parentCard.id, { title: "Changed" })).status).toBe(401);
    expect(parentCard.title).toBe("Pay the bills");
  });

  it("edits a card's fields and returns it", async () => {
    const response = await edit(parentCard.id, {
      title: "Pay the gas bill",
      notes: "Before Friday",
      assigneeMemberId: secondParentMember.memberId,
      dueDate: "2026-10-31",
    });

    expect(response).toMatchObject({
      status: 200,
      body: {
        todo: {
          id: parentCard.id,
          title: "Pay the gas bill",
          notes: "Before Friday",
          dueDate: "2026-10-31",
          assignee: { memberId: secondParentMember.memberId, name: "Dana" },
        },
      },
    });
  });

  it("lets a kid edit and assign a parent's card", async () => {
    asKid(repositories);

    const response = await edit(parentCard.id, { title: "Pay the bills with Dad", assigneeMemberId: kidMember.memberId });

    expect(response.status).toBe(200);
    expect(parentCard).toMatchObject({ title: "Pay the bills with Dad", assigneeMemberId: kidMember.memberId });
  });

  it("clears the assignee and due date with null", async () => {
    parentCard.assigneeMemberId = kidMember.memberId;
    parentCard.dueDate = "2026-10-31";

    const response = await edit(parentCard.id, { assigneeMemberId: null, dueDate: null });

    expect(response.body.todo).toMatchObject({ assignee: null, dueDate: null });
  });

  it("answers 422 to an assignee from another family", async () => {
    const response = await edit(parentCard.id, { assigneeMemberId: otherFamilyMemberId });

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { assigneeMemberId: [expect.any(String)] } } });
    expect(parentCard.assigneeMemberId).toBeNull();
  });

  it.each([
    ["an empty change", {}],
    ["a status change, which goes through move", { status: "done" }],
    ["a blank title", { title: "  " }],
  ])("answers 422 to %s", async (_label, body) => {
    expect((await edit(parentCard.id, body)).status).toBe(422);
    expect(parentCard).toMatchObject({ title: "Pay the bills", status: "todo" });
  });

  it("answers 400 to an identifier that isn't a UUID", async () => {
    expect(await edit("not-a-uuid", { title: "Changed" })).toMatchObject({ status: 400, body: { error: "Invalid to-do identifier." } });
  });

  it("answers 404 to a card that doesn't exist", async () => {
    expect(await edit(missingId, { title: "Changed" })).toMatchObject({ status: 404, body: { error: "To-do not found." } });
  });

  it("answers 404 to another family's member", async () => {
    asOutsider(repositories);

    expect((await edit(parentCard.id, { title: "Mine now" })).status).toBe(404);
    expect(parentCard.title).toBe("Pay the bills");
  });

  it("answers 404 to a user with no family", async () => {
    asLoner(repositories);

    expect((await edit(parentCard.id, { title: "Mine now" })).status).toBe(404);
    expect(parentCard.title).toBe("Pay the bills");
  });
});

describe("DELETE /api/todos/[id]", () => {
  it("answers 404 without deleting while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    expect((await remove(parentCard.id)).status).toBe(404);
    expect(repositories.todos.rows).toHaveLength(1);
  });

  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await remove(parentCard.id)).status).toBe(401);
    expect(repositories.todos.rows).toHaveLength(1);
  });

  it("deletes a card", async () => {
    expect(await remove(parentCard.id)).toMatchObject({ status: 200, body: { success: true } });
    expect(repositories.todos.rows).toEqual([]);
  });

  it("lets a kid delete a parent's card", async () => {
    asKid(repositories);

    expect((await remove(parentCard.id)).status).toBe(200);
    expect(repositories.todos.rows).toEqual([]);
  });

  it("answers 404 to a card that doesn't exist", async () => {
    expect(await remove(missingId)).toMatchObject({ status: 404, body: { error: "To-do not found." } });
    expect(repositories.todos.rows).toHaveLength(1);
  });

  it("answers 404 to another family's member", async () => {
    asOutsider(repositories);

    expect((await remove(parentCard.id)).status).toBe(404);
    expect(repositories.todos.rows).toHaveLength(1);
  });

  it("answers 404 to a user with no family", async () => {
    asLoner(repositories);

    expect((await remove(parentCard.id)).status).toBe(404);
    expect(repositories.todos.rows).toHaveLength(1);
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.todos, "delete").mockRejectedValue(new Error("private database failure"));

    expect(await remove(parentCard.id)).toMatchObject({ status: 500, body: { error: "Unable to delete the to-do." } });
  });
});
