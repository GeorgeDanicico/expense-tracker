import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { PARENT_PERMISSIONS, type CurrentMember, type FamilyData } from "@/lib/family/repository";
import { MEMBER_NOT_FOUND_MESSAGE, resolveViewedUser, resolveViewedUserFor } from "@/lib/family/viewed-user";
import { HttpError } from "@/lib/http/route";
import type { Permissions } from "@/lib/permissions";
import { aFamily, aKid, aParent } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { testUser } from "@/test/route";

const PARENT = { memberId: "60000000-0000-4000-8000-000000000001", userId: testUser.id };
const OTHER_PARENT = { memberId: "60000000-0000-4000-8000-000000000003", userId: "10000000-0000-4000-8000-000000000003" };
const KID = { memberId: "60000000-0000-4000-8000-000000000002", userId: "10000000-0000-4000-8000-000000000002" };
const SIBLING = { memberId: "60000000-0000-4000-8000-000000000004", userId: "10000000-0000-4000-8000-000000000004" };
const OUTSIDER_MEMBER_ID = "60000000-0000-4000-8000-000000000099";

const kidUser = { id: KID.userId, email: "kid@example.test" };
const finance = (family_finance: Permissions["family_finance"]): Permissions =>
  ({ expenses: "edit", investments: "off", net_worth: "off", family_finance });

/** The Smiths as a parent sees them: two parents and two kids. */
function smiths(): FamilyData {
  const base = aFamily();
  const entry = (member: { memberId: string; userId: string }, role: "parent" | "kid", displayName: string, currency = "EUR") => ({
    ...base.members[0], ...member, role, isCreator: false, displayName, currency,
    permissions: role === "parent" ? PARENT_PERMISSIONS : finance("off"),
  });
  return {
    family: base.family,
    members: [
      { ...base.members[0], displayName: "Mara" },
      entry(OTHER_PARENT, "parent", "Dan"),
      entry(KID, "kid", "Ana", "RON"),
      entry(SIBLING, "kid", "Ion", "USD"),
    ],
  };
}

let repositories: FakeRepositories;
let parent: CurrentMember;

beforeEach(() => {
  repositories = resetFakeRepositories();
  repositories.family.family = smiths();
  parent = aParent();
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => vi.unstubAllEnvs());

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpError);
  return { status: (error as HttpError).status, message: (error as HttpError).message };
}

const NOT_FOUND = { status: 404, message: MEMBER_NOT_FOUND_MESSAGE };

describe("resolveViewedUser", () => {
  it("returns the caller, not read-only and without a query, when there is no param", async () => {
    expect(await resolveViewedUser(null, testUser, parent)).toEqual({
      userId: testUser.id,
      viewing: { memberId: PARENT.memberId, displayName: null, currency: null, readOnly: false },
    });
    expect(repositories.family.calls).toEqual([]);
  });

  it("returns the caller with a null member id for a user without a family", async () => {
    expect(await resolveViewedUser(null, testUser, null)).toEqual({
      userId: testUser.id,
      viewing: { memberId: null, displayName: null, currency: null, readOnly: false },
    });
  });

  it("returns the caller when the param is their own member id, in any case", async () => {
    const result = await resolveViewedUser(PARENT.memberId.toUpperCase(), testUser, parent);

    expect(result).toEqual({ userId: testUser.id, viewing: { memberId: PARENT.memberId, displayName: null, currency: null, readOnly: false } });
    expect(repositories.family.calls).toEqual([]);
  });

  it("lets a parent view a kid, read-only", async () => {
    expect(await resolveViewedUser(KID.memberId, testUser, parent)).toEqual({
      userId: KID.userId,
      viewing: { memberId: KID.memberId, displayName: "Ana", currency: "RON", readOnly: true },
    });
  });

  it("lets a parent view the other parent", async () => {
    expect(await resolveViewedUser(OTHER_PARENT.memberId, testUser, parent)).toEqual({
      userId: OTHER_PARENT.userId,
      viewing: { memberId: OTHER_PARENT.memberId, displayName: "Dan", currency: "EUR", readOnly: true },
    });
  });

  it("lets a kid with family finance at view see a sibling", async () => {
    const kid = aKid({ permissions: finance("view") });

    expect(await resolveViewedUser(SIBLING.memberId, kidUser, kid)).toEqual({
      userId: SIBLING.userId,
      viewing: { memberId: SIBLING.memberId, displayName: "Ion", currency: "USD", readOnly: true },
    });
  });

  it("refuses a kid without family finance, without loading the family", async () => {
    const kid = aKid({ permissions: finance("off") });

    expect(await refusal(resolveViewedUser(SIBLING.memberId, kidUser, kid))).toEqual(NOT_FOUND);
    expect(repositories.family.calls).toEqual([]);
  });

  it("still lets a kid without family finance view themselves", async () => {
    const kid = aKid({ permissions: finance("off") });

    expect(await resolveViewedUser(KID.memberId, kidUser, kid)).toMatchObject({ userId: KID.userId, viewing: { readOnly: false } });
  });

  it("refuses an unknown member id with the same message", async () => {
    expect(await refusal(resolveViewedUser("60000000-0000-4000-8000-0000000000aa", testUser, parent))).toEqual(NOT_FOUND);
  });

  it("refuses a member of another family with the same message", async () => {
    expect(await refusal(resolveViewedUser(OUTSIDER_MEMBER_ID, testUser, parent))).toEqual(NOT_FOUND);
  });

  it("refuses when the loaded family isn't the caller's", async () => {
    repositories.family.family = { ...smiths(), family: { ...smiths().family, id: "70000000-0000-4000-8000-000000000099" } };

    expect(await refusal(resolveViewedUser(KID.memberId, testUser, parent))).toEqual(NOT_FOUND);
  });

  it("refuses when the caller's family can't be loaded", async () => {
    repositories.family.family = null;

    expect(await refusal(resolveViewedUser(KID.memberId, testUser, parent))).toEqual(NOT_FOUND);
  });

  it.each(["", "all", "not-a-uuid", `${KID.memberId}x`, " " + KID.memberId, "60000000-0000-4000-8000-00000000000"])(
    "refuses the malformed id %j before any query",
    async (param) => {
      expect(await refusal(resolveViewedUser(param, testUser, parent))).toEqual(NOT_FOUND);
      expect(repositories.family.calls).toEqual([]);
    },
  );

  it("refuses a user without a family", async () => {
    expect(await refusal(resolveViewedUser(KID.memberId, testUser, null))).toEqual(NOT_FOUND);
    expect(repositories.family.calls).toEqual([]);
  });

  it("refuses any param without a query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    expect(await refusal(resolveViewedUser(KID.memberId, testUser, parent))).toEqual(NOT_FOUND);
    expect(await refusal(resolveViewedUser(PARENT.memberId, testUser, parent))).toEqual(NOT_FOUND);
    expect(repositories.family.calls).toEqual([]);
  });

  it("returns the caller when the matching entry is the caller's own", async () => {
    // A membership whose id differs from the family entry's (should never happen) still can't widen access.
    const stale = aParent({ memberId: "60000000-0000-4000-8000-0000000000bb" });

    expect(await resolveViewedUser(PARENT.memberId, testUser, stale)).toMatchObject({
      userId: testUser.id,
      viewing: { memberId: PARENT.memberId, readOnly: false },
    });
  });
});

describe("resolveViewedUserFor", () => {
  it("reads the member query parameter", async () => {
    const request = new Request(`http://localhost/api/expenses?month=2026-10&member=${KID.memberId}`);

    expect(await resolveViewedUserFor(request, testUser, parent)).toMatchObject({ userId: KID.userId });
  });

  it("returns the caller without the parameter", async () => {
    const request = new Request("http://localhost/api/expenses?month=2026-10");

    expect(await resolveViewedUserFor(request, testUser, parent)).toMatchObject({ userId: testUser.id });
  });
});
