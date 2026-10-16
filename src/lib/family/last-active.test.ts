import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive, MAX_REMEMBERED, TOUCH_INTERVAL_MS } from "@/lib/family/last-active";
import { json, withUser } from "@/lib/http/route";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { signedInAs, testUser } from "@/test/route";

const otherUser = { id: "10000000-0000-4000-8000-000000000341", email: "other@example.test" };
const route = withUser(async () => json({ ok: true }));

let repositories: FakeRepositories;

async function call() {
  const response = await route();
  return { status: response.status, body: await response.json() };
}

const touches = () => repositories.family.calls.filter((name) => name === "touchLastActive").length;

beforeEach(() => {
  vi.useFakeTimers();
  repositories = resetFakeRepositories();
  forgetLastActive();
  signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("withUser last activity", () => {
  it("touches the signed-in user's last activity, without a membership lookup first", async () => {
    expect(await call()).toEqual({ status: 200, body: { ok: true } });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("touches each user at most once per 5 minutes", async () => {
    await call();
    await call();
    vi.advanceTimersByTime(TOUCH_INTERVAL_MS - 1);
    await call();
    expect(touches()).toBe(1);

    vi.advanceTimersByTime(1);
    await call();
    expect(touches()).toBe(2);
  });

  it("touches two different users once each", async () => {
    await call();
    signedInAs(otherUser);
    await call();
    expect(touches()).toBe(2);

    signedInAs(testUser);
    await call();
    signedInAs(otherUser);
    await call();
    expect(touches()).toBe(2);
  });

  it("doesn't touch while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    expect(await call()).toEqual({ status: 200, body: { ok: true } });
    expect(repositories.family.calls).toEqual([]);
  });

  it("doesn't touch when nobody is signed in", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await call()).status).toBe(401);
    expect(repositories.family.calls).toEqual([]);
  });

  it("returns the normal response when the touch fails", async () => {
    vi.spyOn(repositories.family, "touchLastActive").mockRejectedValue(new Error("database down"));

    expect(await call()).toEqual({ status: 200, body: { ok: true } });
  });

  it("returns the normal response when the touch throws before it starts", async () => {
    vi.spyOn(repositories.family, "touchLastActive").mockImplementation(() => {
      throw new Error("no client");
    });

    expect(await call()).toEqual({ status: 200, body: { ok: true } });
  });

  it("doesn't wait for a touch that never finishes", async () => {
    vi.spyOn(repositories.family, "touchLastActive").mockReturnValue(new Promise<void>(() => {}));

    expect(await call()).toEqual({ status: 200, body: { ok: true } });
  });

  it("doesn't retry a failed touch within the 5 minutes", async () => {
    const touch = vi.spyOn(repositories.family, "touchLastActive").mockRejectedValue(new Error("database down"));

    await call();
    await call();
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it("forgets the oldest users once it remembers too many, so it can't grow without limit", async () => {
    await call();
    for (let i = 0; i < MAX_REMEMBERED; i++) {
      signedInAs({ id: `user-${i}`, email: `user-${i}@example.test` });
      await call();
    }

    signedInAs(testUser);
    await call();
    expect(touches()).toBe(MAX_REMEMBERED + 2);
  });
});
