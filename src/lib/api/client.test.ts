import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetcher, apiRequest } from "./client";

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
