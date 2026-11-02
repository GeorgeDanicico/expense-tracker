import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));

import { onRequestError, register } from "@/instrumentation";
import { logRequestFailure } from "@/lib/http/request-log";
import { REQUEST_ID_FROM_PROXY, REQUEST_ID_HEADER, REQUEST_ID_SOURCE_HEADER } from "@/lib/log/request-id";
import { loggedLines } from "@/test/log-lines";

// Built at runtime so no secret-shaped string sits in the source (gitleaks scans the history).
const SECRET = ["sb", "publishable", "DO_NOT_PRINT_ME"].join("_");

/** Makes `process.exit` throw so the test sees the exit and the code after it never runs. */
function stubExit() {
  return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never);
}

beforeEach(() => {
  logged.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("register", () => {
  it("stops the web app with a line naming the missing variable and no value", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", SECRET);
    const exit = stubExit();

    await expect(register()).rejects.toThrow("exit 1");

    expect(exit).toHaveBeenCalledWith(1);
    const [line] = loggedLines(logged, "env_check_failed");
    expect(line).toMatchObject({ level: "error", process: "web", problems: ["SUPABASE_URL is empty"] });
    expect(logged.join("")).not.toContain("SUPABASE_PUBLISHABLE_KEY");
    expect(logged.join("")).not.toContain(SECRET);
  });

  it("starts, with one line about the optional features that are off, when the required ones are set", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", SECRET);
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const exit = stubExit();

    await register();

    expect(exit).not.toHaveBeenCalled();
    const lines = loggedLines(logged, "env_optional_off");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info" });
    expect(JSON.stringify(lines[0].off)).toContain("SUPABASE_SECRET_KEY");
    expect(logged.join("")).not.toContain(SECRET);
  });

  it("checks nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("SUPABASE_URL", "");
    const exit = stubExit();

    await register();

    expect(exit).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });
});

describe("onRequestError", () => {
  const request = (overrides: Partial<Parameters<typeof onRequestError>[1]> = {}) => ({
    path: "/expenses/6c3f1d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f?month=2026-09&token=abc",
    method: "GET",
    headers: {
      cookie: "session=private-cookie",
      authorization: "Bearer private-bearer",
      [REQUEST_ID_HEADER]: "AbCd1234EfGh",
      [REQUEST_ID_SOURCE_HEADER]: REQUEST_ID_FROM_PROXY,
    } as { [key: string]: string | string[] },
    ...overrides,
  });
  const context = (overrides: Partial<Parameters<typeof onRequestError>[2]> = {}) => ({
    routerKind: "App Router" as const,
    routePath: "/expenses/[id]",
    routeType: "render" as const,
    renderSource: "react-server-components" as const,
    revalidateReason: undefined,
    renderType: "dynamic" as const,
    ...overrides,
  });

  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
  });

  it("writes one server_render_failed line with where it happened, the digest and the request id", async () => {
    const error = Object.assign(new Error("render blew up"), { digest: "1234567890" });

    await onRequestError(error, request(), context());

    expect(loggedLines(logged)).toEqual([
      expect.objectContaining({
        level: "error",
        event: "server_render_failed",
        error: expect.objectContaining({ name: "Error", message: "render blew up" }),
        digest: "1234567890",
        routePath: "/expenses/[id]",
        routeType: "render",
        renderSource: "react-server-components",
        method: "GET",
        route: "/expenses/:id",
        requestId: "AbCd1234EfGh",
      }),
    ]);
  });

  it("never logs the headers, the query string or the raw path", async () => {
    await onRequestError(new Error("boom"), request(), context());

    const text = logged.join("");
    for (const leaked of ["private-cookie", "private-bearer", "token=abc", "month=2026", "6c3f1d2e"]) expect(text).not.toContain(leaked);
  });

  it("leaves the request id out unless the proxy set it", async () => {
    const headers = { [REQUEST_ID_HEADER]: "Forged123456" };

    await onRequestError(new Error("boom"), request({ headers }), context());

    expect(loggedLines(logged, "server_render_failed")[0]).not.toHaveProperty("requestId");
  });

  it("skips a route error a wrapper already logged as request_failed, so it is written once", async () => {
    const error = new Error("handler blew up");
    logRequestFailure(error);
    logged.length = 0;

    await onRequestError(error, request({ path: "/api/expenses" }), context({ routeType: "route", routePath: "/api/expenses" }));

    expect(logged).toEqual([]);
  });

  it("logs a route error no wrapper saw, and a marked error that came from a render", async () => {
    const marked = new Error("marked");
    logRequestFailure(marked);
    logged.length = 0;

    await onRequestError(new Error("unwrapped"), request({ path: "/api/other" }), context({ routeType: "route", routePath: "/api/other" }));
    await onRequestError(marked, request(), context());

    expect(loggedLines(logged, "server_render_failed")).toHaveLength(2);
  });

  it("logs a thrown non-error value", async () => {
    await onRequestError("just a string", request(), context({ routeType: "action" }));

    expect(loggedLines(logged, "server_render_failed")).toEqual([
      expect.objectContaining({ error: { name: "NonError", message: "just a string" }, routeType: "action" }),
    ]);
  });

  it("writes nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await onRequestError(new Error("boom"), request(), context());

    expect(logged).toEqual([]);
  });
});
