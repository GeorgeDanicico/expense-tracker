import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import { aKid, aParent } from "@/test/builders";
import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET, PATCH } from "@/app/api/account/route";

let repositories: FakeRepositories;
let user: ReturnType<typeof signedInAs>;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  user = signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/account", () => {
  it("returns the signed-in user's email and saved currency", async () => {
    repositories.account.currencies.set(user.id, "RON");

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 200, body: { email: user.email, currency: "RON" } });
  });

  it("returns the default currency when the user has not chosen one", async () => {
    const response = await callRoute(GET);

    expect(response.body).toEqual({ email: user.email, currency: "EUR", features: { family: false }, membership: null, mustChangePassword: false, avatarUrl: null });
  });

  it("reports the family feature as on when FAMILY_ENABLED is true", async () => {
    vi.stubEnv("FAMILY_ENABLED", "true");

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 200, body: { features: { family: true } } });
  });

  it("reports the family feature as off when FAMILY_ENABLED is false", async () => {
    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 200, body: { features: { family: false } } });
  });

  it("reports the family feature as off when FAMILY_ENABLED is not set", async () => {
    vi.stubEnv("FAMILY_ENABLED", undefined);

    const response = await callRoute(GET);

    expect(response.body).toMatchObject({ features: { family: false } });
  });

  it("reports the family feature as off for any value other than true", async () => {
    vi.stubEnv("FAMILY_ENABLED", "TRUE");

    const response = await callRoute(GET);

    expect(response.body).toMatchObject({ features: { family: false } });
  });

  it("returns the URL of the caller's picture", async () => {
    repositories.avatars.paths.set(user.id, `${user.id}/20000000-0000-4000-8000-0000000000a1.webp`);

    const response = await callRoute(GET);

    expect(response).toMatchObject({
      status: 200,
      body: { avatarUrl: `/api/avatars/${user.id}/20000000-0000-4000-8000-0000000000a1` },
    });
  });

  it("returns no picture URL for another user's picture", async () => {
    repositories.avatars.paths.set("10000000-0000-4000-8000-000000000099", "10000000-0000-4000-8000-000000000099/20000000-0000-4000-8000-0000000000a1.webp");

    const response = await callRoute(GET);

    expect(response.body).toMatchObject({ avatarUrl: null });
  });

  it("hides a picture lookup failure behind a generic message", async () => {
    vi.spyOn(repositories.avatars, "getPath").mockRejectedValue(new Error("private database failure"));

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to load account settings." } });
  });

  it("answers privately, so the account is never cached", async () => {
    const { headers } = await callRoute(GET);

    expect(headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.account, "getCurrency").mockRejectedValue(new Error("private database failure"));

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to load account settings." } });
  });

  it("returns no membership, without asking for one, while the family flag is off", async () => {
    repositories.family.membership = aParent();

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 200, body: { membership: null } });
    expect(repositories.family.calls).toEqual([]);
  });

  it("returns no membership when the user has no family", async () => {
    vi.stubEnv("FAMILY_ENABLED", "true");

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 200, body: { membership: null } });
    expect(repositories.family.calls).toEqual(["touchLastActive", "getMembership"]);
  });

  it("returns a parent's membership with full permissions and only their own member id", async () => {
    vi.stubEnv("FAMILY_ENABLED", "true");
    repositories.family.membership = aParent({ familyName: "The Smiths" });

    const response = await callRoute(GET);

    expect(response.body).toMatchObject({
      membership: {
        memberId: "60000000-0000-4000-8000-000000000001",
        role: "parent",
        isCreator: true,
        familyName: "The Smiths",
        permissions: PARENT_PERMISSIONS,
      },
    });
    expect(Object.keys((response.body as { membership: object }).membership).sort()).toEqual([
      "familyName",
      "isCreator",
      "memberId",
      "permissions",
      "role",
    ]);
  });

  it("returns a kid's membership with their own permissions", async () => {
    vi.stubEnv("FAMILY_ENABLED", "true");
    const permissions = { expenses: "edit", investments: "off", net_worth: "edit", family_finance: "off", mcp: "off", ai: "off" } as const;
    repositories.family.membership = aKid({ permissions });

    const response = await callRoute(GET);

    expect(response.body).toMatchObject({
      membership: { memberId: "60000000-0000-4000-8000-000000000002", role: "kid", isCreator: false, familyName: "The Smiths", permissions },
    });
  });

  it("reports that the user must change their password while the flag is set", async () => {
    repositories.account.mustChangePassword.add(user.id);

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 200, body: { mustChangePassword: true } });
  });

  it("reports the password flag while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");
    repositories.account.mustChangePassword.add(user.id);

    const response = await callRoute(GET);

    expect(response.body).toMatchObject({ features: { family: false }, mustChangePassword: true });
  });

  it("reports no password change for another user's flag", async () => {
    repositories.account.mustChangePassword.add("10000000-0000-4000-8000-000000000099");

    const response = await callRoute(GET);

    expect(response.body).toMatchObject({ mustChangePassword: false });
  });

  it("hides a password flag failure behind a generic message", async () => {
    vi.spyOn(repositories.account, "getMustChangePassword").mockRejectedValue(new Error("private database failure"));

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to load account settings." } });
  });

  it("hides a membership failure behind a generic message", async () => {
    vi.stubEnv("FAMILY_ENABLED", "true");
    vi.spyOn(repositories.family, "getMembership").mockRejectedValue(new Error("private database failure"));

    const response = await callRoute(GET);

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to load account settings." } });
  });
});

describe("PATCH /api/account", () => {
  it("saves a supported currency and returns the updated account", async () => {
    const response = await callRoute(PATCH, { method: "PATCH", body: { currency: "USD" } });

    expect(response).toMatchObject({ status: 200, body: { email: user.email, currency: "USD" } });
    expect(repositories.account.currencies.get(user.id)).toBe("USD");
  });

  it("returns the family feature as off when FAMILY_ENABLED is false", async () => {
    const response = await callRoute(PATCH, { method: "PATCH", body: { currency: "USD" } });

    expect(response.body).toEqual({ email: user.email, currency: "USD", features: { family: false }, membership: null, mustChangePassword: false, avatarUrl: null });
  });

  it("returns the family feature as on when FAMILY_ENABLED is true", async () => {
    vi.stubEnv("FAMILY_ENABLED", "true");

    const response = await callRoute(PATCH, { method: "PATCH", body: { currency: "USD" } });

    expect(response.body).toEqual({ email: user.email, currency: "USD", features: { family: true }, membership: null, mustChangePassword: false, avatarUrl: null });
  });

  it("returns the membership with the updated account", async () => {
    vi.stubEnv("FAMILY_ENABLED", "true");
    repositories.family.membership = aKid();

    const response = await callRoute(PATCH, { method: "PATCH", body: { currency: "USD" } });

    expect(response.body).toMatchObject({
      currency: "USD",
      membership: { role: "kid", isCreator: false, familyName: "The Smiths", permissions: aKid().permissions },
    });
  });

  it("returns no membership, without asking for one, while the family flag is off", async () => {
    repositories.family.membership = aKid();

    const response = await callRoute(PATCH, { method: "PATCH", body: { currency: "USD" } });

    expect(response.body).toMatchObject({ membership: null });
    expect(repositories.family.calls).toEqual([]);
  });

  it("returns the password flag with the updated account", async () => {
    repositories.account.mustChangePassword.add(user.id);

    const response = await callRoute(PATCH, { method: "PATCH", body: { currency: "USD" } });

    expect(response.body).toMatchObject({ currency: "USD", mustChangePassword: true });
  });

  it("rejects an unsupported currency without saving it", async () => {
    const response = await callRoute(PATCH, { method: "PATCH", body: { currency: "XYZ" } });

    expect(response).toMatchObject({ status: 422, body: { error: "Choose a supported currency." } });
    expect(repositories.account.currencies.size).toBe(0);
  });

  it("rejects a malformed body as an unsupported currency", async () => {
    const response = await callRoute(PATCH, { method: "PATCH", body: "{" });

    expect(response).toMatchObject({ status: 422, body: { error: "Choose a supported currency." } });
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.account, "updateCurrency").mockRejectedValue(new Error("private database failure"));

    const response = await callRoute(PATCH, { method: "PATCH", body: { currency: "USD" } });

    expect(response).toMatchObject({ status: 500, body: { error: "The currency could not be saved. Please try again." } });
  });
});
