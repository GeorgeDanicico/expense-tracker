import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import { aKid, aParent, anInvite } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { DELETE } from "@/app/api/family/invites/[id]/route";

const inviteId = "80000000-0000-4000-8000-000000000001";

let repositories: FakeRepositories;

beforeEach(() => {
  forgetLastActive();
  repositories = resetFakeRepositories();
  signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
  repositories.family.membership = aParent();
  repositories.family.invites.push(anInvite({ inviteId }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function revokeInvite(id: string) {
  return callRoute(DELETE, { method: "DELETE", params: { id } });
}

describe("DELETE /api/family/invites/[id]", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await revokeInvite(inviteId);

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
    expect(repositories.family.invites[0].revokedAt).toBeNull();
  });

  it("revokes the invite and answers 204", async () => {
    const response = await revokeInvite(inviteId);

    expect(response).toMatchObject({ status: 204, body: null });
    expect(repositories.family.invites[0].revokedAt).not.toBeNull();
    expect(repositories.family.calls).toEqual(["touchLastActive", "revokeInvite"]);
  });

  it("answers 204 again for an invite that is already revoked, leaving it as it was", async () => {
    repositories.family.invites[0].revokedAt = "2026-10-02T09:00:00.000Z";

    const response = await revokeInvite(inviteId);

    expect(response.status).toBe(204);
    expect(repositories.family.invites[0].revokedAt).toBe("2026-10-02T09:00:00.000Z");
  });

  it("answers 404 for an unknown invite", async () => {
    const response = await revokeInvite("80000000-0000-4000-8000-000000000099");

    expect(response).toMatchObject({ status: 404, body: { error: "That invite wasn't found." } });
  });

  it("answers 404 for another family's invite, leaving it alone", async () => {
    repositories.family.invites[0].familyId = "70000000-0000-4000-8000-000000000099";

    const response = await revokeInvite(inviteId);

    expect(response.status).toBe(404);
    expect(repositories.family.invites[0].revokedAt).toBeNull();
  });

  it("refuses a kid with 403", async () => {
    repositories.family.membership = aKid();

    const response = await revokeInvite(inviteId);

    expect(response).toMatchObject({ status: 403, body: { error: "Only parents can revoke invites." } });
    expect(repositories.family.invites[0].revokedAt).toBeNull();
  });

  it("rejects an id that isn't a UUID with 400, without any query", async () => {
    const response = await revokeInvite("not-a-uuid");

    expect(response).toMatchObject({ status: 400, body: { error: "Invalid invite identifier." } });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.family, "revokeInvite").mockRejectedValue(new Error("private database failure"));

    const response = await revokeInvite(inviteId);

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to revoke the invite." } });
  });
});
