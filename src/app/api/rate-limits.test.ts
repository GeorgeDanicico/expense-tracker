import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import {
  ANONYMOUS_MAX_REQUESTS,
  resetRateLimits,
  TOO_MANY_REQUESTS,
  USER_READ_MAX_REQUESTS,
  USER_WRITE_MAX_REQUESTS,
} from "@/lib/http/rate-limit";
import { FakeAuth, FakeAuthAdmin } from "@/test/fakes/auth";
import { resetFakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

// Request limits on every kind of route (security plan S11, audit P8), through the real handlers.
// The limiter itself is tested in src/lib/http/rate-limit.test.ts and the wrappers in
// src/lib/http/route.test.ts; the MCP route's and the CSP report's limits in their own route tests.

let auth: FakeAuth;
vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: vi.fn(),
  getAuth: () => auth,
  getAuthAdmin: () => new FakeAuthAdmin(auth),
}));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { POST as signIn } from "@/app/api/auth/route";
import { GET as readNotices } from "@/app/api/account/notices/route";
import { POST as dismissNotice } from "@/app/api/account/notices/[id]/dismiss/route";
import { GET as calendarFeed } from "@/app/api/calendar/feed/[token]/route";

const ID = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";
const tooMany = { status: 429, body: { error: TOO_MANY_REQUESTS } };

beforeEach(() => {
  auth = new FakeAuth();
  forgetLastActive();
  resetRateLimits();
  resetFakeRepositories();
  signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const read = () => callRoute(readNotices);
const write = () => callRoute(dismissNotice, { method: "POST", params: { id: ID } });
const feed = (ip = "203.0.113.7") =>
  callRoute(calendarFeed, { url: "/api/calendar/feed/unknown.ics", headers: { "X-Forwarded-For": ip }, params: { token: "unknown.ics" } });
const attemptSignIn = (ip = "203.0.113.7", email = "owner@example.test") =>
  callRoute(signIn, { method: "POST", url: "/api/auth", body: { mode: "login", email, password: "correct-horse" }, headers: { "X-Forwarded-For": ip } });

describe("a burst", () => {
  it("gets 429 with Retry-After on a signed-in read, past 600 a minute", async () => {
    for (let sent = 0; sent < USER_READ_MAX_REQUESTS; sent += 1) expect((await read()).status).toBe(200);

    const limited = await read();

    expect(limited).toMatchObject(tooMany);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("gets 429 with Retry-After on a signed-in write, past 120 a minute", async () => {
    for (let sent = 0; sent < USER_WRITE_MAX_REQUESTS; sent += 1) expect((await write()).status).toBe(404);

    const limited = await write();

    expect(limited).toMatchObject(tooMany);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("gets 429 with Retry-After on an anonymous route (the calendar feed), per IP, past 60 a minute", async () => {
    for (let sent = 0; sent < ANONYMOUS_MAX_REQUESTS; sent += 1) expect((await feed()).status).toBe(404);

    const limited = await feed();

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await feed("203.0.113.8")).status).toBe(404);
  });

  it("gets 429 on sign-in, past 60 a minute from one IP, and a made-up first X-Forwarded-For hop doesn't reset it", async () => {
    for (let sent = 0; sent < ANONYMOUS_MAX_REQUESTS; sent += 1) {
      await attemptSignIn(`198.51.100.${sent}, 203.0.113.7`, `someone${sent}@example.test`);
    }

    const limited = await attemptSignIn("198.51.100.250, 203.0.113.7", "someone-else@example.test");

    expect(limited).toMatchObject(tooMany);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("normal use", () => {
  it("never reaches a limit: a dozen page loads and a few dozen edits in a minute", async () => {
    for (let load = 0; load < 12; load += 1) {
      for (let request = 0; request < 8; request += 1) expect((await read()).status).toBe(200);
    }
    for (let edit = 0; edit < 40; edit += 1) expect((await write()).status).toBe(404);
    expect((await read()).status).toBe(200);
  });

  it("never limits a calendar app polling its feed, or a household signing in", async () => {
    for (let poll = 0; poll < 10; poll += 1) expect((await feed()).status).toBe(404);
    auth.addUser("owner@example.test", "correct-horse");
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await attemptSignIn()).status).toBe(200);
  });
});

describe("every route", () => {
  const APP_DIR = fileURLToPath(new URL("../", import.meta.url));
  /** The route files that apply a request limit some other way than a wrapper, with where it is. */
  const OWN_LIMITS: Record<string, string> = {
    "api/mcp/route.ts": "mcpIpRequests",
    "api/csp-report/route.ts": "cspReportAttempts",
    // The deploy's health check: no data, no session, and the container's own probe calls it often.
    "health/route.ts": "",
  };
  const WRAPPERS = ["withUser(", "withPermission(", "withParent(", "withRequestGuard(", "withAnonymousLimit("];

  const routeFiles = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
    .map((file) => file.split("\\").join("/"))
    .filter((file) => file === "route.ts" || file.endsWith("/route.ts"));

  it("finds the route files", () => {
    expect(routeFiles.length).toBeGreaterThan(60);
  });

  it.each(routeFiles)("%s has a request limit", (file) => {
    const source = readFileSync(join(APP_DIR, file), "utf8");
    const own = OWN_LIMITS[file];
    if (own !== undefined) {
      expect(source, `${file} lists ${own} as its limit`).toContain(own);
    } else {
      expect(WRAPPERS.some((wrapper) => source.includes(wrapper)), `${file} uses a route wrapper that limits requests`).toBe(true);
    }
  });
});
