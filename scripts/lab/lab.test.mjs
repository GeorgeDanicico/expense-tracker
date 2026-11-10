import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { guardProblems, loopbackProblem, parseEnvFile } from "./guard.mjs";
import {
  cookieFromHeader,
  cumulativeLayoutShift,
  fetchOnceMore,
  interactiveAndBlocking,
  lcpKind,
  lighthouseNumbers,
  linesBetween,
  median,
  parseArgs as measureArgs,
  serverNumbers,
  spread,
  waterfall,
} from "./measure.mjs";
import { addDays, bucharestToday, calendarPlan, createRandom, expensePlan, KID_PERMISSIONS, monthStart, reminderPlan, todoPlan } from "./seed.mjs";
import { classifyCall, parseArgs as proxyArgs, startProxy } from "./supabase-proxy.mjs";
import { MODULE_LEVELS } from "../../src/lib/permissions.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporary = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "lab-test-"));
  temporary.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the loopback guard", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:3110", "https://localhost", "http://app.localhost:3000", "http://[::1]:54321", "http://127.0.0.2"])(
    "allows %s",
    (url) => expect(loopbackProblem(url)).toBeNull(),
  );

  it.each([
    ["https://abcdefghijklmnop.supabase.co", "not this machine"],
    ["http://192.168.1.10:54321", "not this machine"],
    ["http://0.0.0.0:54321", "not this machine"],
    ["http://localhost.evil.example", "not this machine"],
    ["http://127.0.0.1.nip.io", "not this machine"],
    ["http://user:secret@127.0.0.1", "user name or password"],
    ["ftp://127.0.0.1", "not http or https"],
    ["", "is not set"],
    [undefined, "is not set"],
    ["not a url", "is not a URL"],
  ])("refuses %s", (url, reason) => expect(loopbackProblem(url)).toContain(reason));

  it("checks SUPABASE_URL and SITE_URL in an env file", () => {
    const env = parseEnvFile("# comment\nSUPABASE_URL=https://abcdefghijklmnop.supabase.co\nSITE_URL=http://localhost:3110\n\nOTHER=x=y\n");
    expect(env.OTHER).toBe("x=y");
    expect(guardProblems(env)).toEqual([expect.stringMatching(/^SUPABASE_URL points at abcdefghijklmnop\.supabase\.co/)]);
    expect(guardProblems({ SUPABASE_URL: "http://127.0.0.1:54400", SITE_URL: "http://localhost:3110" })).toEqual([]);
  });

  it("checks every *_URL variable, not only the two the app needs", () => {
    const env = { SUPABASE_URL: "http://127.0.0.1:54400", SITE_URL: "http://localhost:3110", LAB_SUPABASE_DIRECT_URL: "https://abcdefghijklmnop.supabase.co", PRICE_SERVICE_URL: "http://127.0.0.1:1" };
    expect(guardProblems(env)).toEqual([expect.stringMatching(/^LAB_SUPABASE_DIRECT_URL points at abcdefghijklmnop/)]);
    expect(guardProblems({ SUPABASE_URL: "http://127.0.0.1:54400" })).toEqual(["SITE_URL is not set"]);
  });

  /** Runs scripts/lab.sh with its files in `dir`; returns the exit code and output. */
  function lab(dir, ...args) {
    const result = spawnSync("bash", [join(ROOT, "scripts/lab.sh"), ...args], { cwd: ROOT, env: { ...process.env, LAB_DIR: dir }, encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it.each([["guard"], ["app", "--no-build"], ["measure", "/dashboard"]])("stops `lab.sh %s` before anything starts when SUPABASE_URL is not on this machine", (...args) => {
    const dir = tempDir();
    writeFileSync(join(dir, "app.env"), "SUPABASE_URL=https://abcdefghijklmnop.supabase.co\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_x\nSITE_URL=http://localhost:3110\n");
    const { status, output } = lab(dir, ...args);
    expect(status).toBe(1);
    expect(output).toContain("refusing to start: SUPABASE_URL points at abcdefghijklmnop.supabase.co");
    expect(output).not.toContain("sb_publishable_x");
  });

  it("lets a loopback env file through", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "app.env"), "SUPABASE_URL=http://127.0.0.1:54400\nSITE_URL=http://localhost:3110\n");
    expect(lab(dir, "guard").status).toBe(0);
  });

  it("has no syntax errors", () => {
    expect(() => execFileSync("bash", ["-n", join(ROOT, "scripts/lab.sh")])).not.toThrow();
  });
});

describe("the delay proxy", () => {
  it("names the Supabase API of a path, without its query string", () => {
    expect(classifyCall("/auth/v1/user")).toEqual({ api: "auth", name: "/user" });
    expect(classifyCall("/auth/v1/.well-known/jwks.json")).toEqual({ api: "auth", name: "/.well-known/jwks.json" });
    expect(classifyCall("/rest/v1/rpc/get_family")).toEqual({ api: "rpc", name: "get_family" });
    expect(classifyCall("/rest/v1/expenses?user_id=eq.secret")).toEqual({ api: "rest", name: "expenses" });
    expect(classifyCall("/storage/v1/object/avatars/x")).toEqual({ api: "storage", name: "/object/avatars/x" });
  });

  it("refuses a target that isn't on this machine", () => {
    expect(() => proxyArgs(["--target", "https://abcdefghijklmnop.supabase.co"])).toThrow(/not this machine/);
    expect(() => proxyArgs(["--delay-ms", "-1"])).toThrow(/delay/);
  });

  it("adds the delay to each call and logs it without headers or query strings", async () => {
    const upstream = http.createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ path: request.url, auth: request.headers.authorization }));
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const dir = tempDir();
    const log = join(dir, "calls.jsonl");
    const proxy = await startProxy({ port: 0, target: `http://127.0.0.1:${upstream.address().port}`, delayMs: 120, log });
    try {
      const started = Date.now();
      const response = await fetch(`http://127.0.0.1:${proxy.address().port}/rest/v1/profiles?id=eq.123`, { headers: { authorization: "Bearer token-value" } });
      const body = await response.json();
      expect(Date.now() - started).toBeGreaterThanOrEqual(115);
      expect(body).toEqual({ path: "/rest/v1/profiles?id=eq.123", auth: "Bearer token-value" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const text = readFileSync(log, "utf8");
      const line = JSON.parse(text.trim());
      expect(line).toMatchObject({ method: "GET", api: "rest", name: "profiles", status: 200 });
      expect(line.ms).toBeGreaterThanOrEqual(115);
      expect(text).not.toContain("token-value");
      expect(text).not.toContain("eq.123");
    } finally {
      proxy.close();
      upstream.close();
    }
  });
});

describe("the seed", () => {
  const today = "2026-11-09";

  it("is deterministic", () => {
    expect(expensePlan(today)).toEqual(expensePlan(today));
    expect(createRandom(16).next()).toBe(createRandom(16).next());
  });

  it("counts every date from today", () => {
    expect(addDays(today, -10)).toBe("2026-10-30");
    expect(monthStart(today, -1)).toBe("2026-10-01");
    expect(monthStart("2026-01-15", -1)).toBe("2025-12-01");
    expect(bucharestToday(new Date("2026-11-09T22:30:00Z"))).toBe("2026-11-10");
    const plan = expensePlan(today);
    const all = [...plan.parent, ...plan.adult, ...plan.kid];
    expect(all.every((row) => row.expense_date <= today)).toBe(true);
    expect(all.some((row) => row.expense_date.startsWith("2023-12"))).toBe(true);
    expect(reminderPlan(today).parent.some((reminder) => reminder.startsOn < today)).toBe(true);
    expect(reminderPlan(today).parent.some((reminder) => reminder.startsOn === today)).toBe(true);
    expect(calendarPlan(today).some((event) => event.startDate === today)).toBe(true);
  });

  it("has a realistic volume: a few hundred expenses a month for the family lately, three years back", () => {
    const plan = expensePlan(today);
    const inMonth = (month) => [...plan.parent, ...plan.adult, ...plan.kid].filter((row) => row.expense_date.startsWith(month)).length;
    expect(inMonth("2026-10")).toBeGreaterThan(250);
    expect(inMonth("2026-10")).toBeLessThan(400);
    expect(inMonth("2023-12")).toBeGreaterThan(0);
    expect(plan.parent.length + plan.adult.length + plan.kid.length).toBeGreaterThan(5000);
  });

  it("writes only categories, subtypes and permission levels the app accepts", async () => {
    const { EXPENSE_CATEGORIES, SUBTYPE_CATEGORIES } = await import("../../src/lib/expenses/categories.ts");
    const plan = expensePlan(today);
    for (const row of [...plan.parent, ...plan.adult, ...plan.kid]) {
      expect(EXPENSE_CATEGORIES).toContain(row.category);
      if (row.subtype) expect(SUBTYPE_CATEGORIES[row.subtype]).toBe(row.category);
      expect(Number.isInteger(Math.round(row.amount * 100))).toBe(true);
    }
    for (const [module, level] of Object.entries(KID_PERMISSIONS)) expect(MODULE_LEVELS[module]).toContain(level);
  });

  it("has open and done to-dos", () => {
    const todos = todoPlan(today);
    expect(todos.filter((todo) => todo.status === "done").length).toBeGreaterThan(3);
    expect(todos.filter((todo) => todo.status !== "done").length).toBeGreaterThan(10);
  });
});

describe("the measuring script", () => {
  it("takes the pages, the user and a throttle it knows", () => {
    expect(measureArgs(["/dashboard", "/todos", "--user", "kid", "--throttle", "cpu", "--no-lighthouse"])).toMatchObject({ pages: ["/dashboard", "/todos"], user: "kid", throttle: "cpu", lighthouse: false, runs: 3 });
    expect(() => measureArgs(["/dashboard", "--throttle", "slow"])).toThrow(/mobile, cpu, none/);
    expect(() => measureArgs(["/dashboard", "--runs", "0"])).toThrow(/runs/);
  });

  it("tries a request once more after a network error, not after an HTTP error", async () => {
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return { status: 500 };
    };
    await expect(fetchOnceMore("http://localhost/x", {}, { fetcher: flaky })).resolves.toEqual({ status: 500 });
    expect(calls).toBe(2);
    const broken = async () => { throw new TypeError("fetch failed"); };
    await expect(fetchOnceMore("http://localhost/x", {}, { fetcher: broken })).rejects.toThrow("fetch failed");
  });

  it("takes medians and spreads of the numbers it has", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null, 5])).toBe(5);
    expect(median([])).toBeNull();
    expect(spread([3, 9, 5])).toBe(6);
  });

  it("adds layout shifts per session window, like Chrome", () => {
    expect(cumulativeLayoutShift([{ t: 0, value: 0.1 }, { t: 500, value: 0.1 }, { t: 3000, value: 0.05 }])).toBeCloseTo(0.2);
    expect(cumulativeLayoutShift([])).toBe(0);
  });

  it("finds time to interactive after the network quiets down, and blocking time before it", () => {
    const result = interactiveAndBlocking({
      fcp: 1000,
      longTasks: [{ start: 1500, duration: 200 }, { start: 3000, duration: 100 }, { start: 500, duration: 300 }],
      requests: [{ start: 0, end: 4000 }, { start: 0, end: 4000 }, { start: 0, end: 4500 }],
      endOfRecording: 20_000,
    });
    expect(result).toEqual({ tti: 3100, tbt: 200 });
    expect(interactiveAndBlocking({ fcp: 1000, longTasks: [], requests: [], endOfRecording: 3000 })).toEqual({ tti: null, tbt: 0 });
  });

  it("measures the waterfall: page, scripts, account, data is depth 4; a list waiting for rows is 5", () => {
    const page = "http://localhost/expenses";
    const chunk = "http://localhost/_next/static/chunks/app.js";
    const requests = [
      { name: "/expenses", kind: "document", url: page, initiator: null, start: 0, end: 600 },
      { name: "app.js", kind: "script", url: chunk, initiator: page, start: 590, end: 5000 },
      { name: "/api/account", kind: "api", url: "http://localhost/api/account", initiator: chunk, start: 6000, end: 6500 },
      { name: "/api/expenses", kind: "api", url: "http://localhost/api/expenses", initiator: chunk, start: 6600, end: 7200 },
      { name: "/api/expense-tabs", kind: "api", url: "http://localhost/api/expense-tabs", initiator: chunk, start: 6610, end: 7000 },
      { name: "/api/family", kind: "api", url: "http://localhost/api/family", initiator: chunk, start: 7300, end: 7600 },
    ];
    const { depth, nodes } = waterfall(requests);
    expect(depth).toBe(5);
    const byName = Object.fromEntries(nodes.map((node) => [node.name, node]));
    expect(byName["app.js"]).toMatchObject({ level: 1, after: "/expenses" });
    expect(byName["/api/account"]).toMatchObject({ level: 2, after: "app.js" });
    expect(byName["/api/expenses"]).toMatchObject({ level: 3, after: "/api/account" });
    expect(byName["/api/family"]).toMatchObject({ level: 4 });
    expect(waterfall(requests.slice(0, 5)).depth).toBe(4);
  });

  it("tells the loading screen from what the page drew", () => {
    expect(lcpKind({ tag: "p", text: "Opening your ledger…", inBusy: true })).toBe("loading screen");
    expect(lcpKind({ tag: "span", text: "RON 1,234.00", inBusy: false })).toBe("page");
    expect(lcpKind(null)).toBe("none");
  });

  it("keeps the log lines of one load, and counts the server's calls from them", () => {
    const text = [
      JSON.stringify({ time: "2026-11-09T10:00:00.500Z", event: "request", method: "GET", route: "/api/todos", ms: 40, dbCalls: 4, spans: [{ name: "auth.user", ms: 5 }, { name: "rpc.get_family", ms: 3 }] }),
      JSON.stringify({ time: "2026-11-09T10:00:00.600Z", event: "request", method: "POST", route: "/api/client-log", ms: 2, dbCalls: 0, spans: [] }),
      JSON.stringify({ time: "2026-11-09T10:00:09.000Z", event: "request", method: "GET", route: "/api/late", ms: 1 }),
      "not json",
    ].join("\n");
    const from = Date.parse("2026-11-09T10:00:00Z");
    const lines = linesBetween(text, from, from + 5000, (line) => Date.parse(line.time));
    expect(lines).toHaveLength(2);
    const proxyLines = [
      { api: "auth", name: "/user" }, { api: "auth", name: "/user" }, { api: "auth", name: "/.well-known/jwks.json" },
      { api: "rpc", name: "get_family" }, { api: "rest", name: "todos" },
    ];
    const numbers = serverNumbers(lines, proxyLines);
    expect(numbers).toMatchObject({ apiRequests: 1, dbCallsLogged: 4, authSpansLogged: 1, getFamilyLogged: 1, supabaseCalls: 5, authCalls: 3, authUserCalls: 2, getFamilyCalls: 1 });
    expect(numbers.authOtherCalls).toEqual(["/.well-known/jwks.json"]);
    expect(numbers.routes["GET /api/todos"]).toMatchObject({ count: 1, ms: [40], authSpans: 1, getFamily: 1 });
  });

  it("reads the real logger's request lines (the fixture perf-report-fixture.test.ts keeps in step)", () => {
    const text = readFileSync(join(ROOT, "scripts/fixtures/perf-report/sample.jsonl"), "utf8");
    const lines = linesBetween(text, 0, Number.MAX_SAFE_INTEGER, (line) => Date.parse(line.time));
    const requests = lines.filter((line) => line.event === "request" && line.route !== "/api/client-log" && line.route !== "/api/csp-report");
    const numbers = serverNumbers(lines, []);
    expect(numbers.apiRequests).toBe(requests.length);
    expect(numbers.apiRequests).toBeGreaterThan(0);
    expect(numbers.dbCallsLogged).toBe(requests.reduce((sum, line) => sum + (line.dbCalls ?? 0), 0));
    expect(numbers.dbCallsLogged).toBeGreaterThan(0);
    expect(numbers.authSpansLogged).toBeGreaterThan(0);
    expect(numbers.getFamilyLogged).toBeGreaterThan(0);
  });

  it("turns the sign-in route's Set-Cookie into a browser cookie", () => {
    const cookie = cookieFromHeader("sb-127-auth-token=base64-abc; Path=/; Max-Age=34560000; HttpOnly; Secure; SameSite=lax", "http://localhost:3110");
    expect(cookie).toMatchObject({ name: "sb-127-auth-token", value: "base64-abc", path: "/", httpOnly: true, secure: true, sameSite: "Lax", url: "http://localhost:3110" });
  });

  it("reads Lighthouse 13's report", () => {
    const report = {
      audits: {
        "first-contentful-paint": { numericValue: 900 },
        "largest-contentful-paint": { numericValue: 5400 },
        "cumulative-layout-shift": { numericValue: 0 },
        "total-blocking-time": { numericValue: 600 },
        interactive: { numericValue: 5700 },
        "speed-index": { numericValue: 2000 },
        "lcp-breakdown-insight": { details: { items: [{ type: "table" }, { type: "node", nodeLabel: "RON 18,917.39", snippet: "<span>" }] } },
        "resource-summary": { details: { items: [{ resourceType: "script", transferSize: 419_000 }] } },
      },
      categories: { performance: { score: 0.7 } },
      finalDisplayedUrl: "http://localhost:3110/dashboard",
    };
    expect(lighthouseNumbers(report)).toMatchObject({ fcp: 900, lcp: 5400, tbt: 600, tti: 5700, lcpElement: { label: "RON 18,917.39" }, scriptBytes: 419_000 });
  });
});
