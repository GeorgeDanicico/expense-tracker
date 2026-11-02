import { afterEach, describe, expect, it, vi } from "vitest";

import { clientIp, clientKey, UNKNOWN_CLIENT } from "@/lib/http/client-ip";

function request(headers: Record<string, string>) {
  return new Request("http://localhost/api/auth", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIp, with one trusted proxy hop (the default)", () => {
  it("takes the last X-Forwarded-For hop, the one our own proxy added", () => {
    expect(clientIp(request({ "x-forwarded-for": "198.51.100.9, 10.0.0.1 , 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("takes a single X-Forwarded-For address", () => {
    expect(clientIp(request({ "x-forwarded-for": " 203.0.113.7 " }))).toBe("203.0.113.7");
  });

  it("answers null when the request names no address, or its last hop is empty", () => {
    expect(clientIp(request({}))).toBeNull();
    expect(clientIp(request({ "x-forwarded-for": " " }))).toBeNull();
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7, " }))).toBeNull();
  });

  it("never reads X-Real-IP, which a client can set freely", () => {
    expect(clientIp(request({ "x-real-ip": "203.0.113.8" }))).toBeNull();
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7, ", "x-real-ip": "203.0.113.8" }))).toBeNull();
  });
});

describe("clientIp, with TRUSTED_PROXY_HOPS set", () => {
  it("takes the first of the last N hops, so two proxies in a row are both skipped", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");

    expect(clientIp(request({ "x-forwarded-for": "198.51.100.9, 203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("doesn't trust a header with fewer hops than the proxies add: it didn't come through them", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");

    expect(clientIp(request({ "x-forwarded-for": "198.51.100.9" }))).toBeNull();
  });

  it("ignores the header altogether at 0", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");

    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7" }))).toBeNull();
  });

  it("falls back to one hop when the setting isn't a whole number from 0 to 5", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "lots");

    expect(clientIp(request({ "x-forwarded-for": "198.51.100.9, 203.0.113.7" }))).toBe("203.0.113.7");
  });
});

describe("clientKey", () => {
  it("is the client IP, or one fixed bucket when there is none", () => {
    expect(clientKey(request({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientKey(request({}))).toBe(UNKNOWN_CLIENT);
    expect(clientKey(undefined)).toBe(UNKNOWN_CLIENT);
  });
});
