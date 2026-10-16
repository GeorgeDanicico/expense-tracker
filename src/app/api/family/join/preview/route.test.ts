import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashInviteCode } from "@/lib/family/invite-code";
import { forgetLastActive } from "@/lib/family/last-active";
import { INVITE_CODE_WINDOW_MS, TOO_MANY_ATTEMPTS_MESSAGE, resetRateLimits } from "@/lib/http/rate-limit";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";
import { aFamily, aParent, anInvite } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { POST as JOIN } from "@/app/api/family/join/route";
import { POST } from "@/app/api/family/join/preview/route";

const CODE = "ABCD2345";
const UNKNOWN_CODE = "ZZZZ9999";
const otherUser = { id: "10000000-0000-4000-8000-000000000221", email: "other@example.test" };

let repositories: FakeRepositories;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T09:00:00.000Z"));
  forgetLastActive();
  resetRateLimits();
  repositories = resetFakeRepositories();
  signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
  repositories.family.invites.push(anInvite({ codeHash: hashInviteCode(CODE) }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function preview(body: unknown, url = "/api/family/join/preview") {
  return callRoute(POST, { method: "POST", url, body });
}

async function failTimes(times: number) {
  for (let attempt = 0; attempt < times; attempt += 1) {
    expect((await preview({ code: UNKNOWN_CODE })).status).toBe(404);
  }
}

describe("POST /api/family/join/preview", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await preview({ code: CODE });

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
  });

  it("shows what a valid kid code invites the caller to", async () => {
    const response = await preview({ code: CODE });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      familyName: "The Smiths",
      inviterName: "owner",
      role: "kid",
      permissions: DEFAULT_KID_PERMISSIONS,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    expect(repositories.family.calls).toEqual(["touchLastActive", "previewInvite"]);
  });

  it("shows a parent invite with null permissions", async () => {
    repositories.family.invites = [anInvite({ codeHash: hashInviteCode(CODE), role: "parent", permissions: null })];

    const response = await preview({ code: CODE });

    expect(response).toMatchObject({ status: 200, body: { role: "parent", permissions: null } });
  });

  it("accepts a code typed in lowercase with spaces and dashes", async () => {
    const response = await preview({ code: " abcd-2345 " });

    expect(response).toMatchObject({ status: 200, body: { familyName: "The Smiths" } });
  });

  it("works for a caller already in a family", async () => {
    repositories.family.membership = aParent({ familyId: "70000000-0000-4000-8000-000000000221" });
    repositories.family.family = aFamily({ id: "70000000-0000-4000-8000-000000000221" });

    const response = await preview({ code: CODE });

    expect(response.status).toBe(200);
  });

  it("answers 404 for an unknown code", async () => {
    const response = await preview({ code: UNKNOWN_CODE });

    expect(response).toMatchObject({ status: 404, body: { error: "This code isn't valid anymore." } });
  });

  it.each([
    ["used", { usedAt: "2026-10-02T09:00:00.000Z" }],
    ["revoked", { revokedAt: "2026-10-02T09:00:00.000Z" }],
    ["expired", { expiresAt: "2026-10-16T08:59:59.000Z" }],
  ])("answers 404 for a %s code, without saying why", async (_, overrides) => {
    repositories.family.invites = [anInvite({ codeHash: hashInviteCode(CODE), ...overrides })];

    const response = await preview({ code: CODE });

    expect(response).toMatchObject({ status: 404, body: { error: "This code isn't valid anymore." } });
  });

  it("refuses a malformed code with 422 without any query", async () => {
    const response = await preview({ code: "ABCD-234" });

    expect(response).toMatchObject({
      status: 422,
      body: { error: "Enter the 8-character invite code.", fieldErrors: { code: ["Enter the 8-character invite code."] } },
    });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("ignores a code in the query string", async () => {
    const response = await preview(undefined, `/api/family/join/preview?code=${CODE}`);

    expect(response.status).toBe(422);
    expect(repositories.family.calls).not.toContain("previewInvite");
  });

  it("answers 500 with a generic message when the storage fails", async () => {
    vi.spyOn(repositories.family, "previewInvite").mockRejectedValue(new Error("private database failure"));

    const response = await preview({ code: CODE });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to check the invite code." } });
  });

  it("answers privately, so the preview is never cached", async () => {
    const { headers } = await preview({ code: CODE });

    expect(headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
});

describe("POST /api/family/join/preview rate limit", () => {
  it("answers 429 after 10 codes that didn't work, without asking the database, even for a valid code", async () => {
    await failTimes(10);
    const callsBefore = repositories.family.calls.filter((name) => name === "previewInvite").length;

    const response = await preview({ code: CODE });

    expect(response).toMatchObject({ status: 429, body: { error: TOO_MANY_ATTEMPTS_MESSAGE } });
    expect(repositories.family.calls.filter((name) => name === "previewInvite")).toHaveLength(callsBefore);
  });

  it("doesn't count valid codes, and a valid code doesn't clear earlier failures", async () => {
    await failTimes(9);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await preview({ code: CODE })).status).toBe(200);
    }

    expect((await preview({ code: UNKNOWN_CODE })).status).toBe(404);
    expect((await preview({ code: CODE })).status).toBe(429);
  });

  it("doesn't count malformed codes or storage failures", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await preview({ code: "nope" })).status).toBe(422);
    }
    const spy = vi.spyOn(repositories.family, "previewInvite").mockRejectedValue(new Error("private database failure"));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await preview({ code: CODE })).status).toBe(500);
    }
    spy.mockRestore();

    expect((await preview({ code: CODE })).status).toBe(200);
  });

  it("counts each user separately", async () => {
    await failTimes(10);

    signedInAs(otherUser);
    const response = await preview({ code: CODE });

    expect(response.status).toBe(200);
  });

  it("lets the caller try again 15 minutes after the failures", async () => {
    await failTimes(10);
    vi.advanceTimersByTime(INVITE_CODE_WINDOW_MS - 1);
    expect((await preview({ code: CODE })).status).toBe(429);

    vi.advanceTimersByTime(1);
    expect((await preview({ code: CODE })).status).toBe(200);
  });

  it("shares the limit with joining", async () => {
    await failTimes(5);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await callRoute(JOIN, { method: "POST", body: { code: UNKNOWN_CODE } })).status).toBe(404);
    }

    expect((await preview({ code: CODE })).status).toBe(429);
  });
});
