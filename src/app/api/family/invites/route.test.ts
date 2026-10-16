import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { hashInviteCode } from "@/lib/family/invite-code";
import { forgetLastActive } from "@/lib/family/last-active";
import { PERMISSION_PRESETS } from "@/lib/permissions";
import { INVITE_CODE_ALPHABET } from "@/lib/validation/family";
import { aKid, aParent, anInvite } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET, POST } from "@/app/api/family/invites/route";

const HOUR = 60 * 60 * 1000;
const CODE_PATTERN = new RegExp(`^[${INVITE_CODE_ALPHABET}]{8}$`);

let repositories: FakeRepositories;

beforeEach(() => {
  forgetLastActive();
  repositories = resetFakeRepositories();
  signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
  repositories.family.membership = aParent();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function createInvite(body: unknown) {
  return callRoute(POST, { method: "POST", url: "/api/family/invites", body });
}

describe("GET /api/family/invites", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");
    repositories.family.invites.push(anInvite());

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
  });

  it("lists the family's pending invites to a parent, newest first, without their codes", async () => {
    repositories.family.invites.push(
      anInvite({ inviteId: "80000000-0000-4000-8000-000000000001", createdAt: "2026-10-01T09:00:00.000Z" }),
      anInvite({
        inviteId: "80000000-0000-4000-8000-000000000002",
        codeHash: "b".repeat(64),
        role: "parent",
        permissions: null,
        createdAt: "2026-10-02T09:00:00.000Z",
      }),
    );

    const response = await callRoute(GET);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      invites: [
        {
          inviteId: "80000000-0000-4000-8000-000000000002",
          role: "parent",
          permissions: null,
          createdByName: "owner",
          createdAt: "2026-10-02T09:00:00.000Z",
          expiresAt: "2999-01-01T00:00:00.000Z",
        },
        {
          inviteId: "80000000-0000-4000-8000-000000000001",
          role: "kid",
          permissions: PERMISSION_PRESETS.young_kid,
          createdByName: "owner",
          createdAt: "2026-10-01T09:00:00.000Z",
          expiresAt: "2999-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(repositories.family.calls).toEqual(["touchLastActive", "listInvites"]);
  });

  it("leaves out used, revoked and expired invites and other families' invites", async () => {
    repositories.family.invites.push(
      anInvite({ inviteId: "80000000-0000-4000-8000-000000000011", usedAt: "2026-10-02T09:00:00.000Z" }),
      anInvite({ inviteId: "80000000-0000-4000-8000-000000000012", revokedAt: "2026-10-02T09:00:00.000Z" }),
      anInvite({ inviteId: "80000000-0000-4000-8000-000000000013", expiresAt: "2026-01-01T00:00:00.000Z" }),
      anInvite({ inviteId: "80000000-0000-4000-8000-000000000014", familyId: "70000000-0000-4000-8000-000000000099" }),
    );

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 200, body: { invites: [] } });
  });

  it("refuses a kid with 403", async () => {
    repositories.family.membership = aKid();
    repositories.family.invites.push(anInvite());

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 403, body: { error: "Only parents can see the family's invites." } });
  });

  it("refuses a user without a family with 403", async () => {
    repositories.family.membership = null;

    const response = await callRoute(GET);

    expect(response.status).toBe(403);
  });

  it("answers privately, so the invites are never cached", async () => {
    const { headers } = await callRoute(GET);

    expect(headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.family, "listInvites").mockRejectedValue(new Error("private database failure"));

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to load the invites." } });
  });
});

describe("POST /api/family/invites", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await createInvite({ role: "parent" });

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
    expect(repositories.family.invites).toEqual([]);
  });

  it("creates a parent invite and answers 201 with its code, link and expiry", async () => {
    const before = Date.now();

    const response = await createInvite({ role: "parent" });

    expect(response.status).toBe(201);
    const [stored] = repositories.family.invites;
    expect(response.body).toEqual({
      inviteId: stored.inviteId,
      code: expect.stringMatching(CODE_PATTERN),
      url: `http://localhost/join/${response.body.code}`,
      expiresAt: stored.expiresAt,
    });
    expect(stored).toMatchObject({ role: "parent", permissions: null, familyId: aParent().familyId });
    expect(Date.parse(stored.expiresAt) - before).toBeGreaterThanOrEqual(48 * HOUR);
    expect(repositories.family.calls).toEqual(["touchLastActive", "createInvite"]);
  });

  it("creates a kid invite with the kid's permissions", async () => {
    const response = await createInvite({ role: "kid", permissions: PERMISSION_PRESETS.teen });

    expect(response.status).toBe(201);
    expect(repositories.family.invites).toEqual([
      expect.objectContaining({ inviteId: response.body.inviteId, role: "kid", permissions: PERMISSION_PRESETS.teen }),
    ]);
  });

  it("stores only the code's hash", async () => {
    const response = await createInvite({ role: "parent" });

    const [stored] = repositories.family.invites;
    expect(stored.codeHash).toBe(hashInviteCode(response.body.code));
    expect(JSON.stringify(repositories.family.invites)).not.toContain(response.body.code);
  });

  it("builds the link on the configured site URL in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "https://ifam.example.test");

    const response = await createInvite({ role: "parent" });

    expect(response.body.url).toBe(`https://ifam.example.test/join/${response.body.code}`);
  });

  it("accepts null permissions on a parent invite", async () => {
    const response = await createInvite({ role: "parent", permissions: null });

    expect(response.status).toBe(201);
    expect(repositories.family.invites[0].permissions).toBeNull();
  });

  it("retries with a fresh code when the code is already in use", async () => {
    const create = vi.spyOn(repositories.family, "createInvite");
    create.mockRejectedValueOnce(new DomainError("That invite code is already in use.", 409));

    const response = await createInvite({ role: "parent" });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledTimes(2);
    expect(repositories.family.invites[0].codeHash).toBe(hashInviteCode(response.body.code));
  });

  it("answers a generic 500, never a 409, when every fresh code clashes", async () => {
    vi.spyOn(repositories.family, "createInvite").mockRejectedValue(
      new DomainError("That invite code is already in use.", 409),
    );

    const response = await createInvite({ role: "parent" });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to create the invite." } });
  });

  it("rejects a kid invite without permissions with 422, without creating anything", async () => {
    const response = await createInvite({ role: "kid" });

    expect(response).toMatchObject({
      status: 422,
      body: { error: "Check the invite and try again.", fieldErrors: { permissions: ["Choose what the kid can use."] } },
    });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("rejects a kid invite with a level the module doesn't allow with 422", async () => {
    const response = await createInvite({ role: "kid", permissions: { ...PERMISSION_PRESETS.teen, family_finance: "edit" } });

    expect(response).toMatchObject({
      status: 422,
      body: { fieldErrors: { permissions: [expect.any(String)] } },
    });
    expect(repositories.family.invites).toEqual([]);
  });

  it("rejects a parent invite with permissions with 422", async () => {
    const response = await createInvite({ role: "parent", permissions: PERMISSION_PRESETS.teen });

    expect(response).toMatchObject({
      status: 422,
      body: { fieldErrors: { permissions: ["Parents always have full access."] } },
    });
    expect(repositories.family.invites).toEqual([]);
  });

  it("rejects an unknown role or a malformed body with 422", async () => {
    expect((await createInvite({ role: "grandparent" })).body).toMatchObject({
      error: "Check the invite and try again.",
      fieldErrors: { role: ["Choose whether to invite a parent or a kid."] },
    });
    expect((await createInvite("{")).status).toBe(422);
    expect(repositories.family.invites).toEqual([]);
  });

  it("refuses a kid with 403", async () => {
    repositories.family.membership = aKid();

    const response = await createInvite({ role: "kid", permissions: PERMISSION_PRESETS.young_kid });

    expect(response).toMatchObject({ status: 403, body: { error: "Only parents can invite people to the family." } });
    expect(repositories.family.invites).toEqual([]);
  });

  it("answers privately, so the code is never cached", async () => {
    const { headers } = await createInvite({ role: "parent" });

    expect(headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.family, "createInvite").mockRejectedValue(new Error("private database failure"));

    const response = await createInvite({ role: "parent" });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to create the invite." } });
  });
});
