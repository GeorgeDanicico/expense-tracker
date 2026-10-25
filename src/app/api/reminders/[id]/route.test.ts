import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import type { FakeReminderRow } from "@/test/fakes/reminders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute } from "@/test/route";
import { asKid, asOutsider, asParent, kidUser } from "@/test/todo-board";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { DELETE, PATCH } from "@/app/api/reminders/[id]/route";

const missingId = "90000000-0000-4000-8000-000000000404";
const edited = { title: "Pay the rent", startsOn: "2026-11-05", timeOfDay: "18:00", repeatUnit: "month" };

let repositories: FakeRepositories;
/** A reminder of the kid (`kidUser`), who is signed in. */
let reminder: FakeReminderRow;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  asKid(repositories);
  repositories.reminders.callerId = kidUser.id;
  reminder = repositories.reminders.seed();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Signs in someone other than the owner: another family's parent, or the owner's own parent. */
const strangers = [
  ["another user", (repos: FakeRepositories) => asOutsider(repos)],
  ["a parent of the owner", (repos: FakeRepositories) => asParent(repos)],
] as const;

function signInStranger(signIn: (repos: FakeRepositories) => { id: string }) {
  repositories.reminders.callerId = signIn(repositories).id;
}

function edit(id: string, body: unknown) {
  return callRoute(PATCH, { method: "PATCH", body, params: { id } });
}

function remove(id: string) {
  return callRoute(DELETE, { method: "DELETE", params: { id } });
}

describe("PATCH /api/reminders/[id]", () => {
  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await edit(reminder.id, edited)).status).toBe(401);
    expect(reminder.title).toBe("Pay rent");
  });

  it("replaces the reminder's fields and works its dates out again", async () => {
    const response = await edit(reminder.id, edited);

    expect(response).toMatchObject({
      status: 200,
      body: {
        reminder: {
          id: reminder.id,
          title: "Pay the rent",
          timeOfDay: "18:00",
          repeatUnit: "month",
          nextDueOn: "2026-11-05",
          nextDueAt: "2026-11-05T16:00:00.000Z",
          state: "upcoming",
        },
      },
    });
    expect(reminder).toMatchObject({ title: "Pay the rent", nextDueOn: "2026-11-05" });
  });

  it.each([
    ["an empty title", { ...edited, title: "" }, "title"],
    ["four lead times", { ...edited, leadMinutes: [0, 60, 1440, 10080] }, "leadMinutes"],
    ["an interval of 13", { ...edited, repeatInterval: 13 }, "repeatInterval"],
  ])("answers 422 to %s without saving", async (_label, body, field) => {
    expect(await edit(reminder.id, body)).toMatchObject({ status: 422, body: { fieldErrors: { [field]: [expect.any(String)] } } });
    expect(reminder.title).toBe("Pay rent");
  });

  it("answers 400 to an identifier that isn't a UUID", async () => {
    expect(await edit("not-a-uuid", edited)).toMatchObject({ status: 400, body: { error: "Invalid reminder identifier." } });
  });

  it("answers 404 to a reminder that doesn't exist", async () => {
    expect(await edit(missingId, edited)).toMatchObject({ status: 404, body: { error: "Reminder not found." } });
  });

  it.each(strangers)("answers 404 to %s without saving", async (_label, signIn) => {
    signInStranger(signIn);

    expect(await edit(reminder.id, edited)).toMatchObject({ status: 404, body: { error: "Reminder not found." } });
    expect(reminder.title).toBe("Pay rent");
  });
});

describe("DELETE /api/reminders/[id]", () => {
  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await remove(reminder.id)).status).toBe(401);
    expect(repositories.reminders.rows).toHaveLength(1);
  });

  it("deletes the reminder", async () => {
    expect(await remove(reminder.id)).toMatchObject({ status: 200, body: { success: true } });
    expect(repositories.reminders.rows).toEqual([]);
  });

  it("answers 404 to a reminder that doesn't exist", async () => {
    expect(await remove(missingId)).toMatchObject({ status: 404, body: { error: "Reminder not found." } });
    expect(repositories.reminders.rows).toHaveLength(1);
  });

  it.each(strangers)("answers 404 to %s without deleting", async (_label, signIn) => {
    signInStranger(signIn);

    expect((await remove(reminder.id)).status).toBe(404);
    expect(repositories.reminders.rows).toHaveLength(1);
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.reminders, "delete").mockRejectedValue(new Error("private database failure"));

    expect(await remove(reminder.id)).toMatchObject({ status: 500, body: { error: "Unable to delete the reminder." } });
  });
});
