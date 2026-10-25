import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute } from "@/test/route";
import { asKid, asOutsider, asParent, kidUser } from "@/test/todo-board";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { POST } from "@/app/api/reminders/[id]/complete/route";

const missingId = "90000000-0000-4000-8000-000000000404";

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  asKid(repositories);
  repositories.reminders.callerId = kidUser.id;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function complete(id: string) {
  return callRoute(POST, { method: "POST", params: { id } });
}

describe("POST /api/reminders/[id]/complete", () => {
  it("answers 401 to an anonymous caller", async () => {
    const reminder = repositories.reminders.seed();
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await complete(reminder.id)).status).toBe(401);
    expect(repositories.reminders.completions).toEqual([]);
  });

  it("marks a one-off done, and answers 409 to a second call", async () => {
    const reminder = repositories.reminders.seed({ snoozedUntil: "2026-10-24T13:00:00.000Z" });

    expect(await complete(reminder.id)).toMatchObject({
      status: 200,
      body: { reminder: { id: reminder.id, nextDueOn: null, nextDueAt: null, snoozedUntil: null, state: "done" } },
    });
    expect(await complete(reminder.id)).toMatchObject({ status: 409, body: { error: "This reminder is already done." } });
    expect(repositories.reminders.completions).toEqual([expect.objectContaining({ reminderId: reminder.id, occurrenceOn: "2026-11-01" })]);
  });

  it("moves a monthly reminder two months when completed twice in a row", async () => {
    const reminder = repositories.reminders.seed({
      repeatUnit: "month",
      startsOn: "2026-10-15",
      nextDueOn: "2026-10-15",
      nextDueAt: "2026-10-15T06:00:00.000Z",
    });

    expect(await complete(reminder.id)).toMatchObject({ status: 200, body: { reminder: { nextDueOn: "2026-11-15", state: "upcoming" } } });
    expect(await complete(reminder.id)).toMatchObject({
      status: 200,
      body: { reminder: { nextDueOn: "2026-12-15", nextDueAt: "2026-12-15T07:00:00.000Z" } },
    });
    expect(repositories.reminders.completions.map((completion) => completion.occurrenceOn)).toEqual(["2026-10-15", "2026-11-15"]);
  });

  it("answers 400 to an identifier that isn't a UUID", async () => {
    expect((await complete("not-a-uuid")).status).toBe(400);
  });

  it("answers 404 to a reminder that doesn't exist", async () => {
    expect(await complete(missingId)).toMatchObject({ status: 404, body: { error: "Reminder not found." } });
  });

  it.each([
    ["another user", asOutsider],
    ["a parent of the owner", asParent],
  ] as const)("answers 404 to %s without completing", async (_label, signIn) => {
    const reminder = repositories.reminders.seed();
    repositories.reminders.callerId = signIn(repositories).id;

    expect((await complete(reminder.id)).status).toBe(404);
    expect(reminder.nextDueOn).toBe("2026-11-01");
    expect(repositories.reminders.completions).toEqual([]);
  });
});
