import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANONYMOUS_MAX_REQUESTS,
  INVITE_CODE_MAX_FAILURES,
  INVITE_CODE_WINDOW_MS,
  IMPORT_UPLOAD_MAX_ATTEMPTS,
  IMPORT_UPLOAD_WINDOW_MS,
  SIGN_IN_IP_MAX_FAILURES,
  SIGN_IN_NAME_MAX_FAILURES,
  SIGN_IN_WINDOW_MS,
  createFailureLimiter,
  type FailureLimiter,
  importUploadAttempts,
  inviteCodeAttempts,
  MAX_TRACKED_KEYS,
  MCP_IP_MAX_REQUESTS,
  MCP_USER_MAX_REQUESTS,
  REQUEST_WINDOW_MS,
  SIGNED_OUT_MAX_REQUESTS,
  USER_READ_MAX_REQUESTS,
  USER_WRITE_MAX_REQUESTS,
  createRequestLimiter,
  resetRateLimits,
} from "@/lib/http/rate-limit";

const WINDOW_MS = 1_000;

function fail(limiter: FailureLimiter, key: string, times: number) {
  for (let attempt = 0; attempt < times; attempt += 1) limiter.recordFailure(key);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T09:00:00.000Z"));
  resetRateLimits();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createFailureLimiter", () => {
  it("lets a key through until it reaches the maximum failures", () => {
    const limiter = createFailureLimiter({ maxFailures: 3, windowMs: WINDOW_MS });

    fail(limiter, "a", 2);
    expect(limiter.isLimited("a")).toBe(false);

    limiter.recordFailure("a");
    expect(limiter.isLimited("a")).toBe(true);
  });

  it("counts each key separately", () => {
    const limiter = createFailureLimiter({ maxFailures: 1, windowMs: WINDOW_MS });

    limiter.recordFailure("a");

    expect(limiter.isLimited("a")).toBe(true);
    expect(limiter.isLimited("b")).toBe(false);
  });

  it("stops counting each failure once the window after it has passed", () => {
    const limiter = createFailureLimiter({ maxFailures: 2, windowMs: WINDOW_MS });

    limiter.recordFailure("a");
    vi.advanceTimersByTime(600);
    limiter.recordFailure("a");
    expect(limiter.isLimited("a")).toBe(true);

    vi.advanceTimersByTime(399);
    expect(limiter.isLimited("a")).toBe(true);

    vi.advanceTimersByTime(1);
    expect(limiter.isLimited("a")).toBe(false);
  });

  it("forgets the keys that failed least recently once it remembers the maximum number of keys", () => {
    const limiter = createFailureLimiter({ maxFailures: 1, windowMs: WINDOW_MS, maxKeys: 2 });

    limiter.recordFailure("a");
    limiter.recordFailure("b");
    limiter.recordFailure("a");
    limiter.recordFailure("c");

    expect(limiter.isLimited("a")).toBe(true);
    expect(limiter.isLimited("b")).toBe(false);
    expect(limiter.isLimited("c")).toBe(true);
  });

  it("says how long a limited key must wait, in whole seconds, and 0 for a key that isn't limited", () => {
    const limiter = createFailureLimiter({ maxFailures: 2, windowMs: 60_000 });

    limiter.recordFailure("a");
    expect(limiter.retryAfterSeconds("a")).toBe(0);
    vi.advanceTimersByTime(10_500);
    limiter.recordFailure("a");

    // The first failure leaves the window 49.5 seconds from now.
    expect(limiter.retryAfterSeconds("a")).toBe(50);
    expect(limiter.retryAfterSeconds("b")).toBe(0);

    vi.advanceTimersByTime(49_499);
    expect(limiter.retryAfterSeconds("a")).toBe(1);
    vi.advanceTimersByTime(1);
    expect(limiter.retryAfterSeconds("a")).toBe(0);
    expect(limiter.isLimited("a")).toBe(false);
  });

  it("counts recordAttempt exactly like recordFailure", () => {
    const limiter = createFailureLimiter({ maxFailures: 2, windowMs: WINDOW_MS });

    limiter.recordAttempt("a");
    limiter.recordFailure("a");

    expect(limiter.isLimited("a")).toBe(true);
  });

  it("is cleared by resetRateLimits", () => {
    const limiter = createFailureLimiter({ maxFailures: 1, windowMs: WINDOW_MS });
    limiter.recordFailure("a");

    resetRateLimits();

    expect(limiter.isLimited("a")).toBe(false);
  });
});

describe("createRequestLimiter", () => {
  it("lets a key send the maximum requests in a window and refuses the next with the seconds to wait", () => {
    const limiter = createRequestLimiter({ maxRequests: 3, windowMs: 60_000 });

    expect([limiter.take("a"), limiter.take("a"), limiter.take("a")]).toEqual([0, 0, 0]);

    expect(limiter.take("a")).toBe(60);
    expect(limiter.take("b")).toBe(0);
  });

  it("slides: each request leaves the window on its own, a window after it was made", () => {
    const limiter = createRequestLimiter({ maxRequests: 2, windowMs: 60_000 });

    limiter.take("a");
    vi.advanceTimersByTime(40_000);
    limiter.take("a");
    expect(limiter.take("a")).toBe(20);

    // The first request is 59.999 seconds old: still counted. At 60 seconds it stops, the second still counts.
    vi.advanceTimersByTime(19_999);
    expect(limiter.take("a")).toBe(1);
    vi.advanceTimersByTime(1);
    expect(limiter.take("a")).toBe(0);
    // That request and the one made at 40 s fill the window again, until the 40 s one leaves at 100 s.
    expect(limiter.take("a")).toBe(40);
    vi.advanceTimersByTime(40_000);
    expect(limiter.take("a")).toBe(0);
  });

  it("doesn't count a refused request, so a client that keeps trying is let in as soon as its oldest one leaves", () => {
    const limiter = createRequestLimiter({ maxRequests: 1, windowMs: 60_000 });
    limiter.take("a");

    for (let attempt = 0; attempt < 50; attempt += 1) {
      vi.advanceTimersByTime(1_000);
      expect(limiter.take("a")).toBeGreaterThan(0);
    }

    vi.advanceTimersByTime(10_000);
    expect(limiter.take("a")).toBe(0);
  });

  it("remembers at most maxKeys keys, forgetting the ones that sent a request least recently", () => {
    const limiter = createRequestLimiter({ maxRequests: 1, windowMs: 60_000, maxKeys: 2 });

    limiter.take("a");
    limiter.take("b");
    limiter.take("c");

    expect(limiter.take("c")).toBeGreaterThan(0);
    expect(limiter.take("b")).toBeGreaterThan(0);
    // "a" was forgotten, so it starts again.
    expect(limiter.take("a")).toBe(0);
  });

  it("stays bounded by MAX_TRACKED_KEYS with the default, however many different keys call", () => {
    const limiter = createRequestLimiter({ maxRequests: 1, windowMs: 60_000 });

    for (let index = 0; index < MAX_TRACKED_KEYS + 500; index += 1) limiter.take(`ip-${index}`);

    // The oldest 500 were forgotten, the newest MAX_TRACKED_KEYS are still counted.
    expect(limiter.take("ip-0")).toBe(0);
    expect(limiter.take(`ip-${MAX_TRACKED_KEYS + 499}`)).toBeGreaterThan(0);
  });

  it("is cleared by resetRateLimits", () => {
    const limiter = createRequestLimiter({ maxRequests: 1, windowMs: 60_000 });
    limiter.take("a");

    resetRateLimits();

    expect(limiter.take("a")).toBe(0);
  });
});

describe("the request limits", () => {
  it("are the numbers documented in rate-limit.ts, per minute", () => {
    expect({
      userReads: USER_READ_MAX_REQUESTS,
      userWrites: USER_WRITE_MAX_REQUESTS,
      signedOut: SIGNED_OUT_MAX_REQUESTS,
      anonymous: ANONYMOUS_MAX_REQUESTS,
      mcpIp: MCP_IP_MAX_REQUESTS,
      mcpUser: MCP_USER_MAX_REQUESTS,
      window: REQUEST_WINDOW_MS,
    }).toEqual({ userReads: 600, userWrites: 120, signedOut: 120, anonymous: 60, mcpIp: 600, mcpUser: 300, window: 60_000 });
  });
});

describe("inviteCodeAttempts", () => {
  it("allows 10 failed codes per user in 15 minutes", () => {
    expect(INVITE_CODE_MAX_FAILURES).toBe(10);
    expect(INVITE_CODE_WINDOW_MS).toBe(15 * 60 * 1000);

    fail(inviteCodeAttempts, "user", 9);
    expect(inviteCodeAttempts.isLimited("user")).toBe(false);

    inviteCodeAttempts.recordFailure("user");
    expect(inviteCodeAttempts.isLimited("user")).toBe(true);

    vi.advanceTimersByTime(INVITE_CODE_WINDOW_MS);
    expect(inviteCodeAttempts.isLimited("user")).toBe(false);
  });
});

describe("importUploadAttempts", () => {
  it("allows 30 uploads per user an hour, the 31st is limited", () => {
    expect(IMPORT_UPLOAD_MAX_ATTEMPTS).toBe(30);
    expect(IMPORT_UPLOAD_WINDOW_MS).toBe(60 * 60 * 1000);

    fail(importUploadAttempts, "user", 29);
    expect(importUploadAttempts.isLimited("user")).toBe(false);

    importUploadAttempts.recordAttempt("user");
    expect(importUploadAttempts.isLimited("user")).toBe(true);
    expect(importUploadAttempts.isLimited("someone-else")).toBe(false);

    vi.advanceTimersByTime(IMPORT_UPLOAD_WINDOW_MS);
    expect(importUploadAttempts.isLimited("user")).toBe(false);
  });
});

describe("the sign-in limits", () => {
  it("allow 5 failures per name and 20 per IP in 15 minutes", () => {
    expect(SIGN_IN_NAME_MAX_FAILURES).toBe(5);
    expect(SIGN_IN_IP_MAX_FAILURES).toBe(20);
    expect(SIGN_IN_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});
