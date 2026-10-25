import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import type { FakeReminderRow } from "@/test/fakes/reminders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute } from "@/test/route";
import { asKid, asOutsider, asParent, kidUser } from "@/test/todo-board";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { POST } from "@/app/api/reminders/[id]/snooze/route";

const missingId = "90000000-0000-4000-8000-000000000404";

let repositories: FakeRepositories;
/** An overdue one-off of the kid (`kidUser`), who is signed in. */
let reminder: FakeReminderRow;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  asKid(repositories);
  repositories.reminders.callerId = kidUser.id;
  reminder = repositories.reminders.seed({ nextDueOn: "2026-10-20", nextDueAt: "2026-10-20T06:00:00.000Z" });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function snooze(id: string, body: unknown) {
  return callRoute(POST, { method: "POST", body, params: { id } });
}

describe("POST /api/reminders/[id]/snooze", () => {
  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await snooze(reminder.id, { kind: "hour" })).status).toBe(401);
    expect(reminder.snoozedUntil).toBeNull();
  });

  it.each([
    ["an hour", { kind: "hour" }, "2026-10-24T13:00:00.000Z"],
    ["until tomorrow", { kind: "tomorrow" }, "2026-10-25T07:00:00.000Z"],
    ["until a chosen time", { kind: "until", until: "2026-10-26T10:00:00+02:00" }, "2026-10-26T08:00:00.000Z"],
  ])("snoozes for %s", async (_label, body, snoozedUntil) => {
    const response = await snooze(reminder.id, body);

    expect(response).toMatchObject({ status: 200, body: { reminder: { id: reminder.id, snoozedUntil, nextNotifyAt: snoozedUntil, state: "snoozed" } } });
    expect(reminder.snoozedUntil).toBe(snoozedUntil);
  });

  it.each([
    ["a snooze in the past", { kind: "until", until: "2026-10-24T11:00:00.000Z" }],
    ["an unknown kind", { kind: "forever" }],
    ["an empty body", {}],
  ])("answers 422 to %s without snoozing", async (_label, body) => {
    expect((await snooze(reminder.id, body)).status).toBe(422);
    expect(reminder.snoozedUntil).toBeNull();
  });

  it("answers 409 to a one-off that's done", async () => {
    reminder.nextDueOn = null;
    reminder.nextDueAt = null;

    expect(await snooze(reminder.id, { kind: "hour" })).toMatchObject({ status: 409, body: { error: "This reminder is already done." } });
  });

  it("answers 400 to an identifier that isn't a UUID", async () => {
    expect((await snooze("not-a-uuid", { kind: "hour" })).status).toBe(400);
  });

  it("answers 404 to a reminder that doesn't exist", async () => {
    expect(await snooze(missingId, { kind: "hour" })).toMatchObject({ status: 404, body: { error: "Reminder not found." } });
  });

  it.each([
    ["another user", asOutsider],
    ["a parent of the owner", asParent],
  ] as const)("answers 404 to %s without snoozing", async (_label, signIn) => {
    repositories.reminders.callerId = signIn(repositories).id;

    expect((await snooze(reminder.id, { kind: "hour" })).status).toBe(404);
    expect(reminder.snoozedUntil).toBeNull();
  });
});
