import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { getAuthenticatedUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";
import { aKid, aParent } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { signedInAs } from "@/test/route";

const PRIVATE = "private, no-store, max-age=0";

let repositories: FakeRepositories;
let user: ReturnType<typeof signedInAs>;
const handler = vi.fn(async () => json({ ok: true }));

async function call(options: { failure?: string } = { failure: "Unable to do it." }) {
  const response = await withPermission("investments", "edit", handler, options)();
  expect(response.headers.get("cache-control")).toBe(PRIVATE);
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  repositories = resetFakeRepositories();
  user = signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => vi.unstubAllEnvs());

describe("withPermission", () => {
  it("returns 401 without reading the membership or calling the handler when nobody is signed in", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect(await call()).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(repositories.family.calls).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 without calling the handler when a kid lacks the module", async () => {
    repositories.family.membership = aKid({ permissions: { expenses: "edit", investments: "off", net_worth: "edit", family_finance: "view" } });

    expect(await call()).toEqual({ status: 403, body: { error: "You don't have access to this." } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the handler for a kid with the module", async () => {
    repositories.family.membership = aKid({ permissions: { expenses: "off", investments: "edit", net_worth: "off", family_finance: "off" } });

    expect(await call()).toEqual({ status: 200, body: { ok: true } });
  });

  it("runs the handler for a parent", async () => {
    repositories.family.membership = aParent();

    expect(await call()).toEqual({ status: 200, body: { ok: true } });
  });

  it("runs the handler for a user without a family", async () => {
    expect(await call()).toEqual({ status: 200, body: { ok: true } });
    expect(repositories.family.calls).toEqual(["getMembership"]);
  });

  it("runs the handler without reading the membership while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");
    repositories.family.membership = aKid({ permissions: { expenses: "off", investments: "off", net_worth: "off", family_finance: "off" } });

    expect(await call()).toEqual({ status: 200, body: { ok: true } });
    expect(repositories.family.calls).toEqual([]);
  });

  it("passes the request, user and route context to the handler", async () => {
    const request = new Request("http://localhost/api/test");
    const context = { params: Promise.resolve({ id: "1" }) };

    await withPermission("expenses", "edit", handler)(request, context);

    expect(handler).toHaveBeenCalledWith(request, user, context);
  });

  it("maps a failure to read the membership to the route's failure message", async () => {
    vi.spyOn(repositories.family, "getMembership").mockRejectedValue(new Error("private failure"));

    expect(await call()).toEqual({ status: 500, body: { error: "Unable to do it." } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("maps a DomainError while reading the membership to its status", async () => {
    vi.spyOn(repositories.family, "getMembership").mockRejectedValue(new DomainError("Nope.", 403));

    expect(await call()).toEqual({ status: 403, body: { error: "Nope." } });
  });

  it("lets a membership failure propagate when no failure message is given", async () => {
    vi.spyOn(repositories.family, "getMembership").mockRejectedValue(new Error("boom"));

    await expect(withPermission("investments", "edit", handler)()).rejects.toThrow("boom");
  });
});
