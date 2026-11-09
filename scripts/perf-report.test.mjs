import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Runs scripts/perf-report.sh on a fixture of real logger lines (see src/lib/log/perf-report-fixture.test.ts,
// which keeps the fixture's shape in step with the logger), and checks its numbers against a second
// implementation here. If someone renames a log field, or changes the jq, this fails.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "perf-report.sh");
const FIXTURE = join(ROOT, "scripts", "fixtures", "perf-report", "sample.jsonl");

const hasTools = ["bash", "jq"].every((tool) => spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0);
// Locally a missing jq skips these; on CI (where jq is installed) a missing one must be loud.
const suite = hasTools || process.env.CI ? describe : describe.skip;

const run = (...args) => spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });

const fixture = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .flatMap((line) => {
    try {
      const parsed = JSON.parse(line);
      return parsed && typeof parsed === "object" ? [parsed] : [];
    } catch {
      return [];
    }
  });
const requests = fixture.filter((line) => line.event === "request" && line.route && typeof line.ms === "number");
const vitals = fixture.filter((line) => line.event === "web_vital");

/** Nearest rank, the script's definition. */
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const rows = (output, heading) => {
  const section = output.split(/^## /m).find((part) => part.startsWith(heading));
  expect(section, `section "${heading}"`).toBeDefined();
  // The header row and the divider are dropped, what is left are the data rows.
  return section.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| ---")).slice(1);
};
const cells = (row) => row.slice(1, -2).split(" | ").map((cell) => cell.trim());

suite("scripts/perf-report.sh", () => {
  const result = run("--input", FIXTURE);
  const output = result.stdout;

  it("succeeds on the fixture, ignoring other events, a non-JSON line and a damaged request line", () => {
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(output).toContain(`- \`request\` lines: ${requests.length + 1}. \`web_vital\` lines: ${vitals.length}.`);
  });

  it("prints p75 of each Web Vital per page", () => {
    const table = rows(output, "Web Vitals: p75 per page").map(cells);
    const dashboard = table.find((row) => row[0] === "`/dashboard`");
    const of = (page, name) => percentile(vitals.filter((line) => line.page === page && line.name === name).map((line) => line.value), 0.75);
    expect(dashboard.slice(1, 6)).toEqual([of("/dashboard", "LCP"), of("/dashboard", "INP"), of("/dashboard", "CLS"), of("/dashboard", "FCP"), of("/dashboard", "TTFB")].map(String));
    // A page with no INP samples says so rather than printing a number.
    expect(table.find((row) => row[0] === "`/login`")[2]).toBe("–");
    // Pages come in order of how many LCP samples they have.
    expect(table[0][0]).toBe("`/dashboard`");
  });

  it("splits Web Vitals by navigation type, with the ones that have none as unknown", () => {
    const table = rows(output, "Web Vitals: p75 by navigation type").map(cells);
    expect(table.map((row) => row[0]).sort()).toEqual(["back-forward", "navigate", "prerender", "reload", "unknown"]);
  });

  it("prints p50, p95 and the slowest spans per route, and marks AI and import routes exempt", () => {
    const table = rows(output, "API requests: latency per route").map(cells);
    const route = table.find((row) => row[0] === "`GET /api/dashboard`");
    const ms = requests.filter((line) => line.method === "GET" && line.route === "/api/dashboard").map((line) => line.ms);
    expect(route.slice(1, 5)).toEqual([String(ms.length), String(percentile(ms, 0.5)), String(percentile(ms, 0.95)), String(Math.max(...ms))]);
    expect(route[8]).toMatch(/^rpc\.get_dashboard \d+, auth\.user \d+, /);
    expect(route[9]).toBe("over");
    expect(table.find((row) => row[0] === "`POST /api/imports`")[9]).toBe("exempt");
    expect(table.find((row) => row[0] === "`POST /api/expenses`")[9]).toBe("ok");
    expect(table.find((row) => row[0] === "`GET /api/todos`")[5]).toBe("1");
  });

  it("counts Auth spans and get_family reads per signed-in request", () => {
    expect(output).toMatch(/All signed-in requests: 64\. Auth spans per request: average 1\.06\. Spread: 1 span\(s\) in 62 requests; 3 span\(s\) in 2 requests\./);
    const table = rows(output, "Round trips per signed-in request").map(cells);
    const todos = table.find((row) => row[0] === "`GET /api/todos`");
    const reads = requests
      .filter((line) => line.route === "/api/todos" && line.userId)
      .map((line) => line.spans.filter((entry) => entry.name === "rpc.get_family").reduce((sum, entry) => sum + (entry.count ?? 1), 0));
    expect(todos[1]).toBe(String(reads.length));
    expect(todos[4]).toBe(String(Math.round((reads.reduce((a, b) => a + b, 0) / reads.length) * 100) / 100));
    expect(table.find((row) => row[0] === "`POST /api/family/members/:id/password`")[2]).toBe("3");
  });

  it("lists Supabase spans by total time, with merged spans divided back into calls", () => {
    const table = rows(output, "Supabase calls").map(cells);
    expect(table[0][0]).toBe("`auth.user`");
    const calls = requests.flatMap((line) => line.spans).filter((entry) => entry.name === "rpc.get_family").reduce((sum, entry) => sum + (entry.count ?? 1), 0);
    expect(table.find((row) => row[0] === "`rpc.get_family`")[1]).toBe(String(calls));
  });

  it("tells the reader what the logs cannot", () => {
    expect(output).toContain("docker exec expense-tracker-web node -e");
    expect(output).toContain("not in these lines");
  });

  it("says so when there is nothing to report", () => {
    const empty = spawnSync("bash", [SCRIPT, "--input", "/dev/null"], { encoding: "utf8" });
    expect(empty.status).toBe(0);
    expect(empty.stdout).toContain("_No `web_vital` lines in this window._");
    expect(empty.stdout).toContain("_No `request` lines in this window._");
    expect(empty.stdout).toContain("_No signed-in `request` lines in this window._");
    expect(empty.stdout).toContain("_No Supabase spans in this window._");
  });

  it("refuses arguments it cannot use, before reading anything", () => {
    for (const args of [["0"], ["abc"], ["5", "name;rm -rf"], ["5", "-x"], ["5", "a", "extra"], ["1000"]]) {
      const refused = run(...args);
      expect(refused.status, args.join(" ")).toBe(2);
      expect(refused.stdout).toBe("");
    }
  });

  it("prints its usage", () => {
    const help = run("--help");
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("scripts/perf-report.sh [days] [container]");
  });
});
