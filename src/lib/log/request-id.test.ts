import { describe, expect, it } from "vitest";

import { createRequestId, isRequestId, proxyRequestId } from "@/lib/log/request-id";

describe("createRequestId", () => {
  it("makes 12 characters of [A-Za-z0-9]", () => {
    for (let made = 0; made < 200; made += 1) expect(createRequestId()).toMatch(/^[A-Za-z0-9]{12}$/);
  });

  it("never repeats itself and uses the whole alphabet", () => {
    const ids = Array.from({ length: 2000 }, () => createRequestId());
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids.join("")).size).toBe(62);
  });
});

describe("isRequestId", () => {
  it("accepts only the id's shape", () => {
    expect(isRequestId("3fK9xQ2mBv0a")).toBe(true);
    for (const bad of ["", "3fK9xQ2mBv0", "3fK9xQ2mBv0ab", "3fK9xQ2mBv0-", "3fK9xQ2m v0a", "3fK9xQ2mBv0a\n"]) {
      expect(isRequestId(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("proxyRequestId", () => {
  const ID = "Proxy1234567";
  const fromProxy = (extra: Record<string, string> = {}) =>
    new Headers({ "x-request-id": ID, "x-request-id-source": "proxy", ...extra });

  it("trusts the id on a path the proxy runs on, when the proxy marked it", () => {
    for (const path of ["/api/expenses", "/api/expenses/6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f", "/dashboard", "/auth/confirm", "/api/calendar/feed-link"]) {
      expect(proxyRequestId(fromProxy(), path), path).toBe(ID);
    }
  });

  it("ignores the id without the proxy's marker, or with another value in it", () => {
    expect(proxyRequestId(new Headers({ "x-request-id": ID }), "/api/expenses")).toBeNull();
    expect(proxyRequestId(fromProxy({ "x-request-id-source": "client" }), "/api/expenses")).toBeNull();
  });

  it("ignores an id that isn't the proxy's shape", () => {
    expect(proxyRequestId(fromProxy({ "x-request-id": "chosen-by-client" }), "/api/expenses")).toBeNull();
    expect(proxyRequestId(new Headers({ "x-request-id-source": "proxy" }), "/api/expenses")).toBeNull();
  });

  it("ignores both headers on every path the proxy skips, where the client sent them itself", () => {
    for (const path of [
      "/api/mcp",
      "/api/csp-report",
      "/api/client-log",
      "/api/calendar/feed/sl_cal_token.ics",
      "/.well-known/oauth-protected-resource/api/mcp",
      "/health",
      "/api/%6dcp",
    ]) {
      expect(proxyRequestId(fromProxy(), path), path).toBeNull();
    }
  });
});
