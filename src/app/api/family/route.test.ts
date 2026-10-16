import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import { aFamily, aKid, aParent } from "@/test/builders";
import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { DELETE, GET, POST } from "@/app/api/family/route";

let repositories: FakeRepositories;
let user: ReturnType<typeof signedInAs>;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  user = signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function createFamily(body: unknown) {
  return callRoute(POST, { method: "POST", body });
}

describe("GET /api/family", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");
    repositories.family.family = aFamily();

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
  });

  it("answers 404 without any query while the family flag is unset", async () => {
    vi.stubEnv("FAMILY_ENABLED", undefined);

    const response = await callRoute(GET);

    expect(response.status).toBe(404);
    expect(repositories.family.calls).toEqual([]);
  });

  it("returns a null family when the user has no family", async () => {
    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 200, body: { family: null } });
  });

  it("returns the family and its members to a member", async () => {
    const family = aFamily();
    repositories.family.membership = aParent();
    repositories.family.family = family;

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 200, body: { family } });
  });

  it("returns the family to a kid as well", async () => {
    const family = aFamily({ name: "The Kid's Family" });
    repositories.family.membership = aKid();
    repositories.family.family = family;

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 200, body: { family } });
  });

  it("answers privately, so the family is never cached", async () => {
    const { headers } = await callRoute(GET);

    expect(headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.family, "getFamily").mockRejectedValue(new Error("private database failure"));

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to load the family." } });
  });
});

describe("POST /api/family", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await createFamily({ name: "The Smiths" });

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
    expect(repositories.family.family).toBeNull();
  });

  it("creates a family with the caller as its creator and returns it with status 201", async () => {
    const response = await createFamily({ name: "The Smiths" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ family: repositories.family.family });
    expect(response.body.family).toMatchObject({
      family: { name: "The Smiths" },
      members: [{ userId: user.id, role: "parent", isCreator: true, permissions: PARENT_PERMISSIONS }],
    });
    expect(repositories.family.calls).toEqual(["touchLastActive", "createFamily", "getFamily"]);
  });

  it("trims the family name", async () => {
    const response = await createFamily({ name: "  The Smiths  " });

    expect(response.body.family.family.name).toBe("The Smiths");
  });

  it("rejects a blank name with 422 and the field error, without creating anything", async () => {
    const response = await createFamily({ name: "   " });

    expect(response).toMatchObject({
      status: 422,
      body: { error: "Check the family name and try again.", fieldErrors: { name: ["Enter a family name."] } },
    });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("rejects a name longer than 60 characters with 422", async () => {
    const response = await createFamily({ name: "x".repeat(61) });

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { name: ["Use at most 60 characters."] } } });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("rejects a missing or malformed body with 422", async () => {
    const response = await createFamily("{");

    expect(response).toMatchObject({ status: 422, body: { error: "Check the family name and try again." } });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("answers 409 when the caller is already in a family, leaving it unchanged", async () => {
    const family = aFamily();
    repositories.family.membership = aParent();
    repositories.family.family = family;

    const response = await createFamily({ name: "Another family" });

    expect(response).toMatchObject({ status: 409, body: { error: "You're already in a family." } });
    expect(repositories.family.family).toBe(family);
  });

  it("passes on the database's invalid-name refusal as 422", async () => {
    vi.spyOn(repositories.family, "createFamily").mockRejectedValue(new DomainError("Enter a family name.", 422));

    const response = await createFamily({ name: "The Smiths" });

    expect(response).toMatchObject({ status: 422, body: { error: "Enter a family name." } });
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.family, "createFamily").mockRejectedValue(new Error("private database failure"));

    const response = await createFamily({ name: "The Smiths" });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to create the family." } });
  });

  it("answers 500 when the new family can't be read back", async () => {
    vi.spyOn(repositories.family, "getFamily").mockResolvedValue(null);

    const response = await createFamily({ name: "The Smiths" });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to create the family." } });
  });
});

describe("DELETE /api/family", () => {
  function deleteFamily(body: unknown) {
    return callRoute(DELETE, { method: "DELETE", body });
  }

  beforeEach(() => {
    repositories.family.membership = aParent();
    repositories.family.family = aFamily({ name: "The Smiths" });
  });

  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await deleteFamily({ confirmName: "The Smiths" });

    expect(response).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
    expect(repositories.family.family).not.toBeNull();
  });

  it("lets the creator delete the family, answering 204 with no body", async () => {
    const response = await deleteFamily({ confirmName: "The Smiths" });

    expect(response).toMatchObject({ status: 204, body: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(repositories.family.family).toBeNull();
    expect(repositories.family.membership).toBeNull();
    expect(repositories.family.calls).toEqual(["touchLastActive", "deleteFamily"]);
  });

  it("accepts the name in any case and with surrounding spaces", async () => {
    const response = await deleteFamily({ confirmName: "  the SMITHS  " });

    expect(response.status).toBe(204);
    expect(repositories.family.family).toBeNull();
  });

  it("refuses a parent who isn't the creator with 403, leaving the family", async () => {
    repositories.family.membership = aParent({ isCreator: false });

    const response = await deleteFamily({ confirmName: "The Smiths" });

    expect(response).toMatchObject({ status: 403, body: { error: "Only the family's creator can delete the family." } });
    expect(repositories.family.family).not.toBeNull();
  });

  it("refuses a kid with 403", async () => {
    repositories.family.membership = aKid();

    const response = await deleteFamily({ confirmName: "The Smiths" });

    expect(response.status).toBe(403);
    expect(repositories.family.family).not.toBeNull();
  });

  it("refuses a wrong name with 422, leaving the family", async () => {
    const response = await deleteFamily({ confirmName: "The Joneses" });

    expect(response).toMatchObject({ status: 422, body: { error: "Type the family's name to confirm." } });
    expect(repositories.family.family).not.toBeNull();
  });

  it("rejects a blank name with 422 and the field error, without any query", async () => {
    const response = await deleteFamily({ confirmName: "   " });

    expect(response).toMatchObject({
      status: 422,
      body: {
        error: "Type the family's name to confirm.",
        fieldErrors: { confirmName: ["Type the family's name to confirm."] },
      },
    });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("rejects a missing or malformed body with 422", async () => {
    const response = await deleteFamily("{");

    expect(response).toMatchObject({ status: 422, body: { error: "Type the family's name to confirm." } });
    expect(repositories.family.calls).toEqual(["touchLastActive"]);
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.family, "deleteFamily").mockRejectedValue(new Error("private database failure"));

    const response = await deleteFamily({ confirmName: "The Smiths" });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to delete the family." } });
  });
});
