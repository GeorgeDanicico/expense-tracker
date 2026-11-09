import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));

import { logRequest } from "@/lib/http/request-log";
import { log } from "@/lib/log";
import { clientEventLine } from "@/lib/log/client-report";
import { setRequestUser } from "@/lib/log/request-context";
import { recordSpan } from "@/lib/log/span";
import { loggedLines, type LoggedLine } from "@/test/log-lines";

/**
 * `scripts/perf-report.sh` reads `request` and `web_vital` lines, and its test runs it on
 * `scripts/fixtures/perf-report/sample.jsonl`. This keeps that fixture honest: every line in it has the
 * fields the real logger writes for that event, and no others. If a field is renamed or added in the
 * logger, this fails, and the fixture and the script's jq get updated together instead of rotting.
 */

const rawFixture = readFileSync(join(process.cwd(), "scripts/fixtures/perf-report/sample.jsonl"), "utf8");
const fixture = rawFixture
  .split("\n")
  .flatMap((text) => {
    try {
      const line = JSON.parse(text) as unknown;
      return typeof line === "object" && line !== null ? [line as LoggedLine] : [];
    } catch {
      return [];
    }
  });

/** What the real code writes for a `request` line, signed in and out, quick and slow. */
async function realRequestLines(): Promise<LoggedLine[]> {
  logged.length = 0;
  const request = () => new Request("http://localhost/api/todos");
  await logRequest(request(), async () => {
    setRequestUser("6f1c2a3e-1111-4111-8111-000000000001");
    recordSpan("auth.user", 150);
    recordSpan("rpc.get_family", 40);
    return new Response(null, { status: 200 });
  });
  await logRequest(request(), async () => new Response(null, { status: 401 }));
  vi.stubEnv("LOG_SLOW_MS", "1");
  await logRequest(request(), async () => {
    recordSpan("db.todos.get", 30);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(null, { status: 200 });
  });
  vi.unstubAllEnvs();
  return loggedLines(logged, "request");
}

function realVitalLine(): LoggedLine {
  logged.length = 0;
  const { event, level, fields } = clientEventLine(
    { kind: "vital", name: "LCP", value: 1800, rating: "good", navigationType: "navigate", page: "/dashboard", release: "abc1234" },
    () => true,
  );
  // The request context adds `requestId` to every line the endpoint writes; here there is none, so it is passed.
  log[level](event, { requestId: "abc", userId: "6f1c2a3e-1111-4111-8111-000000000001", ...fields });
  return loggedLines(logged, "web_vital")[0];
}

describe("the perf-report fixture", () => {
  it("has request lines with exactly the fields the logger writes", async () => {
    const real = await realRequestLines();
    const allowed = new Set(real.flatMap((line) => Object.keys(line)));
    const required = Object.keys(real.find((line) => line.status === 401)!); // a quick, signed-out request: the fewest fields
    const lines = fixture.filter((line) => line.event === "request" && line.route !== undefined);

    expect(allowed).toEqual(new Set([...required, "userId", "slow", "slowestSpan"]));
    expect(lines.length).toBeGreaterThan(50);
    for (const line of lines) {
      expect(Object.keys(line), JSON.stringify(line)).toEqual(expect.arrayContaining(required));
      expect(Object.keys(line).filter((key) => !allowed.has(key)), JSON.stringify(line)).toEqual([]);
      expect(Object.keys(line).slice(0, 3)).toEqual(["time", "level", "event"]);
    }
  });

  it("has spans shaped like the logger's, with only the fields a span has", () => {
    const allowed = new Set(["name", "ms", "count", "error", "status", "deviceId"]);
    const spans = fixture.filter((line) => line.event === "request").flatMap((line) => (line.spans as Record<string, unknown>[] | undefined) ?? []);
    expect(spans.length).toBeGreaterThan(100);
    for (const span of spans) {
      expect(Object.keys(span).filter((key) => !allowed.has(key))).toEqual([]);
      expect(typeof span.name).toBe("string");
      expect(typeof span.ms).toBe("number");
    }
    expect(spans.some((span) => span.count !== undefined), "a merged span").toBe(true);
  });

  it("has web_vital lines with exactly the fields the logger writes", () => {
    const real = realVitalLine();
    const lines = fixture.filter((line) => line.event === "web_vital");
    // `navigationType` and `userId` are optional (older browsers; a signed-out page); every other field is always there.
    const optional = new Set(["navigationType", "userId"]);
    const required = Object.keys(real).filter((key) => !optional.has(key));

    expect(lines.length).toBeGreaterThan(50);
    for (const line of lines) {
      expect(Object.keys(line), JSON.stringify(line)).toEqual(expect.arrayContaining(required));
      expect(Object.keys(line).filter((key) => !(key in real))).toEqual([]);
    }
  });

  it("keeps a damaged request line, a line of another event and a non-JSON line, which the script must skip", () => {
    expect(fixture.filter((line) => line.event === "request" && line.route === undefined)).toHaveLength(1);
    expect(fixture.some((line) => line.event === "client_error")).toBe(true);
    expect(rawFixture).toContain("not JSON");
  });
});
