import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { forgetLastActive } from "@/lib/family/last-active";
import { PERMISSION_PRESETS } from "@/lib/permissions";
import { aFamily, aKid, aParent } from "@/test/builders";
import { FakeAuth, FakeAuthAdmin } from "@/test/fakes/auth";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

let auth: FakeAuth;
let admin: FakeAuthAdmin;

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), getAuth: () => auth, getAuthAdmin: () => admin }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { POST } from "@/app/api/family/kids/route";

const ana = { displayName: "Ana", username: "ana", password: "temporary-pass-1", permissions: PERMISSION_PRESETS.young_kid };

let repositories: FakeRepositories;

function createKid(body: unknown) {
  return callRoute(POST, { method: "POST", body });
}

beforeEach(() => {
  forgetLastActive();
  repositories = resetFakeRepositories();
  auth = new FakeAuth();
  admin = new FakeAuthAdmin(auth);
  signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
  repositories.family.membership = aParent();
  repositories.family.family = aFamily();
  repositories.family.accountProfiles = admin.profiles;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/family/kids", () => {
  it("answers 404 without any query or account while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await createKid(ana);

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
    expect(auth.accounts).toEqual([]);
  });

  it("creates the kid's account and returns the updated family with 201", async () => {
    const response = await createKid(ana);

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(response.body).toEqual({ family: repositories.family.family });
    expect(response.body.family.members).toContainEqual(
      expect.objectContaining({ role: "kid", displayName: "Ana", username: "ana", permissions: PERMISSION_PRESETS.young_kid }),
    );
    expect(auth.accounts).toEqual([expect.objectContaining({ email: "ana@kids.ifam.invalid", confirmed: true })]);
    expect(repositories.family.calls).toEqual(["touchLastActive", "getMembership", "addManagedKid", "getFamily"]);
  });

  it("never returns the password", async () => {
    const response = await createKid(ana);

    expect(JSON.stringify(response.body)).not.toContain(ana.password);
  });

  it("refuses a kid with 403 without creating an account", async () => {
    repositories.family.membership = aKid();

    const response = await createKid(ana);

    expect(response).toMatchObject({ status: 403, body: { error: "Only parents can add a kid." } });
    expect(auth.accounts).toEqual([]);
  });

  it("refuses a user without a family with 403", async () => {
    repositories.family.membership = null;
    repositories.family.family = null;

    const response = await createKid(ana);

    expect(response).toMatchObject({ status: 403, body: { error: "Only parents can add a kid." } });
  });

  it("refuses a taken username with 409", async () => {
    await admin.createUser({
      email: "ana@example.test",
      password: "another-password",
      username: "ana",
      displayName: "Another Ana",
      managedByFamily: null,
      mustChangePassword: false,
    });

    const response = await createKid(ana);

    expect(response).toMatchObject({ status: 409, body: { error: "That username is taken." } });
    expect(auth.accounts).toHaveLength(1);
  });

  it("rejects a short password with 422 and the field's error", async () => {
    const response = await createKid({ ...ana, password: "short" });

    expect(response).toMatchObject({
      status: 422,
      body: {
        error: "Check the kid's details and try again.",
        fieldErrors: { password: ["Password must contain at least 8 characters."] },
      },
    });
    expect(auth.accounts).toEqual([]);
  });

  it("rejects a missing or malformed body with 422", async () => {
    const response = await createKid("{");

    expect(response).toMatchObject({ status: 422, body: { error: "Check the kid's details and try again." } });
  });

  it("deletes the new account and passes on the database's refusal", async () => {
    vi.spyOn(repositories.family, "addManagedKid").mockRejectedValue(
      new DomainError("That account wasn't found.", 404),
    );

    const response = await createKid(ana);

    expect(response).toMatchObject({ status: 404, body: { error: "That account wasn't found." } });
    expect(admin.deletedUserIds).toHaveLength(1);
    expect(auth.accounts).toEqual([]);
  });

  it("hides an auth admin failure behind a generic message", async () => {
    admin.fail("createUser", new Error("private auth failure"));

    const response = await createKid(ana);

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to create the kid's account." } });
  });

  it("answers 500 when the family can't be read back", async () => {
    vi.spyOn(repositories.family, "getFamily").mockResolvedValue(null);

    const response = await createKid(ana);

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to create the kid's account." } });
  });
});
