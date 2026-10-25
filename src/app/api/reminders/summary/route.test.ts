import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs, testUser } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET } from "@/app/api/reminders/summary/route";

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

describe("GET /api/reminders/summary", () => {
  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect(await callRoute(GET)).toMatchObject({ status: 401, body: { error: "Unauthorized" } });
  });

  it("counts the caller's due and overdue reminders", async () => {
    repositories.reminders.seed({ nextDueOn: "2026-10-20" });
    repositories.reminders.seed({ nextDueOn: "2026-10-24", timeOfDay: "20:00" });
    repositories.reminders.seed();
    repositories.reminders.seed({ nextDueOn: "2026-10-19", snoozedUntil: "2026-10-24T13:00:00.000Z" });
    repositories.reminders.seed({ userId: "10000000-0000-4000-8000-000000000009", nextDueOn: "2026-10-20" });

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 200, body: { due: 1, overdue: 1 } });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
});
