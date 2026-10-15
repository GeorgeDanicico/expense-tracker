import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { getCurrentMember } from "@/lib/family/current-member";
import { can } from "@/lib/permissions";
import { aKid, aParent } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => vi.unstubAllEnvs());

describe("getCurrentMember", () => {
  it("returns null without any query when the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");
    repositories.family.membership = aParent();

    expect(await getCurrentMember()).toBeNull();
    expect(repositories.family.calls).toEqual([]);
  });

  it("returns null without any query when the family flag is unset", async () => {
    vi.stubEnv("FAMILY_ENABLED", undefined);
    repositories.family.membership = aParent();

    expect(await getCurrentMember()).toBeNull();
    expect(repositories.family.calls).toEqual([]);
  });

  it("returns null when the user has no family", async () => {
    expect(await getCurrentMember()).toBeNull();
    expect(repositories.family.calls).toEqual(["getMembership"]);
  });

  it("returns a parent's membership, which passes every check", async () => {
    const parent = aParent();
    repositories.family.membership = parent;

    const member = await getCurrentMember();

    expect(member).toEqual(parent);
    expect(can(member, "investments", "edit")).toBe(true);
    expect(can(member, "family_finance", "view")).toBe(true);
  });

  it("returns a kid's membership, checked against their permissions", async () => {
    const kid = aKid({ permissions: { expenses: "edit", investments: "off", net_worth: "off", family_finance: "off" } });
    repositories.family.membership = kid;

    const member = await getCurrentMember();

    expect(member).toEqual(kid);
    expect(can(member, "expenses", "edit")).toBe(true);
    expect(can(member, "investments", "edit")).toBe(false);
  });
});
