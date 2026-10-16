import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { POST } from "@/app/api/account/notices/[id]/dismiss/route";

const noticeId = "90000000-0000-4000-8000-000000000001";

let repositories: FakeRepositories;

beforeEach(() => {
  forgetLastActive();
  repositories = resetFakeRepositories();
  signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
  repositories.notices.notices.push({
    id: noticeId,
    kind: "family_deleted",
    familyName: "The Smiths",
    createdAt: "2026-10-01T10:00:00Z",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function dismiss(id: string) {
  return callRoute(POST, { method: "POST", params: { id } });
}

describe("POST /api/account/notices/[id]/dismiss", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await dismiss(noticeId);

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.notices.calls).toEqual([]);
  });

  it("marks the notice as seen and answers 204", async () => {
    const response = await dismiss(noticeId);

    expect(response).toMatchObject({ status: 204, body: null });
    expect(repositories.notices.seen.has(noticeId)).toBe(true);
  });

  it("answers 404 for a notice that does not exist or belongs to someone else", async () => {
    const response = await dismiss("90000000-0000-4000-8000-000000000002");

    expect(response).toMatchObject({ status: 404, body: { error: "Notice not found." } });
  });

  it("rejects an id that is not a UUID", async () => {
    const response = await dismiss("not-an-id");

    expect(response).toMatchObject({ status: 400, body: { error: "Invalid notice identifier." } });
    expect(repositories.notices.calls).toEqual([]);
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.notices, "dismiss").mockRejectedValue(new Error("private database failure"));

    const response = await dismiss(noticeId);

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to dismiss the notice." } });
  });
});
