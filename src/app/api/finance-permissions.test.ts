import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MODULE_KEYS, type ModuleKey, type Permissions } from "@/lib/permissions";
import { aKid } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { signedInAs } from "@/test/route";

const mocks = vi.hoisted(() => ({ accessed: [] as string[] }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
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

// The module each finance route needs, at `edit`. `account` stays on plain `withUser`.
const FINANCE_ROUTES: Record<string, { module: ModuleKey; methods: string[] }> = {
  dashboard: { module: "expenses", methods: ["GET"] },
  "expense-tabs": { module: "expenses", methods: ["GET", "POST"] },
  "expense-tabs/[id]": { module: "expenses", methods: ["DELETE", "PATCH"] },
  "expense-tabs/[id]/expenses": { module: "expenses", methods: ["GET"] },
  expenses: { module: "expenses", methods: ["GET", "POST"] },
  "expenses/[id]": { module: "expenses", methods: ["DELETE"] },
  "expenses/export": { module: "expenses", methods: ["GET"] },
  investments: { module: "investments", methods: ["GET"] },
  "investment-transactions": { module: "investments", methods: ["GET", "POST"] },
  "investment-transactions/[id]": { module: "investments", methods: ["DELETE"] },
  "net-worth": { module: "net_worth", methods: ["GET"] },
  "net-worth/items": { module: "net_worth", methods: ["POST"] },
  "net-worth/items/[id]": { module: "net_worth", methods: ["PATCH"] },
  "net-worth/items/[id]/valuations": { module: "net_worth", methods: ["POST"] },
  "net-worth/valuations/[id]": { module: "net_worth", methods: ["PATCH"] },
};

type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

const cases = Object.entries(FINANCE_ROUTES).flatMap(([route, { module, methods }]) =>
  methods.map((method) => [method, route, module] as const));

/** A kid with every module on except `off`, or with only `only` on. */
function kidWith({ off, only }: { off?: ModuleKey; only?: ModuleKey }) {
  const permissions = Object.fromEntries(MODULE_KEYS.map((key) => {
    const on = only ? key === only : key !== off;
    return [key, on ? (key === "family_finance" ? "view" : "edit") : "off"];
  })) as Permissions;
  return aKid({ permissions });
}

async function call(method: string, route: string) {
  const routeModule = (await import(join(API_DIR, route, "route.ts"))) as Record<string, Handler>;
  const url = `http://localhost/api/${route.replaceAll("[id]", ID)}`;
  const response = await routeModule[method](new NextRequest(url, { method }), { params: Promise.resolve({ id: ID }) });
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
}

let repositories: FakeRepositories;

beforeEach(() => {
  mocks.accessed.length = 0;
  repositories = resetFakeRepositories();
  signedInAs();
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => vi.unstubAllEnvs());

describe("finance route permissions", () => {
  it.each(cases)("refuses %s /api/%s to a kid without %s, before the handler runs", async (method, route, module) => {
    repositories.family.membership = kidWith({ off: module });

    const response = await call(method, route);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "You don't have access to this." });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(mocks.accessed).toEqual(["family"]);
  });

  it.each(cases)("lets %s /api/%s through for a kid with only %s", async (method, route, module) => {
    repositories.family.membership = kidWith({ only: module });

    expect((await call(method, route)).status).not.toBe(403);
  });
});
