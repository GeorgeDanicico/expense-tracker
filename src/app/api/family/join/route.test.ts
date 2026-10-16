import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashInviteCode } from "@/lib/family/invite-code";
import { forgetLastActive } from "@/lib/family/last-active";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import { TOO_MANY_ATTEMPTS_MESSAGE, resetRateLimits } from "@/lib/http/rate-limit";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";
import { aFamily, aParent, anInvite } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { POST } from "@/app/api/family/join/route";

const CODE = "ABCD2345";
const UNKNOWN_CODE = "ZZZZ9999";
const familyId = "70000000-0000-4000-8000-000000000001";

let repositories: FakeRepositories;
let user: ReturnType<typeof signedInAs>;

beforeEach(() => {
  forgetLastActive();
  resetRateLimits();
  repositories = resetFakeRepositories();
  user = signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
  repositories.family.invites.push(anInvite({ codeHash: hashInviteCode(CODE) }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function join(body: unknown, url = "/api/family/join") {
  return callRoute(POST, { method: "POST", url, body });
}

function enterFamily() {
  repositories.family.membership = aParent({ familyId: "70000000-0000-4000-8000-000000000222" });
  repositories.family.family = aFamily({ id: "70000000-0000-4000-8000-000000000222" });
}

describe("POST /api/family/join", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await join({ code: CODE });

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
    expect(repositories.family.invites[0].usedAt).toBeNull();
  });

  it("joins the family as a kid with the invite's permissions and answers with the family", async () => {
    const response = await join({ code: CODE });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      family: {
        family: { id: familyId, name: "The Smiths", createdAt: "2026-10-01T09:00:00.000Z" },
        members: [
          expect.objectContaining({ userId: user.id, role: "kid", isCreator: false, permissions: DEFAULT_KID_PERMISSIONS }),
        ],
      },
    });
    expect(repositories.family.membership).toMatchObject({ familyId, role: "kid" });
    expect(repositories.family.invites[0].usedAt).not.toBeNull();
    expect(repositories.family.calls).toEqual(["touchLastActive", "redeemInvite", "getFamily"]);
  });

  it("joins as a parent with a parent invite", async () => {
    repositories.family.invites = [anInvite({ codeHash: hashInviteCode(CODE), role: "parent", permissions: null })];

    const response = await join({ code: CODE });

    expect(response.status).toBe(201);
    expect(response.body.family.members[0]).toMatchObject({ role: "parent", permissions: PARENT_PERMISSIONS });
  });

  it("accepts a code typed in lowercase with spaces and dashes", async () => {
    const response = await join({ code: "abcd 2345" });

    expect(response.status).toBe(201);
  });

  it("answers 404 for an unknown code", async () => {
    const response = await join({ code: UNKNOWN_CODE });

    expect(response).toMatchObject({ status: 404, body: { error: "This code isn't valid anymore." } });
    expect(repositories.family.membership).toBeNull();
  });

  it("answers 404 for a code that was already used", async () => {
    repositories.family.invites = [anInvite({ codeHash: hashInviteCode(CODE), usedAt: "2026-10-02T09:00:00.000Z" })];

    const response = await join({ code: CODE });

    expect(response).toMatchObject({ status: 404, body: { error: "This code isn't valid anymore." } });
  });

  it("answers 409 when the caller is already in a family, leaving the invite unused", async () => {
    enterFamily();

    const response = await join({ code: CODE });

    expect(response).toMatchObject({ status: 409, body: { error: "You're already in a family." } });
    expect(repositories.family.invites[0].usedAt).toBeNull();
  });

  it("refuses a malformed code with 422 without any query", async () => {
    const response = await join({ code: 12345678 });

    expect(response).toMatchObject({
      status: 422,
      body: { error: "Enter the 8-character invite code.", fieldErrors: { code: ["Enter the 8-character invite code."] } },
    });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("ignores a code in the query string", async () => {
    const response = await join(undefined, `/api/family/join?code=${CODE}`);

    expect(response.status).toBe(422);
    expect(repositories.family.invites[0].usedAt).toBeNull();
  });

  it("answers 500 with a generic message when the family can't be read back", async () => {
    vi.spyOn(repositories.family, "getFamily").mockResolvedValue(null);

    const response = await join({ code: CODE });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to join the family." } });
  });

  it("answers privately, so the family is never cached", async () => {
    const { headers } = await join({ code: CODE });

    expect(headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
});

describe("POST /api/family/join rate limit", () => {
  it("answers 429 after 10 codes that didn't work, without asking the database, even for a valid code", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await join({ code: UNKNOWN_CODE })).status).toBe(404);
    }

    const response = await join({ code: CODE });

    expect(response).toMatchObject({ status: 429, body: { error: TOO_MANY_ATTEMPTS_MESSAGE } });
    expect(repositories.family.calls.filter((name) => name === "redeemInvite")).toHaveLength(10);
    expect(repositories.family.invites[0].usedAt).toBeNull();
  });

  it("doesn't count being already in a family", async () => {
    enterFamily();
    for (let attempt = 0; attempt < 11; attempt += 1) {
      expect((await join({ code: UNKNOWN_CODE })).status).toBe(409);
    }
  });

  it("lets a valid code through after 9 that didn't work", async () => {
    for (let attempt = 0; attempt < 9; attempt += 1) {
      expect((await join({ code: UNKNOWN_CODE })).status).toBe(404);
    }

    expect((await join({ code: CODE })).status).toBe(201);
  });
});
