import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetcher, apiRequest, OFFLINE_CODE, retryDelay, TIMEOUT_CODE } from "./client";

const ID = "3fK9xQ2mBv0a";

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function failure(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the request to fail");
}

afterEach(() => vi.unstubAllGlobals());

describe("ApiError request refs", () => {
  it("ends the message of a 500 with the id from the x-request-id header", async () => {
    stubFetch(failure(500, { error: "Something went wrong on our side." }, { "x-request-id": ID }));

    const error = await caught(apiFetcher("/api/expenses"));

    expect(error.message).toBe(`Something went wrong on our side. (ref ${ID})`);
    expect(error.requestId).toBe(ID);
    expect(error.status).toBe(500);
  });

  it("falls back to the requestId in the 500 body when there is no header", async () => {
    stubFetch(failure(500, { error: "Something went wrong on our side.", requestId: ID }));

    const error = await caught(apiRequest("/api/expenses", { method: "POST", body: "{}" }));

    expect(error.message).toBe(`Something went wrong on our side. (ref ${ID})`);
    expect(error.requestId).toBe(ID);
  });

  it("prefers the header over the body", async () => {
    stubFetch(failure(502, { error: "Bad gateway.", requestId: "aaaaaaaaaaaa" }, { "x-request-id": ID }));

    expect((await caught(apiFetcher("/api/x"))).requestId).toBe(ID);
  });

  it("adds the ref to the generic message when a 5xx has no error text", async () => {
    stubFetch(failure(503, {}, { "x-request-id": ID }));

    expect((await caught(apiFetcher("/api/x"))).message).toBe(`Something went wrong. Please try again. (ref ${ID})`);
  });

  it("leaves a 5xx without an id as it was", async () => {
    stubFetch(failure(500, { error: "Something went wrong on our side." }));

    const error = await caught(apiFetcher("/api/x"));

    expect(error.message).toBe("Something went wrong on our side.");
    expect(error.requestId).toBeUndefined();
  });

  it("ignores a value that isn't shaped like a request id", async () => {
    stubFetch(failure(500, { error: "Oops.", requestId: "not an id <script>" }, { "x-request-id": "short" }));

    const error = await caught(apiFetcher("/api/x"));

    expect(error.message).toBe("Oops.");
    expect(error.requestId).toBeUndefined();
  });

  it("keeps a 4xx message as it is, and still carries the id", async () => {
    stubFetch(failure(400, { error: "Enter an amount.", fieldErrors: { amount: ["Required"] }, code: "invalid" }, { "x-request-id": ID }));

    const error = await caught(apiRequest("/api/expenses", { method: "POST", body: "{}" }));

    expect(error.message).toBe("Enter an amount.");
    expect(error.requestId).toBe(ID);
    expect(error.fieldErrors).toEqual({ amount: ["Required"] });
    expect(error.code).toBe("invalid");
  });

  it("gives no ref to the 503 the client makes up when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await caught(apiFetcher("/api/x"));

    expect(error.status).toBe(503);
    expect(error.message).not.toContain("ref");
    expect(error.requestId).toBeUndefined();
  });

  it("gives no ref to the 504 the client makes up on a timeout", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockImplementation(
          (_url, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            }),
        ),
      );

      const pending = caught(apiFetcher("/api/x"));
      await vi.advanceTimersByTimeAsync(15_000);
      const error = await pending;

      expect(error.status).toBe(504);
      expect(error.message).not.toContain("ref");
      expect(error.requestId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

function hangingFetch() {
  return vi.fn<typeof fetch>().mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
}

describe("a 401", () => {
  function stubWindow(pathname: string, search = "") {
    const location = { pathname, search, replace: vi.fn() };
    vi.stubGlobal("window", { location });
    return location;
  }

  it("sends the browser to sign in from a read, with the page it was on", async () => {
    stubFetch(failure(401, { error: "Unauthorized" }));
    const location = stubWindow("/expenses", "?month=2026-10");

    const error = await caught(apiFetcher("/api/expenses"));

    expect(error.status).toBe(401);
    expect(location.replace).toHaveBeenCalledWith("/login?next=%2Fexpenses%3Fmonth%3D2026-10");
  });

  it("does the same from a write, once for several requests", async () => {
    stubFetch(failure(401, { error: "Unauthorized" }));
    const location = stubWindow("/todos");

    await Promise.all([caught(apiRequest("/api/todos", { method: "POST" })), caught(apiFetcher("/api/todos"))]);

    expect(location.replace).toHaveBeenCalledTimes(1);
  });

  it("leaves the sign-in page to show its own 'wrong password' answer", async () => {
    stubFetch(failure(401, { error: "Incorrect email or password." }));
    const location = stubWindow("/login");

    const error = await caught(apiRequest("/api/auth", { method: "POST" }));

    expect(error.message).toBe("Incorrect email or password.");
    expect(location.replace).not.toHaveBeenCalled();
  });
});

describe("a request that can't finish", () => {
  it("marks the timeout it makes up, so it isn't retried", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", hangingFetch());
      const pending = caught(apiFetcher("/api/x"));
      await vi.advanceTimersByTimeAsync(15_000);
      expect((await pending).code).toBe(TIMEOUT_CODE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says the device is offline when it has no connection", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")));
    vi.stubGlobal("navigator", { onLine: false });

    const error = await caught(apiFetcher("/api/x"));

    expect(error.code).toBe(OFFLINE_CODE);
    expect(error.message).toContain("offline");
  });

  it("keeps the generic message when the device is online but the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")));
    vi.stubGlobal("navigator", { onLine: true });

    const error = await caught(apiFetcher("/api/x"));

    expect(error.code).toBeUndefined();
    expect(error.message).toContain("Unable to reach the server");
  });
});

describe("retryDelay", () => {
  const server = new ApiError("Something went wrong on our side.", 500);

  it("retries a server failure after 3 s, at most twice", () => {
    expect(retryDelay("/a", server, 1, 2)).toBe(3_000);
    expect(retryDelay("/a", server, 2, 2)).toBe(3_000);
    expect(retryDelay("/a", server, 3, 2)).toBeNull();
  });

  it.each([
    ["a timeout", new ApiError("slow", 504, undefined, TIMEOUT_CODE)],
    ["an offline device", new ApiError("offline", 503, undefined, OFFLINE_CODE)],
    ["a refusal", new ApiError("no", 403)],
    ["a missing page", new ApiError("gone", 404)],
    ["a sign-in", new ApiError("no", 401)],
  ])("doesn't retry %s", (_, error) => {
    expect(retryDelay("/b", error, 1, 2)).toBeNull();
  });

  it("does retry a 429, a gateway's 504 and a failure that isn't an ApiError", () => {
    expect(retryDelay("/c", new ApiError("slow down", 429), 1, 2)).toBe(3_000);
    expect(retryDelay("/c", new ApiError("gateway", 504), 1, 2)).toBe(3_000);
    expect(retryDelay("/c", new Error("boom"), 1, 2)).toBe(3_000);
  });

  it("stops retrying when the first try's 15 s are nearly used", async () => {
    vi.useFakeTimers();
    try {
      stubFetch(failure(500, { error: "x" }));
      await caught(apiFetcher("/api/late"));
      vi.advanceTimersByTime(11_000);
      // 11 s in: a retry would start at 14 s and have 1 s, under the 2 s worth trying.
      expect(retryDelay("/api/late", server, 1, 2)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cuts a retry's timeout to what is left of the 15 s", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(failure(500, { error: "x" })).mockImplementation(hangingFetch());
      vi.stubGlobal("fetch", fetchMock);
      await caught(apiFetcher("/api/budget"));
      expect(retryDelay("/api/budget", server, 1, 2)).toBe(3_000);
      vi.advanceTimersByTime(3_000);

      const retry = caught(apiFetcher("/api/budget"));
      await vi.advanceTimersByTimeAsync(11_999);
      expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await retry).code).toBe(TIMEOUT_CODE);
    } finally {
      vi.useRealTimers();
    }
  });
});
