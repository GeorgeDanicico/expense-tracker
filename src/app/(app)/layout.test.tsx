import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountData } from "@/lib/account/types";
import { getAuthenticatedUser } from "@/lib/auth";
import { aKid, aParent } from "@/test/builders";
import { forgetLastActive } from "@/lib/family/last-active";
import { kidAccountEmail } from "@/lib/family/kid-account";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { renderOrRedirect } from "@/test/redirect";
import { ACCOUNT_NOTICES_API_KEY, REMINDERS_SUMMARY_API_KEY } from "@/lib/api/keys";
import { GET as GET_NOTICES } from "@/app/api/account/notices/route";
import { loggedLines } from "@/test/log-lines";
import { callRoute, signedInAs } from "@/test/route";

const request = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), asPageCaller: (fn: () => Promise<unknown>) => fn() }));
const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/navigation", () => import("@/test/redirect"));

import ProtectedLayout from "@/app/(app)/layout";
import { AppShellClient } from "@/app/(app)/app-shell-client";
import { GET } from "@/app/api/account/route";
import { GET as GET_SUMMARY } from "@/app/api/reminders/summary/route";

let repositories: FakeRepositories;

/** Where the layout sent the browser, or the shell it rendered. */
async function gate() {
  const { redirectedTo, rendered } = await renderOrRedirect(() => ProtectedLayout({ children: <p>The page</p> }));
  return { redirectedTo, element: rendered as ReactElement<{ account: AccountData; fallback: Record<string, Promise<unknown>> }> | null };
}

/** What `GET /api/account` answers for the same caller and data. */
const routeAnswer = () => callRoute(GET);

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  logged.length = 0;
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

  it("starts the Reminders badge's count for the shell, the same answer GET /api/reminders/summary gives", async () => {
    signedInAs();
    repositories.family.membership = aParent();
    repositories.reminders.seed();

    const { element } = await gate();

    const summary = await element?.props.fallback[REMINDERS_SUMMARY_API_KEY];
    expect(summary).toEqual((await callRoute(GET_SUMMARY)).body);
    expect(summary).toMatchObject({ due: expect.any(Number), overdue: expect.any(Number) });
  });

  it("leaves the count to the browser when it can't be read, without failing the page", async () => {
    signedInAs();
    repositories.family.membership = aParent();
    vi.spyOn(repositories.reminders, "summary").mockRejectedValue(new Error("private database failure"));

    const { redirectedTo, element } = await gate();

    expect(redirectedTo).toBeNull();
    await expect(element?.props.fallback[REMINDERS_SUMMARY_API_KEY]).resolves.toBeUndefined();
    expect(loggedLines(logged, "server_prefetch_failed")).toEqual([
      expect.objectContaining({ route: "(app) layout", api: "/api/reminders/summary" }),
    ]);
  });

  it("starts the unseen notices for the shell, the same answer GET /api/account/notices gives, only with the family feature on", async () => {
    signedInAs();
    repositories.family.membership = aParent();
    repositories.notices.notices.push({ id: "n1", kind: "removed_from_family", familyName: "Smiths", createdAt: "2026-11-01T09:00:00Z" });

    const { element } = await gate();

    const notices = await element?.props.fallback[ACCOUNT_NOTICES_API_KEY];
    expect(notices).toEqual((await callRoute(GET_NOTICES)).body);
    expect(notices).toMatchObject({ notices: [expect.objectContaining({ familyName: "Smiths" })] });

    vi.stubEnv("FAMILY_ENABLED", "false");
    expect(Object.keys((await gate()).element?.props.fallback ?? {})).toEqual([REMINDERS_SUMMARY_API_KEY]);
  });

  it("throws (to the error boundary) instead of redirecting or rendering when the account can't be read", async () => {
    signedInAs();
    vi.spyOn(repositories.account, "getMustChangePassword").mockRejectedValue(new Error("private database failure"));

    await expect(gate()).rejects.toThrow("private database failure");
    expect((await routeAnswer()).status).toBe(500);
  });
});
