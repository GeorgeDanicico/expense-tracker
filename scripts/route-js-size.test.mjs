import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  BUDGET_FILE,
  buildReport,
  checkBudget,
  chunksFromClientManifest,
  collectRoutes,
  createSizer,
  formatCheck,
  formatTable,
  loadsModule,
  parseBudget,
  routeFromAppPath,
  sharedFiles,
} from "./route-js-size.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "route-js-size");

describe("routeFromAppPath", () => {
  it("drops route groups and the page segment", () => {
    expect(routeFromAppPath("/(app)/dashboard/page")).toBe("/dashboard");
    expect(routeFromAppPath("/(app)/settings/family/page")).toBe("/settings/family");
    expect(routeFromAppPath("/join/[code]/page")).toBe("/join/[code]");
    expect(routeFromAppPath("/page")).toBe("/");
  });

  it("is null for route handlers", () => {
    expect(routeFromAppPath("/api/todos/route")).toBeNull();
    expect(routeFromAppPath("/apple-icon.png/route")).toBeNull();
  });
});

describe("loadsModule", () => {
  it("keeps libraries and components, which are not under src/app", () => {
    expect(loadsModule("/(app)/dashboard/page", "/work/node_modules/@chakra-ui/react/dist/esm/index.js")).toBe(true);
    expect(loadsModule("/(app)/dashboard/page", "/work/src/components/dashboard/home-screen.tsx")).toBe(true);
  });

  it("keeps a page only for its own route", () => {
    expect(loadsModule("/(app)/dashboard/page", "/work/src/app/(app)/dashboard/page.tsx")).toBe(true);
    expect(loadsModule("/(app)/dashboard/page", "/work/src/app/(app)/todos/page.tsx")).toBe(false);
    expect(loadsModule("/(app)/dashboard/page", "/work/src/app/page.tsx")).toBe(false);
    expect(loadsModule("/page", "/work/src/app/page.tsx")).toBe(true);
  });

  it("keeps the layouts and boundaries of the directories above the route, and no others", () => {
    expect(loadsModule("/(app)/settings/family/page", "/work/src/app/layout.tsx")).toBe(true);
    expect(loadsModule("/(app)/settings/family/page", "/work/src/app/(app)/layout.tsx")).toBe(true);
    expect(loadsModule("/(app)/settings/family/page", "/work/src/app/(app)/settings/layout.tsx")).toBe(true);
    expect(loadsModule("/(app)/dashboard/page", "/work/src/app/(app)/settings/layout.tsx")).toBe(false);
    expect(loadsModule("/page", "/work/src/app/(app)/layout.tsx")).toBe(false);
    // A directory whose name only starts like the route's is not above it.
    expect(loadsModule("/(app)/todos/page", "/work/src/app/(app)/to/layout.tsx")).toBe(false);
  });
});

describe("chunksFromClientManifest", () => {
  const source = readFileSync(join(FIXTURE, "server/app/(app)/dashboard/page_client-reference-manifest.js"), "utf8");

  it("lists the JavaScript chunks of the route's own modules, once, and decodes their paths", () => {
    expect(chunksFromClientManifest(source, "/(app)/dashboard/page").sort()).toEqual([
      "static/chunks/100-aaaaaaaaaaaaaaaa.js",
      "static/chunks/200-bbbbbbbbbbbbbbbb.js",
      "static/chunks/800-1111aaaa2222bbbb.js",
      "static/chunks/app/(app)/dashboard/page-3333cccc4444dddd.js",
      "static/chunks/app/(app)/layout-dddddddddddddddd.js",
      "static/chunks/app/layout-cccccccccccccccc.js",
    ]);
  });

  it("leaves the global it assigns to as it found it", () => {
    globalThis.__RSC_MANIFEST = { kept: true };
    chunksFromClientManifest(source, "/(app)/dashboard/page");
    expect(globalThis.__RSC_MANIFEST).toEqual({ kept: true });
    delete globalThis.__RSC_MANIFEST;
  });

  it("returns nothing for a manifest with no client modules", () => {
    expect(chunksFromClientManifest('globalThis.__RSC_MANIFEST={"/page":{}};', "/page")).toEqual([]);
  });
});

const routes = collectRoutes(FIXTURE);

describe("collectRoutes", () => {
  const byRoute = Object.fromEntries(routes.map((entry) => [entry.route, entry.files]));

  it("reads the pages only, without /dev, the global error page or route handlers", () => {
    expect(Object.keys(byRoute).sort()).toEqual(["/", "/dashboard", "/todos", "/todos/[id]"]);
  });

  it("fails loudly when a page has no client manifest, rather than dropping the route", () => {
    expect(() => collectRoutes(FIXTURE, { includeDev: true })).toThrow(/No client manifest for \/dev\/preview\/\[screen\]/);
  });

  it("gives every route the framework files, and not the nomodule polyfills", () => {
    for (const files of Object.values(byRoute)) {
      expect(files).toContain("static/chunks/webpack-1111111111111111.js");
      expect(files).toContain("static/chunks/main-app-2222222222222222.js");
      expect(files.some((file) => file.includes("polyfills"))).toBe(false);
    }
  });

  it("keeps another route's page and the root page out of a route", () => {
    expect(byRoute["/dashboard"]).not.toContain("static/chunks/app/page-ffffffffffffffff.js");
    expect(byRoute["/dashboard"]).not.toContain("static/chunks/500-eeeeeeeeeeeeeeee.js");
    expect(byRoute["/dashboard"].some((file) => file.includes("todos"))).toBe(false);
    expect(byRoute["/"]).toContain("static/chunks/app/page-ffffffffffffffff.js");
    expect(byRoute["/"]).not.toContain("static/chunks/app/(app)/layout-dddddddddddddddd.js");
  });

  it("reads a dynamic route's own page from its URL-encoded name", () => {
    expect(byRoute["/todos/[id]"]).toContain("static/chunks/app/(app)/todos/[id]/page-abcdef0123456789.js");
    expect(byRoute["/todos"]).not.toContain("static/chunks/app/(app)/todos/[id]/page-abcdef0123456789.js");
    expect(byRoute["/todos/[id]"]).not.toContain("static/chunks/app/(app)/todos/page-0123456789abcdef.js");
  });

  it("finds the files every route shares", () => {
    expect(sharedFiles(routes)).toEqual([
      "static/chunks/100-aaaaaaaaaaaaaaaa.js",
      "static/chunks/200-bbbbbbbbbbbbbbbb.js",
      "static/chunks/app/layout-cccccccccccccccc.js",
      "static/chunks/main-app-2222222222222222.js",
      "static/chunks/webpack-1111111111111111.js",
    ]);
  });
});

describe("buildReport and formatTable", () => {
  // Every file is `<name length * 10>` bytes of the letter a, so the sizes are known.
  const read = (path) => Buffer.from("a".repeat(relative(FIXTURE, path).length * 10));
  const sizeOf = createSizer(FIXTURE, read);
  const report = buildReport(routes, sizeOf, "build-1");

  it("measures gzip of the file itself", () => {
    const file = "static/chunks/100-aaaaaaaaaaaaaaaa.js";
    expect(sizeOf(file)).toEqual({ raw: file.length * 10, gzip: gzipSync(Buffer.from("a".repeat(file.length * 10))).length });
  });

  it("reports each route's total, its own part and the shared part", () => {
    const dashboard = report.routes.find((entry) => entry.route === "/dashboard");
    const own = ["static/chunks/800-1111aaaa2222bbbb.js", "static/chunks/app/(app)/dashboard/page-3333cccc4444dddd.js", "static/chunks/app/(app)/layout-dddddddddddddddd.js"];
    expect(report.buildId).toBe("build-1");
    expect(report.shared.files).toBe(5);
    expect(dashboard.files).toBe(8);
    expect(dashboard.ownFiles.sort()).toEqual(own.sort());
    expect(dashboard.gzipBytes).toBe(report.shared.gzip + own.reduce((sum, file) => sum + sizeOf(file).gzip, 0));
    expect(dashboard.ownGzipBytes).toBe(dashboard.gzipBytes - report.shared.gzip);
  });

  it("sorts routes by name and prints a table with the shared line", () => {
    expect(report.routes.map((entry) => entry.route)).toEqual(["/", "/dashboard", "/todos", "/todos/[id]"]);
    const table = formatTable(report);
    expect(table.split("\n")[0]).toMatch(/^Route\s+Files\s+Raw KiB\s+Gzip KiB\s+Own gzip KiB$/);
    expect(table).toMatch(/\n\/dashboard\s+8\s/);
    expect(table).toMatch(/Shared by every route: 5 files/);
  });

  it("has the fields PF9 will check against", () => {
    expect(Object.keys(report.routes[0]).sort()).toEqual(["files", "gzipBytes", "ownFiles", "ownGzipBytes", "rawBytes", "route"]);
    expect(Object.keys(report.shared).sort()).toEqual(["files", "gzip", "raw"]);
  });
});

describe("the budget check (PF9)", () => {
  const sizeOf = createSizer(FIXTURE, (path) => Buffer.from("a".repeat(relative(FIXTURE, path).length * 10)));
  const report = buildReport(routes, sizeOf);
  const kib = (route) => report.routes.find((entry) => entry.route === route).gzipBytes / 1024;
  const budgetFor = (overrides = {}, tolerancePercent = 2) => ({
    tolerancePercent,
    firstLoadGzipKiB: { ...Object.fromEntries(report.routes.map((entry) => [entry.route, kib(entry.route) + 10])), ...overrides },
  });

  it("passes when every route is within its budget", () => {
    const result = checkBudget(report, budgetFor());
    expect(result.failed).toBe(false);
    expect(result.rows.every((row) => row.status === "ok")).toBe(true);
    expect(formatCheck(result, 2)).toMatch(/Size check passed\.$/);
  });

  it("allows the tolerance above a budget and not a byte more", () => {
    // A budget whose limit is the route's size passes, one 0.01 KiB under it fails.
    expect(checkBudget(report, budgetFor({ "/dashboard": kib("/dashboard") / 1.02 })).rows.find((row) => row.route === "/dashboard").status).toBe("ok");
    const below = checkBudget(report, budgetFor({ "/dashboard": kib("/dashboard") / 1.02 - 0.01 }));
    expect(below.rows.find((row) => row.route === "/dashboard").status).toBe("over");
    expect(below.failed).toBe(true);
    expect(formatCheck(below, 2)).toMatch(/\/dashboard is [\d.]+ KiB over its budget of [\d.]+ KiB.*\nSize check FAILED\.$/s);
  });

  it("fails for a route with no budget, and for a budget with no route in the build", () => {
    const withoutTodos = Object.fromEntries(Object.entries(budgetFor().firstLoadGzipKiB).filter(([route]) => route !== "/todos"));
    const missing = checkBudget(report, { tolerancePercent: 2, firstLoadGzipKiB: withoutTodos });
    expect(missing.failed).toBe(true);
    expect(missing.rows.find((row) => row.route === "/todos").status).toBe("no budget");
    expect(formatCheck(missing, 2)).toContain(`/todos has no budget. Add it to ${BUDGET_FILE}.`);

    const stale = checkBudget(report, budgetFor({ "/gone": 100 }));
    expect(stale.failed).toBe(true);
    expect(stale.stale).toEqual(["/gone"]);
    expect(formatCheck(stale, 2)).toContain("has a budget for /gone, which is not in the build");
  });

  it("does not call a budget stale in a run limited to some routes", () => {
    const only = { ...report, routes: report.routes.filter((entry) => entry.route === "/dashboard") };
    expect(checkBudget(only, budgetFor(), { partial: true }).failed).toBe(false);
    expect(checkBudget(only, budgetFor()).failed).toBe(true);
  });

  it("reads a budget file and refuses a malformed one", () => {
    expect(parseBudget('{"tolerancePercent":2,"firstLoadGzipKiB":{"/dashboard":308.4}}')).toEqual({ tolerancePercent: 2, firstLoadGzipKiB: { "/dashboard": 308.4 } });
    expect(() => parseBudget('{"firstLoadGzipKiB":{}}')).toThrow(/tolerancePercent/);
    expect(() => parseBudget('{"tolerancePercent":2}')).toThrow(/firstLoadGzipKiB/);
    expect(() => parseBudget('{"tolerancePercent":2,"firstLoadGzipKiB":{"dashboard":1}}')).toThrow(/"dashboard"/);
    expect(() => parseBudget('{"tolerancePercent":2,"firstLoadGzipKiB":{"/dashboard":"big"}}')).toThrow(/"\/dashboard"/);
    expect(() => parseBudget('{"tolerancePercent":-1,"firstLoadGzipKiB":{}}')).toThrow(/tolerancePercent/);
  });

  it("has the budget file CI reads, with the four target pages at 20% under their baselines", () => {
    const budget = parseBudget(readFileSync(BUDGET_FILE, "utf8"));
    expect(budget.firstLoadGzipKiB).toMatchObject({ "/dashboard": 308.4, "/expenses": 329.4, "/todos": 322.2, "/reminders": 307.4 });
    expect(Object.keys(budget.firstLoadGzipKiB)).toHaveLength(24);
  });
});
