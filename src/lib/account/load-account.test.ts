import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import { kidAccountEmail } from "@/lib/family/kid-account";
import { aKid, aParent } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { testUser } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), asPageCaller: (fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { getAuthenticatedUser } from "@/lib/auth";
import { loadAccount, loadPageAccount } from "@/lib/account/load-account";

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadAccount", () => {
  it("is the account response: a parent with a picture and a currency (the shape GET /api/account answered before PF5)", async () => {
    repositories.family.membership = aParent();
    repositories.account.currencies.set(testUser.id, "RON");
    repositories.avatars.paths.set(testUser.id, `${testUser.id}/20000000-0000-4000-8000-0000000000a1.webp`);

    expect(await loadAccount(testUser)).toEqual({
      email: "owner@example.test",
      signInName: "owner@example.test",
      currency: "RON",
      features: { family: true },
      membership: { memberId: "60000000-0000-4000-8000-000000000001", role: "parent", isCreator: true, familyName: "The Smiths", permissions: PARENT_PERMISSIONS },
      mustChangePassword: false,
      avatarUrl: `/api/avatars/${testUser.id}/20000000-0000-4000-8000-0000000000a1`,
    });
  });

  it("hides a kid's generated email and says when they must choose a password", async () => {
    const kid = { id: "10000000-0000-4000-8000-000000000002", email: kidAccountEmail("ana") };
    repositories.family.membership = aKid();
    repositories.account.mustChangePassword.add(kid.id);

    expect(await loadAccount(kid)).toMatchObject({ email: null, signInName: "ana", currency: "EUR", membership: { role: "kid" }, mustChangePassword: true, avatarUrl: null });
  });

  it("uses a currency it is given instead of reading it (the PATCH that just saved it)", async () => {
    const getCurrency = vi.spyOn(repositories.account, "getCurrency");

    expect(await loadAccount(testUser, "USD")).toMatchObject({ currency: "USD" });
    expect(getCurrency).not.toHaveBeenCalled();
  });
});

describe("loadPageAccount", () => {
  it("is null with no session, without reading anything", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
    const getCurrency = vi.spyOn(repositories.account, "getCurrency");

    expect(await loadPageAccount()).toBeNull();
    expect(getCurrency).not.toHaveBeenCalled();
  });

  it("is the signed-in user's account", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(testUser);

    expect(await loadPageAccount()).toEqual(await loadAccount(testUser));
  });
});
