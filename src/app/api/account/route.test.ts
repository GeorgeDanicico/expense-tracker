import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET, PATCH } from "@/app/api/account/route";

let repositories: FakeRepositories;
let user: ReturnType<typeof signedInAs>;

beforeEach(() => {
  repositories = resetFakeRepositories();
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

    expect(response.body).toEqual({ email: user.email, currency: "EUR", features: { family: false } });
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

  it("answers privately, so the account is never cached", async () => {
    const { headers } = await callRoute(GET);

    expect(headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.account, "getCurrency").mockRejectedValue(new Error("private database failure"));

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

    expect(response.body).toEqual({ email: user.email, currency: "USD", features: { family: false } });
  });

  it("returns the family feature as on when FAMILY_ENABLED is true", async () => {
    vi.stubEnv("FAMILY_ENABLED", "true");

    const response = await callRoute(PATCH, { method: "PATCH", body: { currency: "USD" } });

    expect(response.body).toEqual({ email: user.email, currency: "USD", features: { family: true } });
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
