import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));

import { isLoggedRequestFailure, logRequest, logRequestFailure, withRequestIdHeader } from "@/lib/http/request-log";
import { addRequestFields } from "@/lib/log/request-context";
import { recordSpan, span } from "@/lib/log/span";
import { loggedLines } from "@/test/log-lines";

const request = (path = "/api/csp-report") => new Request(`http://localhost${path}`, { method: "POST" });

beforeEach(() => {
  logged.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("logRequest", () => {
  it.each([
    [204, "info", "debug"],
    [400, "info", "debug"],
    [429, "warn", "debug"],
    [500, "error", "error"],
    [503, "error", "error"],
  ])("writes a %i at %s, or %s when quiet", async (status, level, quietLevel) => {
    await logRequest(request(), async () => new Response(null, { status }));
    await logRequest(request(), async () => new Response(null, { status }), { quiet: true });

    expect(loggedLines(logged, "request").map((line) => line.level)).toEqual([level, quietLevel]);
  });

  it("still warns about a slow request when quiet", async () => {
    vi.stubEnv("LOG_SLOW_MS", "1");
    await logRequest(request(), async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(null, { status: 204 });
    }, { quiet: true });

    expect(loggedLines(logged, "request")).toEqual([expect.objectContaining({ level: "warn", slow: true })]);
  });

  it("logs a thrown non-error value as a failure and rethrows it as it was", async () => {
    await expect(logRequest(request(), async () => { throw "plain string"; })).rejects.toBe("plain string");

    expect(loggedLines(logged, "request_failed")).toEqual([
      expect.objectContaining({ error: { name: "NonError", message: "plain string" } }),
    ]);
  });
});

describe("the request line's spans", () => {
  it("lists the spans with dbMs and dbCalls, and no slowestSpan when the request was quick", async () => {
    await logRequest(request(), async () => {
      recordSpan("db.expenses.get", 12.4);
      recordSpan("rpc.move_todo", 30);
      recordSpan("push.send", 50);
      return new Response(null, { status: 204 });
    });

    const [line] = loggedLines(logged, "request");
    expect(line).toMatchObject({
      level: "info",
      spans: [
        { name: "db.expenses.get", ms: 12 },
        { name: "rpc.move_todo", ms: 30 },
        { name: "push.send", ms: 50 },
      ],
      dbMs: 42,
      dbCalls: 2,
    });
    expect(line).not.toHaveProperty("slowestSpan");
  });

  it("names the slowest single call of a slow request", async () => {
    vi.stubEnv("LOG_SLOW_MS", "5");
    await logRequest(request(), async () => {
      recordSpan("db.expenses.get", 2);
      await span("ai.openai.gpt-5", () => new Promise((resolve) => setTimeout(resolve, 15)));
      recordSpan("db.expenses.get", 3);
      return new Response(null, { status: 200 });
    });

    const [line] = loggedLines(logged, "request");
    expect(line).toMatchObject({ level: "warn", slow: true, dbMs: 5, dbCalls: 2, slowestSpan: { name: "ai.openai.gpt-5", ms: expect.any(Number) } });
    expect((line.slowestSpan as { ms: number }).ms).toBeGreaterThanOrEqual(10);
  });

  it("keeps the span totals of a request that failed", async () => {
    await logRequest(request(), async () => {
      recordSpan("db.expenses.get", 4);
      throw new Error("boom");
    }).catch(() => {});

    expect(loggedLines(logged, "request")[0]).toMatchObject({ status: 500, dbMs: 4, dbCalls: 1 });
  });

  it("doesn't let a handler's fields replace them", async () => {
    await logRequest(request(), async () => {
      addRequestFields({ dbMs: 999, dbCalls: 999, slowestSpan: "x", spans: "x" });
      return new Response(null, { status: 204 });
    });

    expect(loggedLines(logged, "request")[0]).toMatchObject({ spans: [], dbMs: 0, dbCalls: 0 });
  });
});

describe("logRequestFailure", () => {
  it("logs each error once and marks it", async () => {
    const error = new Error("boom");
    expect(isLoggedRequestFailure(error)).toBe(false);

    await logRequest(request(), async () => {
      logRequestFailure(error);
      logRequestFailure(error);
      throw error;
    }).catch(() => {});

    expect(loggedLines(logged, "request_failed")).toHaveLength(1);
    expect(isLoggedRequestFailure(error)).toBe(true);
    expect(isLoggedRequestFailure("boom")).toBe(false);
  });
});

describe("withRequestIdHeader", () => {
  it("sets the header in place when it can", () => {
    const response = new Response("x", { status: 201, headers: { "content-type": "text/plain" } });

    expect(withRequestIdHeader(response, "Abc123Def456")).toBe(response);
    expect(response.headers.get("x-request-id")).toBe("Abc123Def456");
  });

  it("copies a response whose headers are immutable, keeping its status, headers and body", async () => {
    const original = Response.redirect("http://localhost/login", 307);
    expect(() => original.headers.set("x", "y")).toThrow();

    const response = withRequestIdHeader(original, "Abc123Def456");

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
    expect(response.headers.get("x-request-id")).toBe("Abc123Def456");
  });
});

describe("every route handler", () => {
  const APP_DIR = fileURLToPath(new URL("../../app", import.meta.url));
  const WRAPPERS = /\b(withUser|withPermission|withParent|withRequestGuard|withAnonymousLimit|logRequest)\(/;
  const routes = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
    .filter((file) => file.split(sep).at(-1) === "route.ts")
    .map((file) => file.split(sep).join("/"))
    .sort();

  it.each(routes.filter((file) => file !== "health/route.ts"))("%s writes a request line through a wrapper or logRequest", (file) => {
    expect(readFileSync(join(APP_DIR, file), "utf8")).toMatch(WRAPPERS);
  });

  it("leaves /health out on purpose", () => {
    expect(routes).toContain("health/route.ts");
    expect(readFileSync(join(APP_DIR, "health/route.ts"), "utf8")).not.toMatch(WRAPPERS);
  });
});
