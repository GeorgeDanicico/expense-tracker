import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs, testUser } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET, PATCH } from "@/app/api/account/ai/route";

const NOT_PERMITTED = "A parent needs to turn on AI features for you.";
const FAMILY_ID = "50000000-0000-4000-8000-000000000001";

let repositories: FakeRepositories;

const settings = () => callRoute(GET, { url: "/api/account/ai" });
const setSwitch = (body: unknown) => callRoute(PATCH, { method: "PATCH", url: "/api/account/ai", body });

beforeEach(() => {
  repositories = resetFakeRepositories();
  signedInAs();
  vi.stubEnv("AI_PROVIDER", "openai");
});

describe("GET /api/account/ai", () => {
  it("answers 401 when signed out", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
    expect(await settings()).toMatchObject({ status: 401 });
  });

  it("starts switched off, with the provider, no-store", async () => {
    const response = await settings();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.body).toEqual({ enabled: false, blockReason: null, provider: "openai" });
  });

  it("names no provider when AI_PROVIDER is unset or unknown", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    expect((await settings()).body).toMatchObject({ provider: null });
    vi.stubEnv("AI_PROVIDER", "mystery");
    expect((await settings()).body).toMatchObject({ provider: null });
  });

  it("says a kid without the permission is switched off and blocked", async () => {
    repositories.aiGate.setUser(testUser.id, { familyId: FAMILY_ID, role: "kid", kidAiPermission: false });
    expect((await settings()).body).toEqual({ enabled: false, blockReason: "not_permitted", provider: "openai" });
  });

  it("shows a kid with the permission as usable", async () => {
    repositories.aiGate.setUser(testUser.id, { familyId: FAMILY_ID, role: "kid", kidAiPermission: true });
    expect((await settings()).body).toEqual({ enabled: false, blockReason: null, provider: "openai" });
  });
});

describe("PATCH /api/account/ai", () => {
  it("answers 401 when signed out", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
    expect(await setSwitch({ enabled: true })).toMatchObject({ status: 401 });
  });

  it("lets an adult turn it on and off, answering the new settings", async () => {
    expect(await setSwitch({ enabled: true })).toMatchObject({ status: 200, body: { enabled: true } });
    expect(repositories.aiGate.users.get(testUser.id)?.optedIn).toBe(true);
    expect(await setSwitch({ enabled: false })).toMatchObject({ status: 200, body: { enabled: false } });
    expect(repositories.aiGate.users.get(testUser.id)?.optedIn).toBe(false);
  });

  it("refuses a body that isn't a boolean", async () => {
    expect(await setSwitch({ enabled: "yes" })).toMatchObject({ status: 422 });
    expect(await setSwitch({})).toMatchObject({ status: 422 });
    expect(repositories.aiGate.calls).not.toContain("setOptIn");
  });

  it("refuses a kid without the ai permission, and leaves the switch off", async () => {
    repositories.aiGate.setUser(testUser.id, { familyId: FAMILY_ID, role: "kid", kidAiPermission: false });
    expect(await setSwitch({ enabled: true })).toMatchObject({ status: 403, body: { error: NOT_PERMITTED } });
    expect(repositories.aiGate.users.get(testUser.id)?.optedIn).toBe(false);
    expect((await settings()).body).toMatchObject({ enabled: false, blockReason: "not_permitted" });
  });

  it("lets a kid with the permission turn it on", async () => {
    repositories.aiGate.setUser(testUser.id, { familyId: FAMILY_ID, role: "kid", kidAiPermission: true });
    expect(await setSwitch({ enabled: true })).toMatchObject({ status: 200, body: { enabled: true, blockReason: null } });
  });

  it("turns a kid's switch off when their parent turns the permission off", async () => {
    repositories.aiGate.setUser(testUser.id, { familyId: FAMILY_ID, role: "kid", kidAiPermission: true });
    await setSwitch({ enabled: true });
    expect((await settings()).body).toMatchObject({ enabled: true });

    repositories.aiGate.setKidAiPermission(testUser.id, false);

    expect((await settings()).body).toEqual({ enabled: false, blockReason: "not_permitted", provider: "openai" });
    expect(repositories.aiGate.users.get(testUser.id)?.optedIn).toBe(false);

    // Turning the permission back on does not turn the switch back on: it is the kid's to choose.
    repositories.aiGate.setKidAiPermission(testUser.id, true);
    expect((await settings()).body).toMatchObject({ enabled: false, blockReason: null });
  });
});
