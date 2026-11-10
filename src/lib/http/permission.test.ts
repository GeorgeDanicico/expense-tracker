import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { getAuthenticatedUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { requirePermission, withParent, withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";
import { aKid, aParent } from "@/test/builders";
import { forgetLastActive } from "@/lib/family/last-active";
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
  forgetLastActive();
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
    repositories.family.membership = aKid({ permissions: { expenses: "edit", investments: "off", net_worth: "edit", family_finance: "view", mcp: "off", ai: "off" } });

    expect(await call()).toEqual({ status: 403, body: { error: "You don't have access to this." } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the handler for a kid with the module", async () => {
    repositories.family.membership = aKid({ permissions: { expenses: "off", investments: "edit", net_worth: "off", family_finance: "off", mcp: "off", ai: "off" } });

    expect(await call()).toEqual({ status: 200, body: { ok: true } });
  });

  it("runs the handler for a parent", async () => {
    repositories.family.membership = aParent();

    expect(await call()).toEqual({ status: 200, body: { ok: true } });
  });

  it("runs the handler for a user without a family", async () => {
    expect(await call()).toEqual({ status: 200, body: { ok: true } });
    expect(repositories.family.calls).toEqual(["touchLastActive", "getMembership"]);
  });

  it("runs the handler without reading the membership while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");
    repositories.family.membership = aKid({ permissions: { expenses: "off", investments: "off", net_worth: "off", family_finance: "off", mcp: "off", ai: "off" } });

    expect(await call()).toEqual({ status: 200, body: { ok: true } });
    expect(repositories.family.calls).toEqual([]);
  });

  it("passes the request, user and route context to the handler", async () => {
    const request = new Request("http://localhost/api/test");
    const context = { params: Promise.resolve({ id: "1" }) };

    await withPermission("expenses", "edit", handler)(request, context);

    expect(handler).toHaveBeenCalledWith(request, user, context, null);
  });

  it("passes the membership it checked to the handler, without reading it twice", async () => {
    const kid = aKid({ permissions: { expenses: "off", investments: "edit", net_worth: "off", family_finance: "off", mcp: "off", ai: "off" } });
    repositories.family.membership = kid;

    await call();

    expect(handler).toHaveBeenCalledWith(undefined, user, undefined, kid);
    expect(repositories.family.calls).toEqual(["touchLastActive", "getMembership"]);
  });

  it("starts reading the membership before the password check answers, not after it (PF4)", async () => {
    let answerPasswordCheck: (flagged: boolean) => void = () => undefined;
    vi.spyOn(repositories.account, "getMustChangePassword").mockReturnValue(new Promise((resolve) => (answerPasswordCheck = resolve)));

    const response = call();
    await vi.waitFor(() => expect(repositories.family.calls).toContain("getMembership"));
    expect(handler).not.toHaveBeenCalled();
    answerPasswordCheck(false);

    expect(await response).toEqual({ status: 200, body: { ok: true } });
    expect(repositories.family.calls.filter((name) => name === "getMembership")).toHaveLength(1);
  });

  it("still refuses an account that must change its password, though its membership was read alongside", async () => {
    repositories.family.membership = aParent();
    repositories.account.mustChangePassword.add(user.id);

    expect(await call()).toMatchObject({ status: 403, body: { code: "password_change_required" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers the password check first when the membership read fails alongside it", async () => {
    vi.spyOn(repositories.family, "getMembership").mockRejectedValue(new Error("private failure"));
    repositories.account.mustChangePassword.add(user.id);

    expect(await call()).toMatchObject({ status: 403, body: { code: "password_change_required" } });
  });

  it("maps a failure to read the membership to the route's failure message", async () => {
    vi.spyOn(repositories.family, "getMembership").mockRejectedValue(new Error("private failure"));

    expect(await call()).toEqual({ status: 500, body: { error: "Unable to do it.", requestId: expect.any(String) } });
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

describe("withParent", () => {
  async function callAsParentOnly() {
    const response = await withParent(handler, { failure: "Unable to do it." })();
    return { status: response.status, body: await response.json() };
  }

  it("refuses a kid with the one forbidden message, without calling the handler", async () => {
    repositories.family.membership = aKid();

    expect(await callAsParentOnly()).toEqual({ status: 403, body: { error: "You don't have access to this." } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a user without a family the same way", async () => {
    expect(await callAsParentOnly()).toEqual({ status: 403, body: { error: "You don't have access to this." } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 404 without reading the membership while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");
    repositories.family.membership = aParent();

    expect(await callAsParentOnly()).toEqual({ status: 404, body: { error: "Not found." } });
    expect(repositories.family.calls).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the handler for a parent who isn't the creator, passing the membership", async () => {
    const parent = aParent({ isCreator: false });
    repositories.family.membership = parent;

    expect(await callAsParentOnly()).toEqual({ status: 200, body: { ok: true } });
    expect(handler).toHaveBeenCalledWith(undefined, user, undefined, parent);
  });
});

describe("requirePermission", () => {
  it("returns the membership it checked", async () => {
    const kid = aKid();
    repositories.family.membership = kid;

    await expect(requirePermission("expenses", "edit")).resolves.toEqual(kid);
  });

  it("throws the one forbidden message for a kid without the module", async () => {
    repositories.family.membership = aKid();

    await expect(requirePermission("investments", "edit"))
      .rejects.toEqual(new DomainError("You don't have access to this.", 403));
  });
});
