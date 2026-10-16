import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { PERMISSION_PRESETS } from "@/lib/permissions";
import { aFamily, aKid, aParent } from "@/test/builders";
import { FakeAuth, FakeAuthAdmin } from "@/test/fakes/auth";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

const mocks = vi.hoisted(() => ({ getAuthAdmin: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthAdmin: mocks.getAuthAdmin }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { createKidAccount } from "@/lib/family/service";

const familyId = aParent().familyId;
const teen = PERMISSION_PRESETS.teen;
const password = "temporary-pass-1";
const ana = { displayName: "Ana", username: "ana", password, permissions: teen };

let repositories: FakeRepositories;
let auth: FakeAuth;
let admin: FakeAuthAdmin;

/** The kid entry `createKidAccount` added to the family, if any. */
function kidMember() {
  return repositories.family.family?.members.find((member) => member.role === "kid");
}

beforeEach(() => {
  repositories = resetFakeRepositories();
  auth = new FakeAuth();
  admin = new FakeAuthAdmin(auth);
  mocks.getAuthAdmin.mockReset().mockReturnValue(admin);
  vi.stubEnv("FAMILY_ENABLED", "true");
  repositories.family.membership = aParent();
  repositories.family.family = aFamily();
  repositories.family.accountProfiles = admin.profiles;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createKidAccount", () => {
  it("creates a confirmed account with the generated email, marked for the parent's family", async () => {
    const { userId } = await createKidAccount(ana);

    expect(auth.accounts).toEqual([
      expect.objectContaining({ id: userId, email: "ana@kids.ifam.invalid", password, confirmed: true }),
    ]);
    expect(admin.profiles.get(userId)).toEqual({
      username: "ana",
      displayName: "Ana",
      managedByFamily: familyId,
      mustChangePassword: true,
    });
  });

  it("adds the new account to the family as a kid with the chosen permissions", async () => {
    const { userId, memberId } = await createKidAccount(ana);

    expect(kidMember()).toMatchObject({ memberId, userId, role: "kid", displayName: "Ana", username: "ana", permissions: teen });
    expect(repositories.family.calls).toEqual(["getMembership", "addManagedKid"]);
  });

  it("lowercases the username and trims the name", async () => {
    const { userId } = await createKidAccount({ ...ana, displayName: "  Ana  ", username: " Ana.Pop " });

    expect(auth.accounts[0].email).toBe("ana.pop@kids.ifam.invalid");
    expect(admin.profiles.get(userId)).toMatchObject({ username: "ana.pop", displayName: "Ana" });
  });

  it("lets a parent who isn't the creator add a kid", async () => {
    repositories.family.membership = aParent({ memberId: "60000000-0000-4000-8000-000000000003", isCreator: false });

    await createKidAccount(ana);

    expect(kidMember()?.username).toBe("ana");
  });

  it("refuses a taken username with 409, without creating an account", async () => {
    await admin.createUser({
      email: "ana@example.test",
      password,
      username: "ana",
      displayName: "Another Ana",
      managedByFamily: null,
      mustChangePassword: false,
    });

    await expect(createKidAccount(ana)).rejects.toThrow(new DomainError("That username is taken.", 409));
    expect(auth.accounts).toHaveLength(1);
    expect(repositories.family.calls).toEqual(["getMembership"]);
  });

  it("refuses a kid caller with 403, before validating or reaching the auth admin", async () => {
    repositories.family.membership = aKid();

    await expect(createKidAccount({})).rejects.toThrow(new DomainError("Only parents can add a kid.", 403));
    expect(mocks.getAuthAdmin).not.toHaveBeenCalled();
    expect(auth.accounts).toEqual([]);
  });

  it("refuses a caller without a family with 403", async () => {
    repositories.family.membership = null;
    repositories.family.family = null;

    await expect(createKidAccount(ana)).rejects.toThrow(new DomainError("Only parents can add a kid.", 403));
    expect(mocks.getAuthAdmin).not.toHaveBeenCalled();
  });

  it("refuses everyone with 403 while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    await expect(createKidAccount(ana)).rejects.toThrow(new DomainError("Only parents can add a kid.", 403));
    expect(repositories.family.calls).toEqual([]);
  });

  it("rejects a password under 8 characters with 422 and the field's error", async () => {
    const error = await createKidAccount({ ...ana, password: "short" }).catch((caught: unknown) => caught);

    expect(error).toEqual(
      new DomainError("Check the kid's details and try again.", 422, {
        password: ["Password must contain at least 8 characters."],
      }),
    );
    expect(mocks.getAuthAdmin).not.toHaveBeenCalled();
  });

  it("rejects a password over 128 characters with 422", async () => {
    await expect(createKidAccount({ ...ana, password: "x".repeat(129) })).rejects.toMatchObject({ status: 422 });
  });

  it.each([
    ["an invalid username", { ...ana, username: "a" }, "username"],
    ["an empty name", { ...ana, displayName: "  " }, "displayName"],
    ["permissions missing a module", { ...ana, permissions: { expenses: "edit" } }, "permissions"],
    ["a level the module doesn't allow", { ...ana, permissions: { ...teen, investments: "view" } }, "permissions"],
  ])("rejects %s with 422", async (_case, input, field) => {
    const error = await createKidAccount(input).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 422 });
    expect((error as DomainError).fieldErrors?.[field]).toBeDefined();
    expect(auth.accounts).toEqual([]);
  });

  it("rejects a missing body with 422", async () => {
    await expect(createKidAccount(null)).rejects.toMatchObject({ status: 422 });
  });

  it("passes on the auth admin's refusal and adds nobody to the family", async () => {
    admin.fail("createUser", new DomainError("Password is too weak.", 422));

    await expect(createKidAccount(ana)).rejects.toThrow(new DomainError("Password is too weak.", 422));
    expect(repositories.family.calls).toEqual(["getMembership"]);
  });

  it("deletes the new account and passes on the error when adding it to the family fails", async () => {
    const refusal = new DomainError("That account wasn't found.", 404);
    vi.spyOn(repositories.family, "addManagedKid").mockRejectedValue(refusal);

    await expect(createKidAccount(ana)).rejects.toBe(refusal);

    expect(admin.deletedUserIds).toHaveLength(1);
    expect(auth.accounts).toEqual([]);
    expect(admin.profiles.size).toBe(0);
    expect(kidMember()).toBeUndefined();
  });

  it("still passes on the original error when deleting the new account fails too", async () => {
    const refusal = new Error("private database failure");
    vi.spyOn(repositories.family, "addManagedKid").mockRejectedValue(refusal);
    admin.fail("deleteUser", new Error("Auth admin failure"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(createKidAccount(ana)).rejects.toBe(refusal);

    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain(password);
  });
});
