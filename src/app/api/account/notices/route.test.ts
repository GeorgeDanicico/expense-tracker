import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET } from "@/app/api/account/notices/route";

let repositories: FakeRepositories;

beforeEach(() => {
  forgetLastActive();
  repositories = resetFakeRepositories();
  signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const older = { id: "a", kind: "removed_from_family", familyName: "The Smiths", createdAt: "2026-10-01T10:00:00Z" } as const;
const newer = { id: "b", kind: "family_deleted", familyName: "The Smiths", createdAt: "2026-10-02T10:00:00Z" } as const;

describe("GET /api/account/notices", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");
    repositories.notices.notices.push(older);

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.notices.calls).toEqual([]);
  });

  it("returns the unseen notices, oldest first", async () => {
    repositories.notices.notices.push(newer, older);

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 200, body: { notices: [older, newer] } });
  });

  it("leaves out notices that were dismissed", async () => {
    repositories.notices.notices.push(older, newer);
    repositories.notices.seen.add("a");

    const response = await callRoute(GET);

    expect(response.body).toEqual({ notices: [newer] });
  });

  it("returns an empty list when there is nothing to show", async () => {
    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 200, body: { notices: [] } });
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.notices, "listUnseen").mockRejectedValue(new Error("private database failure"));

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to load your notices." } });
  });
});
