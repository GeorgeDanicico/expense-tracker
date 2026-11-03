import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleWindowError = vi.hoisted(() => vi.fn());
const handleUnhandledRejection = vi.hoisted(() => vi.fn());

vi.mock("@/lib/client-log", () => ({ handleWindowError, handleUnhandledRejection }));

const listeners: Record<string, (event: unknown) => void> = {};

beforeEach(() => {
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener;
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("instrumentation-client", () => {
  it("turns off Zod's eval probe in the browser, so the CSP sees no eval", async () => {
    expect(z.config().jitless).toBeFalsy();
    await import("@/instrumentation-client");
    expect(z.config().jitless).toBe(true);
  });

  it("hands uncaught errors and unhandled rejections to the client log", async () => {
    await import("@/instrumentation-client");
    const errorEvent = { message: "boom" };
    const rejection = { reason: new Error("nope") };

    listeners.error(errorEvent);
    await vi.waitFor(() => expect(handleWindowError).toHaveBeenCalledExactlyOnceWith(errorEvent));

    listeners.unhandledrejection(rejection);
    await vi.waitFor(() => expect(handleUnhandledRejection).toHaveBeenCalledExactlyOnceWith(rejection));
  });
});
