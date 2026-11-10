import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import { FORBIDDEN_MESSAGE } from "@/lib/http/permission";
import { resetRateLimits } from "@/lib/http/rate-limit";
import { createMcpServer } from "@/lib/mcp/server";
import { MODULE_KEYS, type ModuleKey, type Permissions } from "@/lib/permissions";
import { aKid, aParent } from "@/test/builders";
import { FakeAuth, FakeAuthAdmin } from "@/test/fakes/auth";
import { FakeOAuthConsent } from "@/test/fakes/oauth-consent";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { ROUTE_ACCESS, TOOL_MODULES, type Access } from "@/test/permissions";
import { signedInAs } from "@/test/route";

// The one permission list (security plan S9, audit D5) against the real handlers and tools. The list
// itself, with what each entry means, is src/test/permissions.ts.

const mocks = vi.hoisted(() => ({ accessed: [] as string[], auth: null as unknown, consent: null as unknown, admin: null as unknown }));
vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: vi.fn(),
  getAuth: () => mocks.auth,
  getAuthAdmin: () => mocks.admin,
  getOAuthConsent: () => mocks.consent,
}));
// Records which repositories a request touches, so a refusal can be shown to stop before the handler.
vi.mock("@/lib/repositories", async () => {
  const fakes = await import("@/test/fakes/repositories");
  return {
    ...fakes,
    getRepositories: () => new Proxy(fakes.getRepositories(), {
      get(target, key, receiver) {
        mocks.accessed.push(String(key));
        return Reflect.get(target, key, receiver);
      },
    }),
  };
});
vi.mock("@/lib/investments/quotes/get-adapter", () => ({
  getInvestmentQuoteAdapter: () => ({ getQuotes: async () => new Map() }),
}));

const API_DIR = fileURLToPath(new URL(".", import.meta.url));
const ID = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";
const HTTP_METHODS = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"];

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

function discoverRoutes() {
  return readdirSync(API_DIR, { recursive: true, encoding: "utf8" })
    .map((file) => file.split("\\").join("/"))
    .filter((file) => file === "route.ts" || file.endsWith("/route.ts"))
    .map((file) => file.slice(0, -"/route.ts".length));
}

async function loadHandlers(route: string) {
  const routeModule = (await import(join(API_DIR, route, "route.ts"))) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(routeModule).filter(([name]) => HTTP_METHODS.includes(name))) as Record<string, Handler>;
}

function split(key: string) {
  const [method, path] = key.split(" ");
  return { method, route: path.slice("/api/".length) };
}

/** Calls `METHOD /api/path` like the app's own pages do; a handler that throws counts as answering 500. */
async function call(key: string, body?: unknown) {
  const { method, route } = split(key);
  const handler = (await loadHandlers(route))[method];
  const url = `http://localhost/api/${route.replaceAll(/\[\w+\]/g, ID)}`;
  const request = new NextRequest(url, {
    method,
    headers: { "sec-fetch-site": "same-origin", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const params = Promise.resolve(Object.fromEntries(["id", "clientId", "userId", "file", "token"].map((name) => [name, ID])));
  try {
    const response = await handler(request, { params });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { status: 500, body: null };
  }
}

/** A kid with every module on except `off`, or with only `only` on (or none at all). */
function kidWith({ off, only }: { off?: ModuleKey; only?: ModuleKey | "nothing" }) {
  const permissions = Object.fromEntries(MODULE_KEYS.map((key) => {
    const on = only ? key === only : key !== off;
    return [key, on ? (key === "family_finance" ? "view" : "edit") : "off"];
  })) as Permissions;
  return aKid({ permissions });
}

const REFUSED = { status: 403, body: { error: FORBIDDEN_MESSAGE } };

function entries<A extends Access["access"]>(kind: A) {
  return Object.entries(ROUTE_ACCESS)
    .filter((entry): entry is [string, Extract<Access, { access: A }>] => entry[1].access === kind);
}

let repositories: FakeRepositories;

beforeEach(() => {
  mocks.accessed.length = 0;
  repositories = resetFakeRepositories();
  const auth = new FakeAuth();
  mocks.auth = auth;
  mocks.admin = new FakeAuthAdmin(auth);
  mocks.consent = new FakeOAuthConsent(auth);
  forgetLastActive();
  resetRateLimits();
  signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the permission list", () => {
  it("lists every route handler under src/app/api, method by method", async () => {
    const found: string[] = [];
    for (const route of discoverRoutes()) {
      for (const method of Object.keys(await loadHandlers(route))) found.push(`${method} /api/${route}`);
    }
    expect(found.sort()).toEqual(Object.keys(ROUTE_ACCESS).sort());
  });

  it("lists every MCP tool", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([createMcpServer({ userId: "owner", email: "owner@example.com" }).connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(TOOL_MODULES).sort());
  });

  it("gives every public route a reason", () => {
    for (const [key, access] of entries("public")) expect(access.reason.length, key).toBeGreaterThan(20);
  });
});

describe("routes behind withPermission", () => {
  const cases = entries("module").map(([key, { module }]) => [key, module] as const);

  it.each(cases)("refuses %s to a kid without %s, before the handler runs", async (key, module) => {
    repositories.family.membership = kidWith({ off: module });

    expect(await call(key)).toEqual(REFUSED);
    // The background last-activity touch, then the membership, read alongside the must-change-password flag.
    expect(mocks.accessed).toEqual(["family", "family", "account"]);
  });

  it.each(cases)("refuses %s with 403 password_change_required to an account that must change its password", async (key) => {
    repositories.family.membership = kidWith({ only: "expenses" });
    repositories.account.mustChangePassword.add(signedInAs().id);

    expect(await call(key)).toMatchObject({ status: 403, body: { code: "password_change_required" } });
    // Refused before the permission check and the handler: the membership was read alongside the flag, never used.
    expect(mocks.accessed).toEqual(["family", "family", "account"]);
  });

  it.each(cases)("lets %s through for a kid with only %s", async (key, module) => {
    repositories.family.membership = kidWith({ only: module });

    expect(await call(key)).not.toEqual(REFUSED);
  });

  it.each(cases)("lets %s through for a parent", async (key) => {
    repositories.family.membership = aParent();

    expect(await call(key)).not.toEqual(REFUSED);
  });
});

describe("routes that check a module for one kind of request", () => {
  const cases = entries("module-when").map(([key, access]) => [key, access] as const);

  it.each(cases)("refuses %s to a kid without the module, for the request that needs it", async (key, { module, body }) => {
    repositories.family.membership = kidWith({ off: module });

    expect(await call(key, body)).toEqual(REFUSED);
  });

  it.each(cases)("lets that kid make %s's other requests", async (key, { module }) => {
    repositories.family.membership = kidWith({ off: module });

    expect(await call(key)).not.toEqual(REFUSED);
  });
});

describe("routes behind withParent", () => {
  const cases = entries("parent").map(([key]) => key);

  it.each(cases)("refuses %s to a kid, before the handler runs", async (key) => {
    repositories.family.membership = kidWith({ only: "nothing" });

    expect(await call(key, {})).toEqual(REFUSED);
    // The last-activity touch, then the membership, read alongside the must-change-password flag.
    expect(mocks.accessed).toEqual(["family", "family", "account"]);
  });

  it.each(cases)("refuses %s to a user without a family", async (key) => {
    expect(await call(key, {})).toEqual(REFUSED);
  });

  it.each(cases)("answers %s with 404 while the family flag is off", async (key) => {
    vi.stubEnv("FAMILY_ENABLED", "false");
    repositories.family.membership = aParent();

    expect(await call(key, {})).toMatchObject({ status: 404 });
  });

  it.each(cases)("lets %s through for a parent", async (key) => {
    repositories.family.membership = aParent();

    expect(await call(key, {})).not.toEqual(REFUSED);
  });
});

describe("routes with no wrapper permission", () => {
  // Signed-in routes, and the ones whose role check is in SQL: the wrapper never refuses anyone, so a
  // kid with every module off reaches the handler (which may still refuse with the RPC's own message).
  const cases = [...entries("signed-in"), ...entries("sql")].map(([key]) => key);

  it.each(cases)("lets a kid with every module off reach %s", async (key) => {
    repositories.family.membership = kidWith({ only: "nothing" });

    expect(await call(key)).not.toEqual(REFUSED);
  });
});

describe("MCP tools", () => {
  /**
   * Calls a tool's handler as `defineTool` registered it, with no arguments. The SDK would refuse
   * them against the advertised schema before the handler runs; skipping that shows the module check
   * comes first: a refused kid is refused whatever they send, and anyone else gets as far as the
   * input check (a field error), never the forbidden message.
   */
  async function callTool(name: string): Promise<CallToolResult> {
    const handlers = new Map<string, (args: unknown, extra: unknown) => Promise<CallToolResult>>();
    vi.spyOn(McpServer.prototype, "registerTool").mockImplementation(function (this: McpServer, toolName: string, _config: unknown, handler: unknown) {
      handlers.set(toolName, handler as (args: unknown, extra: unknown) => Promise<CallToolResult>);
      return {} as ReturnType<McpServer["registerTool"]>;
    } as McpServer["registerTool"]);
    createMcpServer({ userId: "owner", email: "owner@example.com" });
    const handler = handlers.get(name);
    if (!handler) throw new Error(`No tool ${name}`);
    return handler({}, {});
  }

  const gated = Object.entries(TOOL_MODULES).filter((entry): entry is [string, ModuleKey] => entry[1] !== null);
  const open = Object.entries(TOOL_MODULES).filter(([, module]) => module === null).map(([name]) => name);

  it.each(gated)("refuses %s to a kid without %s, before reading the input", async (name, module) => {
    repositories.family.membership = kidWith({ off: module });

    expect((await callTool(name)).structuredContent).toEqual({ error: FORBIDDEN_MESSAGE });
  });

  it.each(gated)("lets a kid with only %s's module (%s) past the check", async (name, module) => {
    repositories.family.membership = kidWith({ only: module });

    expect((await callTool(name)).structuredContent).not.toEqual({ error: FORBIDDEN_MESSAGE });
  });

  it.each(open)("lets a kid with every module off past %s's check", async (name) => {
    repositories.family.membership = kidWith({ only: "nothing" });

    expect((await callTool(name)).structuredContent).not.toEqual({ error: FORBIDDEN_MESSAGE });
  });
});
