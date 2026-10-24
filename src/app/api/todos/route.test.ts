import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute } from "@/test/route";
import { asKid, asLoner, asOutsider, asParent, kidMember, otherFamilyMemberId, parentUser } from "@/test/todo-board";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET, POST } from "@/app/api/todos/route";

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  vi.stubEnv("FAMILY_ENABLED", "true");
  asParent(repositories);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function list(query = "") {
  return callRoute(GET, { url: `/api/todos${query}` });
}

function add(body: unknown) {
  return callRoute(POST, { method: "POST", url: "/api/todos", body });
}

describe("GET /api/todos", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");
    const listSpy = vi.spyOn(repositories.todos, "list");

    const response = await list();

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect(await list()).toMatchObject({ status: 401, body: { error: "Unauthorized" } });
  });

  it("answers 404 to a user with no family", async () => {
    asLoner(repositories);

    expect((await list()).status).toBe(404);
  });

  it("returns the board by status and position, with each assignee's display fields", async () => {
    const progress = repositories.todos.seed({ status: "in_progress", position: "a0" });
    const second = repositories.todos.seed({ position: "a1" });
    const first = repositories.todos.seed({ position: "a0", assigneeMemberId: kidMember.memberId });

    const response = await list();

    expect(response.status).toBe(200);
    expect(response.body.todos.map((todo: { id: string }) => todo.id)).toEqual([first.id, second.id, progress.id]);
    expect(response.body.todos[0].assignee).toEqual({
      memberId: kidMember.memberId,
      name: "Ana",
      color: 3,
      avatarUrl: "/api/avatars/kid/a.webp",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("shows Done cards from the last 30 days by default", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
    const recent = repositories.todos.seed({ status: "done", position: "a0", completedAt: "2026-09-25T00:00:00.000Z" });
    repositories.todos.seed({ status: "done", position: "a1", completedAt: "2026-09-24T11:00:00.000Z" });
    const listSpy = vi.spyOn(repositories.todos, "list");

    const response = await list();

    expect(listSpy).toHaveBeenCalledWith({ doneSince: "2026-09-24T12:00:00.000Z" });
    expect(response.body.todos.map((todo: { id: string }) => todo.id)).toEqual([recent.id]);
  });

  it("shows older Done cards with doneSince, normalised to UTC", async () => {
    const old = repositories.todos.seed({ status: "done", position: "a0", completedAt: "2026-01-01T00:00:00.000Z" });
    const listSpy = vi.spyOn(repositories.todos, "list");

    const response = await list("?doneSince=2025-12-31T02:00:00%2B02:00");

    expect(listSpy).toHaveBeenCalledWith({ doneSince: "2025-12-31T00:00:00.000Z" });
    expect(response.body.todos.map((todo: { id: string }) => todo.id)).toEqual([old.id]);
  });

  it.each(["yesterday", "2026-10-01", ""])("answers 422 to doneSince=%j", async (doneSince) => {
    const response = await list(`?doneSince=${doneSince}`);

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { doneSince: ["Use an ISO timestamp for doneSince."] } } });
  });

  it("never shows another family's cards", async () => {
    repositories.todos.seed({ title: "The Smiths' card" });
    asOutsider(repositories);

    const response = await list();

    expect(response).toMatchObject({ status: 200, body: { todos: [] } });
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.todos, "list").mockRejectedValue(new Error("private database failure"));

    expect(await list()).toMatchObject({ status: 500, body: { error: "Unable to load the to-do board." } });
  });
});

describe("POST /api/todos", () => {
  it("answers 404 without saving while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    expect((await add({ title: "Walk the dog" })).status).toBe(404);
    expect(repositories.todos.rows).toEqual([]);
  });

  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await add({ title: "Walk the dog" })).status).toBe(401);
    expect(repositories.todos.rows).toEqual([]);
  });

  it("answers 404 to a user with no family", async () => {
    asLoner(repositories);

    expect((await add({ title: "Walk the dog" })).status).toBe(404);
    expect(repositories.todos.rows).toEqual([]);
  });

  it("adds a card at the top of To do, created by the caller, with status 201", async () => {
    const existing = repositories.todos.seed({ position: "a0" });

    const response = await add({ title: "  Walk the dog  " });

    expect(response.status).toBe(201);
    expect(response.body.todo).toMatchObject({
      title: "Walk the dog",
      notes: "",
      status: "todo",
      assignee: null,
      dueDate: null,
      createdBy: parentUser.id,
    });
    expect(response.body.todo.position < existing.position).toBe(true);
  });

  it("adds a card to another column, assigned and due, for a kid as well", async () => {
    asKid(repositories);

    const response = await add({
      title: "Tidy room",
      status: "in_progress",
      assigneeMemberId: kidMember.memberId,
      dueDate: "2026-10-30",
    });

    expect(response.status).toBe(201);
    expect(response.body.todo).toMatchObject({
      status: "in_progress",
      dueDate: "2026-10-30",
      assignee: { memberId: kidMember.memberId, name: "Ana" },
    });
  });

  it("answers 422 to an assignee from another family", async () => {
    const response = await add({ title: "Walk the dog", assigneeMemberId: otherFamilyMemberId });

    expect(response).toMatchObject({
      status: 422,
      body: { fieldErrors: { assigneeMemberId: ["A to-do can only be assigned to a member of its family."] } },
    });
    expect(repositories.todos.rows).toEqual([]);
  });

  it("answers 422 to an invalid card", async () => {
    const response = await add({ title: " ", status: "later" });

    expect(response.status).toBe(422);
    expect(Object.keys(response.body.fieldErrors).sort()).toEqual(["status", "title"]);
  });

  it("retries when a racing add took the top spot", async () => {
    repositories.todos.failNextWrite = 2;

    const response = await add({ title: "Walk the dog" });

    expect(response.status).toBe(201);
    expect(repositories.todos.rows).toHaveLength(1);
  });

  it("answers 409 once three attempts have lost the race", async () => {
    repositories.todos.failNextWrite = 3;
    const createSpy = vi.spyOn(repositories.todos, "create");

    const response = await add({ title: "Walk the dog" });

    expect(response).toMatchObject({ status: 409, body: { error: "Another change took that spot on the board. Please try again." } });
    expect(createSpy).toHaveBeenCalledTimes(3);
    expect(repositories.todos.rows).toEqual([]);
  });
});
