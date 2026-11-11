import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountData } from "@/lib/account/types";
import { getAuthenticatedUser } from "@/lib/auth";
import { aKid, aParent } from "@/test/builders";
import { forgetLastActive } from "@/lib/family/last-active";
import { kidAccountEmail } from "@/lib/family/kid-account";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { renderOrRedirect } from "@/test/redirect";
import { callRoute, signedInAs } from "@/test/route";

const request = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), asPageCaller: (fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/navigation", () => import("@/test/redirect"));

import ProtectedLayout from "@/app/(app)/layout";
import { AppShellClient } from "@/app/(app)/app-shell-client";
import { GET } from "@/app/api/account/route";

let repositories: FakeRepositories;

/** Where the layout sent the browser, or the shell it rendered. */
async function gate() {
  const { redirectedTo, rendered } = await renderOrRedirect(() => ProtectedLayout({ children: <p>The page</p> }));
  return { redirectedTo, element: rendered as ReactElement<{ account: AccountData }> | null };
}

/** What `GET /api/account` answers for the same caller and data. */
const routeAnswer = () => callRoute(GET);

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  request.headers = new Headers({ "x-page-path": "/expenses?month=2026-10" });
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the (app) layout's session gate", () => {
  it("sends a visitor with no session to sign in, coming back to the page and query they asked for", async () => {
    // Signed out, an expired session whose refresh failed and a deleted account all look the same
    // here: `getClaims` finds no user, so `getAuthenticatedUser` is null, as it is for the route.
    expect((await gate()).redirectedTo).toBe("/login?next=%2Fexpenses%3Fmonth%3D2026-10");
    expect((await routeAnswer()).status).toBe(401);
  });

  it("falls back to Home as `next` when the path is missing or not a same-site path", async () => {
    request.headers = new Headers();
    expect((await gate()).redirectedTo).toBe("/login?next=%2Fdashboard");

    request.headers = new Headers({ "x-page-path": "//evil.test/dashboard" });
    expect((await gate()).redirectedTo).toBe("/login?next=%2Fdashboard");

    request.headers = new Headers({ "x-page-path": "/\\evil.test" });
    expect((await gate()).redirectedTo).toBe("/login?next=%2Fdashboard");
  });

  it("sends an account that must choose a new password to the change-password page", async () => {
    const user = signedInAs();
    repositories.family.membership = aParent();
    repositories.account.mustChangePassword.add(user.id);

    expect((await gate()).redirectedTo).toBe("/change-password");
    expect((await routeAnswer()).body).toMatchObject({ mustChangePassword: true });
  });

  it("sends a kid on their first sign-in (the temporary password) to the change-password page", async () => {
    const kid = signedInAs({ id: "10000000-0000-4000-8000-000000000002", email: kidAccountEmail("ana") });
    repositories.family.membership = aKid();
    repositories.account.mustChangePassword.add(kid.id);

    expect((await gate()).redirectedTo).toBe("/change-password");
  });

  it("lets a kid in once the new password is chosen, with the account the route gives", async () => {
    signedInAs({ id: "10000000-0000-4000-8000-000000000002", email: kidAccountEmail("ana") });
    repositories.family.membership = aKid();

    const { redirectedTo, element } = await gate();

    expect(redirectedTo).toBeNull();
    expect(element?.props.account).toEqual((await routeAnswer()).body);
    expect(element?.props.account).toMatchObject({ email: null, signInName: "ana", membership: { role: "kid" } });
  });

  it("renders the shell with the account in it, exactly what GET /api/account answers", async () => {
    const user = signedInAs();
    repositories.family.membership = aParent();
    repositories.account.currencies.set(user.id, "RON");
    repositories.avatars.paths.set(user.id, `${user.id}/20000000-0000-4000-8000-0000000000a1.webp`);

    const { redirectedTo, element } = await gate();

    expect(redirectedTo).toBeNull();
    expect(isValidElement(element) && element.type).toBe(AppShellClient);
    expect(element?.props.account).toEqual((await routeAnswer()).body);
    expect(element?.props.account).toMatchObject({ currency: "RON", membership: { role: "parent" }, mustChangePassword: false });
  });

  it("lets a member removed from a family in, with no membership, as the route does", async () => {
    signedInAs();
    repositories.family.membership = null;

    const { redirectedTo, element } = await gate();

    expect(redirectedTo).toBeNull();
    expect(element?.props.account.membership).toBeNull();
    expect(element?.props.account).toEqual((await routeAnswer()).body);
  });

  it("throws (to the error boundary) instead of redirecting or rendering when the account can't be read", async () => {
    signedInAs();
    vi.spyOn(repositories.account, "getMustChangePassword").mockRejectedValue(new Error("private database failure"));

    await expect(gate()).rejects.toThrow("private database failure");
    expect((await routeAnswer()).status).toBe(500);
  });
});
