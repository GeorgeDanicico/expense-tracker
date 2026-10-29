import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  createClient: vi.fn(),
  cookies: vi.fn(),
  readFeed: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: mocks.cookies }));
vi.mock("@/lib/repositories", () => ({ getRepositories: () => ({ calendarFeeds: { read: mocks.readFeed } }) }));

const API_DIR = fileURLToPath(new URL(".", import.meta.url));
const ID = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";
const HTTP_METHODS = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"];

// Routes that authenticate in their own way and are covered by their own tests.
const PUBLIC_ROUTES = ["auth", "auth/google", "calendar/feed/[token]", "mcp"];

// Every other route handler must reject anonymous requests. Adding a route
// under src/app/api means adding it here, so a route without auth fails below.
const PROTECTED_ROUTES: Record<string, string[]> = {
  account: ["GET", "PATCH"],
  "account/avatar": ["DELETE", "PUT"],
  "account/email": ["PATCH"],
  "account/mcp": ["GET", "PATCH"],
  "account/mcp/apps": ["GET"],
  "account/mcp/apps/[clientId]": ["DELETE"],
  "account/mcp/tokens": ["POST"],
  "account/mcp/tokens/[id]": ["DELETE"],
  "account/mcp/tokens/[id]/regenerate": ["POST"],
  "account/notices": ["GET"],
  "account/notices/[id]/dismiss": ["POST"],
  "account/password": ["POST"],
  "avatars/[userId]/[file]": ["GET"],
  "calendar/events": ["GET", "POST"],
  "calendar/events/[id]": ["DELETE", "GET", "PATCH"],
  "calendar/feed-link": ["DELETE", "GET", "POST"],
  dashboard: ["GET"],
  "expense-tabs": ["GET", "POST"],
  "expense-tabs/[id]": ["DELETE", "PATCH"],
  "expense-tabs/[id]/expenses": ["GET"],
  expenses: ["GET", "POST"],
  "expenses/[id]": ["DELETE"],
  "expenses/export": ["GET"],
  family: ["DELETE", "GET", "POST"],
  "family/invites": ["GET", "POST"],
  "family/invites/[id]": ["DELETE"],
  "family/join": ["POST"],
  "family/join/preview": ["POST"],
  "family/kids": ["POST"],
  "family/members/[id]": ["DELETE"],
  "family/members/[id]/color": ["PATCH"],
  "family/members/[id]/password": ["POST"],
  "family/members/[id]/permissions": ["PATCH"],
  imports: ["GET", "POST"],
  "imports/[id]": ["DELETE", "GET"],
  "imports/[id]/confirm": ["POST"],
  "imports/[id]/undo": ["POST"],
  investments: ["GET"],
  "investment-transactions": ["GET", "POST"],
  "investment-transactions/[id]": ["DELETE"],
  "net-worth": ["GET"],
  "net-worth/items": ["POST"],
  "net-worth/items/[id]": ["PATCH"],
  "net-worth/items/[id]/valuations": ["POST"],
  "net-worth/valuations/[id]": ["PATCH"],
  "notifications/push-key": ["GET"],
  "notifications/push-subscriptions": ["DELETE", "POST"],
  "notifications/settings": ["GET", "PATCH"],
  "notifications/test": ["POST"],
  "oauth/authorizations/[id]": ["GET"],
  "oauth/authorizations/[id]/approve": ["POST"],
  "oauth/authorizations/[id]/deny": ["POST"],
  reminders: ["GET", "POST"],
  "reminders/[id]": ["DELETE", "PATCH"],
  "reminders/[id]/complete": ["POST"],
  "reminders/[id]/snooze": ["POST"],
  "reminders/summary": ["GET"],
  todos: ["GET", "POST"],
  "todos/[id]": ["DELETE", "PATCH"],
  "todos/[id]/move": ["POST"],
};

type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

function discoverRoutes() {
  return readdirSync(API_DIR, { recursive: true, encoding: "utf8" })
    .map((file) => file.split("\\").join("/"))
    .filter((file) => file === "route.ts" || file.endsWith("/route.ts"))
    .map((file) => file.slice(0, -"/route.ts".length));
}

async function loadHandlers(route: string) {
  const routeModule = (await import(join(API_DIR, route, "route.ts"))) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(routeModule).filter(([name]) => HTTP_METHODS.includes(name)),
  ) as Record<string, Handler>;
}

const cases = Object.entries(PROTECTED_ROUTES).flatMap(([route, methods]) => methods.map((method) => [method, route] as const));

describe("protected REST routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    mocks.createClient.mockRejectedValue(new Error("Supabase must not be reached without a user"));
  });

  it("lists every route handler under src/app/api", () => {
    const protectedRoutes = discoverRoutes().filter((route) => !PUBLIC_ROUTES.includes(route));
    expect(protectedRoutes.sort()).toEqual(Object.keys(PROTECTED_ROUTES).sort());
  });

  it.each(Object.keys(PROTECTED_ROUTES))("lists every method exported by /api/%s", async (route) => {
    expect(Object.keys(await loadHandlers(route)).sort()).toEqual([...PROTECTED_ROUTES[route]].sort());
  });

  it.each(cases)("rejects an anonymous %s /api/%s with 401", async (method, route) => {
    const handler = (await loadHandlers(route))[method];
    const url = `http://localhost/api/${route.replaceAll(/\[\w+\]/g, ID)}`;
    const response = await handler(new NextRequest(url, { method }), { params: Promise.resolve({ id: ID }) });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(mocks.getAuthenticatedUser).toHaveBeenCalledOnce();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  // The calendar feed is read by a calendar app with no session: its secret in the path is the only
  // credential, so it must answer without touching cookies, the signed-in user or the caller's client.
  describe("the public calendar feed", () => {
    const TOKEN = `sl_cal_${"A".repeat(43)}`;
    let GET_FEED: (request: NextRequest, context: { params: Promise<{ token: string }> }) => Promise<Response>;

    function fetchFeed(token: string) {
      const request = new NextRequest(`http://localhost/api/calendar/feed/${token}.ics`, {
        headers: { cookie: "sb-access-token=session" },
      });
      const cookiesRead = vi.fn();
      Object.defineProperty(request, "cookies", { get: cookiesRead });
      return { cookiesRead, response: GET_FEED(request, { params: Promise.resolve({ token: `${token}.ics` }) }) };
    }
    beforeEach(async () => {
      GET_FEED = (await import("@/app/api/calendar/feed/[token]/route")).GET;
    });

    it.each([
      ["a feed", async () => ({ familyName: "The Danicicos", events: [] }), 200],
      ["an unknown token", async () => null, 404],
    ])("answers %s without reading cookies or a session", async (_name, read, status) => {
      mocks.readFeed.mockImplementation(read);
      const { cookiesRead, response } = fetchFeed(TOKEN);

      expect((await response).status).toBe(status);
      expect(mocks.readFeed).toHaveBeenCalledOnce();
      expect(cookiesRead).not.toHaveBeenCalled();
      expect(mocks.cookies).not.toHaveBeenCalled();
      expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
      expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it("answers a malformed token with 404 before reaching the database", async () => {
      const { cookiesRead, response } = fetchFeed("not-a-token");

      expect((await response).status).toBe(404);
      expect(mocks.readFeed).not.toHaveBeenCalled();
      expect(cookiesRead).not.toHaveBeenCalled();
      expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
    });
  });
});
