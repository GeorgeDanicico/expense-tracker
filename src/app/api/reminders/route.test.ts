import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs, testUser } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET, POST } from "@/app/api/reminders/route";

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  signedInAs(testUser);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function list(query = "") {
  return callRoute(GET, { url: `/api/reminders${query}` });
}

function add(body: unknown) {
  return callRoute(POST, { method: "POST", url: "/api/reminders", body });
}

const validReminder = { title: "Pay rent", startsOn: "2026-11-01", repeatUnit: "month", repeatInterval: 1 };

describe("GET /api/reminders", () => {
  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect(await list()).toMatchObject({ status: 401, body: { error: "Unauthorized" } });
  });

  it("returns the caller's reminders with their state and the last 30 days of completions", async () => {
    const overdue = repositories.reminders.seed({ title: "Water plants", nextDueOn: "2026-10-20", nextDueAt: "2026-10-20T06:00:00.000Z" });
    const upcoming = repositories.reminders.seed();
    repositories.reminders.seed({ userId: "10000000-0000-4000-8000-000000000009", title: "Someone else's" });
    repositories.reminders.completions.push(
      { id: "a0000000-0000-4000-8000-000000000001", reminderId: upcoming.id, occurrenceOn: "2026-10-01", doneAt: "2026-10-01T08:00:00.000Z", expenseId: null },
      { id: "a0000000-0000-4000-8000-000000000002", reminderId: upcoming.id, occurrenceOn: "2026-09-01", doneAt: "2026-09-01T08:00:00.000Z", expenseId: null },
    );

    const response = await list();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.body.reminders).toEqual([
      expect.objectContaining({ id: overdue.id, state: "overdue" }),
      expect.objectContaining({ id: upcoming.id, state: "upcoming" }),
    ]);
    expect(response.body.completions).toEqual([expect.objectContaining({ occurrenceOn: "2026-10-01" })]);
  });

  it("reaches back to doneSince", async () => {
    const reminder = repositories.reminders.seed();
    repositories.reminders.completions.push(
      { id: "a0000000-0000-4000-8000-000000000002", reminderId: reminder.id, occurrenceOn: "2026-09-01", doneAt: "2026-09-01T08:00:00.000Z", expenseId: null },
    );

    const response = await list("?doneSince=2026-08-01T00:00:00%2B03:00");

    expect(response.body.completions).toEqual([expect.objectContaining({ occurrenceOn: "2026-09-01" })]);
  });

  it("answers 422 to a doneSince that isn't an ISO timestamp", async () => {
    expect(await list("?doneSince=yesterday")).toMatchObject({ status: 422, body: { fieldErrors: { doneSince: [expect.any(String)] } } });
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.reminders, "list").mockRejectedValue(new Error("private database failure"));

    expect(await list()).toMatchObject({ status: 500, body: { error: "Unable to load the reminders." } });
  });
});

describe("POST /api/reminders", () => {
  it("answers 401 to an anonymous caller without saving", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await add(validReminder)).status).toBe(401);
    expect(repositories.reminders.rows).toEqual([]);
  });

  it("creates a reminder for the caller with its dates worked out", async () => {
    const response = await add({ ...validReminder, title: "  Pay rent  ", leadMinutes: [1440, 0] });

    expect(response).toMatchObject({
      status: 201,
      body: {
        reminder: {
          title: "Pay rent",
          startsOn: "2026-11-01",
          timeOfDay: "09:00",
          repeatUnit: "month",
          leadMinutes: [0, 1440],
          nextDueOn: "2026-11-01",
          nextDueAt: "2026-11-01T07:00:00.000Z",
          snoozedUntil: null,
          nextNotifyAt: "2026-10-31T07:00:00.000Z",
          state: "upcoming",
        },
      },
    });
    expect(repositories.reminders.rows).toEqual([expect.objectContaining({ userId: testUser.id, title: "Pay rent" })]);
  });

  it.each([
    ["an empty title", { ...validReminder, title: "   " }, "title"],
    ["four lead times", { ...validReminder, leadMinutes: [0, 60, 1440, 4320] }, "leadMinutes"],
    ["an interval of 13", { ...validReminder, repeatInterval: 13 }, "repeatInterval"],
  ])("answers 422 to %s without saving", async (_label, body, field) => {
    const response = await add(body);

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { [field]: [expect.any(String)] } } });
    expect(repositories.reminders.rows).toEqual([]);
  });

  it("answers 422 to a body that isn't JSON", async () => {
    expect((await add("not json")).status).toBe(422);
  });
});
