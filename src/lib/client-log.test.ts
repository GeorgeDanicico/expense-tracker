import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLIENT_ERROR_MESSAGE_MAX,
  CLIENT_ERROR_NAME_MAX,
  CLIENT_ERROR_STACK_MAX,
  CLIENT_LOG_MAX_BYTES,
  CLIENT_LOG_MAX_EVENTS,
  CLIENT_LOG_PATH,
  clientLogBodySchema,
  type ClientEvent,
} from "@/lib/log/client-report";
import { FAKE_JWT } from "@/test/fake-secrets";

type ClientLog = typeof import("./client-log");
type ApiErrorClass = typeof import("@/lib/api/client").ApiError;

const ID = "3fK9xQ2mBv0a";
const FLUSH = 5_000;

type Listener = () => void;

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let windowListeners: Record<string, Listener[]>;
let documentListeners: Record<string, Listener[]>;
let documentState: { visibilityState: string };
let log: ClientLog;
/** The `ApiError` of the module graph `log` was loaded with: `resetModules` gives every test its own. */
let ApiError: ApiErrorClass;

function fire(listeners: Record<string, Listener[]>, type: string) {
  for (const listener of listeners[type] ?? []) listener();
}

function listenerRegistry(into: Record<string, Listener[]>) {
  return (type: string, listener: Listener) => {
    (into[type] ??= []).push(listener);
  };
}

/** Every event sent so far, across all requests, parsed. */
function sentEvents(): ClientEvent[] {
  return fetchMock.mock.calls.flatMap(([, init]) => JSON.parse(String(init?.body)).events as ClientEvent[]);
}

function sentBodies(): string[] {
  return fetchMock.mock.calls.map(([, init]) => String(init?.body));
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T10:00:00Z"));
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_RELEASE", "");
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  windowListeners = {};
  documentListeners = {};
  documentState = { visibilityState: "visible" };
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", {
    location: { pathname: "/expenses/6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f", search: "?token=secret", hash: "#x" },
    addEventListener: listenerRegistry(windowListeners),
  });
  vi.stubGlobal("document", Object.assign(documentState, { addEventListener: listenerRegistry(documentListeners) }));
  log = await import("./client-log");
  ({ ApiError } = await import("@/lib/api/client"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const error = (message: string, extra: Partial<Parameters<ClientLog["reportClientEvent"]>[0]> = {}) =>
  ({ kind: "error", source: "window", name: "TypeError", message, ...extra }) as Parameters<ClientLog["reportClientEvent"]>[0];

describe("reportClientEvent", () => {
  it("sends nothing until the flush interval, then one request", async () => {
    log.reportClientEvent(error("boom"));

    await vi.advanceTimersByTimeAsync(FLUSH - 1);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("posts JSON to the endpoint, same-origin and keepalive", async () => {
    log.reportClientEvent(error("boom"));
    await vi.advanceTimersByTimeAsync(FLUSH);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CLIENT_LOG_PATH);
    expect(init).toMatchObject({
      method: "POST",
      keepalive: true,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("builds a body the endpoint's schema accepts, with the page as a path only", async () => {
    log.reportClientEvent(error("boom"));
    log.reportClientEvent({ kind: "vital", name: "LCP", value: 1200.5, rating: "good", navigationType: "navigate" });
    await vi.advanceTimersByTimeAsync(FLUSH);

    const body = JSON.parse(sentBodies()[0]);
    expect(clientLogBodySchema.safeParse(body).success).toBe(true);
    for (const event of body.events) {
      expect(event.page).toBe("/expenses/6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f");
    }
    expect(sentBodies()[0]).not.toContain("token");
  });

  it("sends the release when the build has one, and leaves it out otherwise", async () => {
    log.reportClientEvent(error("first"));
    await vi.advanceTimersByTimeAsync(FLUSH);
    expect(sentEvents()[0]).not.toHaveProperty("release");

    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_RELEASE", "50c9aef5c451b4659cd6fed3537cabafedf6b3d4");
    fetchMock.mockClear();
    const withRelease = await import("./client-log");
    withRelease.reportClientEvent(error("second"));
    await vi.advanceTimersByTimeAsync(FLUSH);
    expect(sentEvents()[0]).toMatchObject({ release: "50c9aef5c451b4659cd6fed3537cabafedf6b3d4" });
  });

  it("drops a release that isn't shaped like one instead of failing the batch", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_RELEASE", "not a release!");
    const odd = await import("./client-log");
    odd.reportClientEvent(error("boom"));
    await vi.advanceTimersByTimeAsync(FLUSH);

    expect(sentEvents()).toHaveLength(1);
    expect(sentEvents()[0]).not.toHaveProperty("release");
  });

  it("batches at most 10 events per request", async () => {
    // 20 distinct errors: the per-page cap, sent as two requests.
    for (let i = 0; i < 20; i += 1) log.reportClientEvent(error(`boom ${i}`));

    await vi.advanceTimersByTimeAsync(FLUSH);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEvents()).toHaveLength(CLIENT_LOG_MAX_EVENTS);

    await vi.advanceTimersByTimeAsync(FLUSH);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentEvents()).toHaveLength(20);
  });

  it("flushes everything at once when the page is hidden", async () => {
    for (let i = 0; i < 12; i += 1) log.reportClientEvent(error(`boom ${i}`));

    documentState.visibilityState = "hidden";
    fire(documentListeners, "visibilitychange");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentEvents()).toHaveLength(12);
    expect(sentBodies().every((body) => JSON.parse(body).events.length <= CLIENT_LOG_MAX_EVENTS)).toBe(true);
  });

  it("does not flush when the page becomes visible", () => {
    log.reportClientEvent(error("boom"));

    documentState.visibilityState = "visible";
    fire(documentListeners, "visibilitychange");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flushes on pagehide, and the timer then has nothing left to send", async () => {
    log.reportClientEvent(error("boom"));

    fire(windowListeners, "pagehide");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FLUSH * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("registers its page listeners once", () => {
    log.reportClientEvent(error("a"));
    log.reportClientEvent(error("b"));

    expect(windowListeners.pagehide).toHaveLength(1);
    expect(documentListeners.visibilitychange).toHaveLength(1);
  });

  it("keeps each request under the byte limit, even for events with long stacks", async () => {
    const stack = Array.from({ length: 200 }, () => "at fn (https://x.test/a.js:1:1)").join("\n");
    for (let i = 0; i < 10; i += 1) log.reportClientEvent(error(`${"é".repeat(400)} ${i}`, { stack }));
    fire(windowListeners, "pagehide");

    expect(sentEvents()).toHaveLength(10);
    for (const body of sentBodies()) {
      expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(CLIENT_LOG_MAX_BYTES);
      expect(clientLogBodySchema.safeParse(JSON.parse(body)).success).toBe(true);
    }
  });

  it("clips every field to the endpoint's limits so one long value can't sink the batch", async () => {
    log.reportClientEvent(
      error("m".repeat(CLIENT_ERROR_MESSAGE_MAX + 100), {
        name: "N".repeat(CLIENT_ERROR_NAME_MAX + 50),
        stack: "s".repeat(CLIENT_ERROR_STACK_MAX + 500),
      }),
    );
    log.reportClientEvent(error("ok"));
    fire(windowListeners, "pagehide");

    const events = sentEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      name: "N".repeat(CLIENT_ERROR_NAME_MAX),
      message: "m".repeat(CLIENT_ERROR_MESSAGE_MAX),
    });
    expect((events[0] as { stack: string }).stack).toHaveLength(CLIENT_ERROR_STACK_MAX);
    expect(clientLogBodySchema.safeParse(JSON.parse(sentBodies()[0])).success).toBe(true);
  });

  it("does not cut a surrogate pair in half", () => {
    log.reportClientEvent(error("a".repeat(CLIENT_ERROR_MESSAGE_MAX - 1) + "😀"));
    fire(windowListeners, "pagehide");

    const [event] = sentEvents();
    expect((event as { message: string }).message).toBe("a".repeat(CLIENT_ERROR_MESSAGE_MAX - 1));
  });

  it("drops an event the endpoint would refuse and still sends the others", () => {
    log.reportClientEvent({ kind: "vital", name: "LCP", value: -1, rating: "good" });
    log.reportClientEvent({ kind: "vital", name: "NOPE", value: 1, rating: "good" } as never);
    log.reportClientEvent(error("fine"));
    fire(windowListeners, "pagehide");

    expect(sentEvents()).toHaveLength(1);
    expect(sentEvents()[0]).toMatchObject({ message: "fine" });
  });

  it("sends only a valid request id and digest", () => {
    log.reportClientEvent(error("a", { requestId: "bad id", digest: "has spaces" }));
    log.reportClientEvent(error("b", { requestId: ID, digest: "1234567890" }));
    fire(windowListeners, "pagehide");

    const [first, second] = sentEvents() as Array<Record<string, unknown>>;
    expect(first).not.toHaveProperty("requestId");
    expect(first).not.toHaveProperty("digest");
    expect(second).toMatchObject({ requestId: ID, digest: "1234567890" });
  });

  describe("dedupe", () => {
    it("sends an identical error once a minute", async () => {
      log.reportClientEvent(error("same"));
      log.reportClientEvent(error("same"));
      await vi.advanceTimersByTimeAsync(FLUSH);
      expect(sentEvents()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(30_000);
      log.reportClientEvent(error("same"));
      await vi.advanceTimersByTimeAsync(FLUSH);
      expect(sentEvents()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(30_000);
      log.reportClientEvent(error("same"));
      await vi.advanceTimersByTimeAsync(FLUSH);
      expect(sentEvents()).toHaveLength(2);
    });

    it("keeps errors with a different message or name apart", () => {
      log.reportClientEvent(error("one"));
      log.reportClientEvent(error("two"));
      log.reportClientEvent(error("one", { name: "RangeError" }));
      fire(windowListeners, "pagehide");

      expect(sentEvents()).toHaveLength(3);
    });

    it("does not count a repeat against the page's cap", () => {
      for (let i = 0; i < 50; i += 1) log.reportClientEvent(error("same"));
      log.reportClientEvent(error("other"));
      fire(windowListeners, "pagehide");

      expect(sentEvents()).toHaveLength(2);
    });
  });

  describe("the per-page cap", () => {
    it("sends at most 20 events in a page load", async () => {
      for (let i = 0; i < 40; i += 1) log.reportClientEvent(error(`boom ${i}`));
      fire(windowListeners, "pagehide");
      await vi.advanceTimersByTimeAsync(FLUSH * 10);

      expect(sentEvents()).toHaveLength(log.MAX_EVENTS_PER_PAGE);
      expect(log.MAX_EVENTS_PER_PAGE).toBe(20);
    });

    it("keeps room for errors when Web Vitals pile up", () => {
      for (let i = 0; i < 30; i += 1) {
        log.reportClientEvent({ kind: "vital", name: "CLS", value: i / 100, rating: "good" });
      }
      for (let i = 0; i < 10; i += 1) log.reportClientEvent(error(`boom ${i}`));
      fire(windowListeners, "pagehide");

      const events = sentEvents();
      expect(events.filter((event) => event.kind === "vital")).toHaveLength(log.MAX_VITALS_PER_PAGE);
      expect(events.filter((event) => event.kind === "error")).toHaveLength(10);
    });
  });

  describe("a 429", () => {
    const tooMany = (retryAfter?: string) =>
      new Response(null, { status: 429, headers: retryAfter ? { "Retry-After": retryAfter } : {} });

    it("drops the queue and stops for the page when there is no Retry-After", async () => {
      fetchMock.mockResolvedValueOnce(tooMany());
      for (let i = 0; i < 12; i += 1) log.reportClientEvent(error(`boom ${i}`));
      await vi.advanceTimersByTimeAsync(FLUSH);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      log.reportClientEvent(error("later"));
      await vi.advanceTimersByTimeAsync(FLUSH * 100);
      fire(windowListeners, "pagehide");

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("reports again once Retry-After has passed", async () => {
      fetchMock.mockResolvedValueOnce(tooMany("30"));
      log.reportClientEvent(error("first"));
      await vi.advanceTimersByTimeAsync(FLUSH);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_000);
      log.reportClientEvent(error("during"));
      await vi.advanceTimersByTimeAsync(FLUSH);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_000);
      log.reportClientEvent(error("after"));
      await vi.advanceTimersByTimeAsync(FLUSH);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sentEvents().at(-1)).toMatchObject({ message: "after" });
    });

    it("stops for the page when Retry-After is absurd or not a number", async () => {
      fetchMock.mockResolvedValueOnce(tooMany("86400"));
      log.reportClientEvent(error("first"));
      await vi.advanceTimersByTimeAsync(FLUSH);

      await vi.advanceTimersByTimeAsync(2 * 86_400_000);
      log.reportClientEvent(error("later"));
      await vi.advanceTimersByTimeAsync(FLUSH);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("keeps reporting after other refusals, without a retry", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
      log.reportClientEvent(error("first"));
      await vi.advanceTimersByTimeAsync(FLUSH);
      log.reportClientEvent(error("second"));
      await vi.advanceTimersByTimeAsync(FLUSH);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sentEvents().map((event) => (event as { message: string }).message)).toEqual(["first", "second"]);
    });
  });

  describe("never throws and never reports itself", () => {
    it("swallows a rejected fetch without a retry or a report", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      const rejections: unknown[] = [];
      const onRejection = (reason: unknown) => rejections.push(reason);
      process.on("unhandledRejection", onRejection);
      try {
        log.reportClientEvent(error("boom"));
        await vi.advanceTimersByTimeAsync(FLUSH * 5);
      } finally {
        process.off("unhandledRejection", onRejection);
      }

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(rejections).toEqual([]);
    });

    it("swallows a fetch that throws synchronously", async () => {
      fetchMock.mockImplementation(() => {
        throw new Error("blocked");
      });

      expect(() => {
        log.reportClientEvent(error("boom"));
        fire(windowListeners, "pagehide");
      }).not.toThrow();
      await vi.advanceTimersByTimeAsync(FLUSH);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("accepts junk from callers", () => {
      expect(() => log.reportClientEvent(null as never)).not.toThrow();
      expect(() => log.reportClientEvent({ kind: "error" } as never)).not.toThrow();
      expect(() => log.reportClientError(Symbol("x"), "boundary")).not.toThrow();
      expect(() => log.reportWebVital(null as never)).not.toThrow();
    });
  });

  describe("on the server", () => {
    it("does nothing without a window", async () => {
      vi.unstubAllGlobals();
      vi.stubGlobal("fetch", fetchMock);
      vi.resetModules();
      const server = await import("./client-log");

      expect(() => server.reportClientEvent(error("boom"))).not.toThrow();
      expect(() => server.reportClientError(new Error("boom"), "boundary")).not.toThrow();
      await vi.advanceTimersByTimeAsync(FLUSH * 2);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

describe("reportClientError", () => {
  it("reports an Error's name, message and stack with the source", () => {
    const thrown = new RangeError("out of range");
    log.reportClientError(thrown, "boundary");
    fire(windowListeners, "pagehide");

    expect(sentEvents()[0]).toMatchObject({
      kind: "error",
      source: "boundary",
      name: "RangeError",
      message: "out of range",
      stack: thrown.stack,
    });
  });

  it("carries the request id of an ApiError", () => {
    log.reportClientError(new ApiError(`Failed (ref ${ID})`, 500, undefined, undefined, ID), "unhandledrejection");
    fire(windowListeners, "pagehide");

    expect(sentEvents()[0]).toMatchObject({ name: "ApiError", requestId: ID, source: "unhandledrejection" });
  });

  it("carries the digest of a server render error", () => {
    log.reportClientError(Object.assign(new Error("An error occurred in the Server Components render."), { digest: "2810403425" }), "global_boundary");
    fire(windowListeners, "pagehide");

    expect(sentEvents()[0]).toMatchObject({ source: "global_boundary", digest: "2810403425" });
  });

  it("describes a thrown non-error by its type only, never its content", () => {
    log.reportClientError({ token: FAKE_JWT }, "boundary");
    log.reportClientError("plain text", "window");
    log.reportClientError(null, "window");
    fire(windowListeners, "pagehide");

    const bodies = sentBodies().join("");
    expect(bodies).not.toContain(FAKE_JWT);
    expect(sentEvents().map((event) => (event as { message: string }).message)).toEqual([
      "Non-error value thrown (object)",
      "plain text",
      "Non-error value thrown (null)",
    ]);
  });
});

describe("the window listeners", () => {
  const errorEvent = (parts: { message?: string; filename?: string; error?: unknown }) => parts as ErrorEvent;

  it("reports an uncaught error as `window`", () => {
    log.handleWindowError(errorEvent({ message: "Uncaught TypeError: x is undefined", error: new TypeError("x is undefined") }));
    fire(windowListeners, "pagehide");

    expect(sentEvents()[0]).toMatchObject({ source: "window", name: "TypeError", message: "x is undefined" });
  });

  it("reports an event with only a message (a thrown string, a cross-origin script)", () => {
    log.handleWindowError(errorEvent({ message: "Script error." }));
    fire(windowListeners, "pagehide");

    expect(sentEvents()[0]).toMatchObject({ source: "window", message: "Script error." });
  });

  it("reports an unhandled rejection, with the request id of an ApiError", () => {
    log.handleUnhandledRejection({
      reason: new ApiError(`Failed (ref ${ID})`, 500, undefined, undefined, ID),
    } as PromiseRejectionEvent);
    log.handleUnhandledRejection({ reason: "just a string" } as PromiseRejectionEvent);
    fire(windowListeners, "pagehide");

    const [first, second] = sentEvents();
    expect(first).toMatchObject({ source: "unhandledrejection", requestId: ID });
    expect(second).toMatchObject({ source: "unhandledrejection", message: "just a string" });
  });

  it.each([
    ["chrome-extension", "chrome-extension://abcdef/content.js"],
    ["moz-extension", "moz-extension://1234/content.js"],
    ["safari-extension", "safari-extension://app/content.js"],
    ["safari-web-extension", "safari-web-extension://app/content.js"],
  ])("skips an error from a %s script by its file name", (_name, filename) => {
    log.handleWindowError(errorEvent({ message: "Uncaught Error: x", filename, error: new Error("x") }));
    fire(windowListeners, "pagehide");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips an error whose stack is in an extension, in an error or a rejection", () => {
    const thrown = new Error("injected");
    thrown.stack = "Error: injected\n    at run (chrome-extension://abcdef/content.js:1:1)";
    log.handleWindowError(errorEvent({ message: "Uncaught Error: injected", error: thrown }));
    log.handleUnhandledRejection({ reason: thrown } as PromiseRejectionEvent);
    fire(windowListeners, "pagehide");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips ResizeObserver loop notices", () => {
    log.handleWindowError(errorEvent({ message: "ResizeObserver loop completed with undelivered notifications." }));
    log.handleWindowError(errorEvent({ message: "ResizeObserver loop limit exceeded" }));
    log.handleUnhandledRejection({ reason: new Error("ResizeObserver loop limit exceeded") } as PromiseRejectionEvent);
    fire(windowListeners, "pagehide");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not mistake the app's own errors for noise", () => {
    expect(log.isIgnoredError({ message: "Cannot read properties of undefined", stack: "at fn (https://app.test/_next/static/a.js:1:1)" })).toBe(false);
  });

  it("never throws on a malformed event", () => {
    expect(() => log.handleWindowError(null as never)).not.toThrow();
    expect(() => log.handleUnhandledRejection(undefined as never)).not.toThrow();
  });
});

describe("reportWebVital", () => {
  it("reports a known metric", () => {
    log.reportWebVital({ name: "INP", value: 180, rating: "good", navigationType: "back-forward-cache" });
    fire(windowListeners, "pagehide");

    expect(sentEvents()[0]).toMatchObject({ kind: "vital", name: "INP", value: 180, rating: "good", navigationType: "back-forward-cache" });
  });

  it("leaves out a navigation type the endpoint doesn't know, and drops metrics it doesn't know", () => {
    log.reportWebVital({ name: "LCP", value: 900, rating: "poor", navigationType: "soft-navigation" });
    log.reportWebVital({ name: "Next.js-hydration", value: 1, rating: "good" });
    log.reportWebVital({ name: "FCP", value: 1, rating: "unknown" });
    fire(windowListeners, "pagehide");

    expect(sentEvents()).toHaveLength(1);
    expect(sentEvents()[0]).not.toHaveProperty("navigationType");
  });
});
