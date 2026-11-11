import { describe, expect, it, vi } from "vitest";

import { loadAfterSessionChange, loginUrl, loginUrlFor, redirectToLoginIfUnauthorized } from "@/lib/api/auth-redirect";

function locationAt(pathname: string, search = "") {
  return { pathname, search, replace: vi.fn() };
}

describe("loginUrlFor", () => {
  it("carries the page and its query to the sign-in page as `next`", () => {
    expect(loginUrlFor({ pathname: "/expenses", search: "?month=2026-10" })).toBe("/login?next=%2Fexpenses%3Fmonth%3D2026-10");
  });

  it.each([
    ["a protocol-relative path", "//evil.test/path"],
    ["a backslash path", "/\\evil.test"],
  ])("sends the dashboard, not %s", (_, pathname) => {
    expect(loginUrlFor({ pathname, search: "" })).toBe("/login?next=%2Fdashboard");
  });
});

describe("loginUrl", () => {
  it("takes a path with its query, as the (app) layout reads it from the proxy's header", () => {
    expect(loginUrl("/todos?view=board")).toBe("/login?next=%2Ftodos%3Fview%3Dboard");
  });

  it("sends the dashboard when there is no path", () => {
    expect(loginUrl(null)).toBe("/login?next=%2Fdashboard");
  });
});

describe("loadAfterSessionChange", () => {
  it("goes with a full page load, so no page the router prefetched under the old session is reused", () => {
    const location = { replace: vi.fn() };
    loadAfterSessionChange("/dashboard", location);
    expect(location.replace).toHaveBeenCalledWith("/dashboard");
  });
});

describe("redirectToLoginIfUnauthorized", () => {
  it("sends the browser to sign in with the page it was on, once however many requests fail", () => {
    const location = locationAt("/todos");

    expect(redirectToLoginIfUnauthorized(401, location)).toBe(true);
    expect(redirectToLoginIfUnauthorized(401, location)).toBe(false);

    expect(location.replace).toHaveBeenCalledTimes(1);
    expect(location.replace).toHaveBeenCalledWith("/login?next=%2Ftodos");
  });

  it.each([400, 403, 404, 429, 500, 504])("ignores a %i", (status) => {
    const location = locationAt("/todos");
    expect(redirectToLoginIfUnauthorized(status, location)).toBe(false);
    expect(location.replace).not.toHaveBeenCalled();
  });

  it.each(["/login", "/join/ABCD2345", "/oauth/consent", "/change-password"])("leaves %s to handle its own 401", (pathname) => {
    const location = locationAt(pathname);
    expect(redirectToLoginIfUnauthorized(401, location)).toBe(false);
    expect(location.replace).not.toHaveBeenCalled();
  });

  it("doesn't mistake a page that only starts with an excluded name for it", () => {
    const location = locationAt("/loginfo");
    expect(redirectToLoginIfUnauthorized(401, location)).toBe(true);
  });

  it("does nothing on the server, where there is no location", () => {
    expect(redirectToLoginIfUnauthorized(401)).toBe(false);
  });
});
