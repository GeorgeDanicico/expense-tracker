import { afterEach, describe, expect, it, vi } from "vitest";

import { CROSS_SITE_REFUSED, isAppOrigin, refuseForeignRequest } from "@/lib/http/guard";

const TAILNET = "https://ifam.tailnet-1234.ts.net";

/** A request as the container sees it: Tailscale Serve forwards to 127.0.0.1:3000. */
function request(headers: Record<string, string> = {}, method = "POST", url = "http://127.0.0.1:3000/api/todos") {
  return new Request(url, { method, headers });
}

afterEach(() => vi.unstubAllEnvs());

describe("refuseForeignRequest", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "post"])("checks %s", (method) => {
    expect(refuseForeignRequest(request({ "sec-fetch-site": "cross-site" }, method))).toMatchObject({
      status: 403,
      message: CROSS_SITE_REFUSED,
    });
  });

  it.each(["GET", "HEAD", "OPTIONS"])("never checks %s", (method) => {
    expect(refuseForeignRequest(request({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }, method))).toBeNull();
  });

  it.each(["cross-site", "same-site", "Cross-Site"])("refuses Sec-Fetch-Site: %s", (site) => {
    expect(refuseForeignRequest(request({ "sec-fetch-site": site }))).not.toBeNull();
  });

  it.each(["same-origin", "none"])("allows Sec-Fetch-Site: %s without an Origin", (site) => {
    expect(refuseForeignRequest(request({ "sec-fetch-site": site }))).toBeNull();
  });

  it("refuses a same-origin claim whose Origin is someone else's", () => {
    expect(refuseForeignRequest(request({ "sec-fetch-site": "same-origin", origin: "https://evil.example" }))).not.toBeNull();
  });

  it("allows a request with neither header (curl, server-to-server); the session still decides", () => {
    expect(refuseForeignRequest(request())).toBeNull();
  });

  it("skips a handler called with no request (tests only)", () => {
    expect(refuseForeignRequest(undefined)).toBeNull();
  });
});

describe("isAppOrigin", () => {
  describe("in production with SITE_URL", () => {
    it("accepts only SITE_URL's origin, even when the container sees another host", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("SITE_URL", `${TAILNET}/`);

      expect(isAppOrigin(TAILNET, request())).toBe(true);
      // The container's own address is not what the browser opened.
      expect(isAppOrigin("http://127.0.0.1:3000", request())).toBe(false);
      expect(isAppOrigin("http://ifam.tailnet-1234.ts.net", request())).toBe(false);
      expect(isAppOrigin("https://other.tailnet-1234.ts.net", request({ host: "other.tailnet-1234.ts.net" }))).toBe(false);
    });
  });

  describe("without SITE_URL", () => {
    it("accepts the host the request was sent to, from X-Forwarded-Host, Host or the URL", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("SITE_URL", "");

      expect(isAppOrigin(TAILNET, request({ "x-forwarded-host": "ifam.tailnet-1234.ts.net", host: "127.0.0.1:3000" }))).toBe(true);
      expect(isAppOrigin(TAILNET, request({ host: "ifam.tailnet-1234.ts.net" }))).toBe(true);
      expect(isAppOrigin("http://127.0.0.1:3000", request())).toBe(true);
      expect(isAppOrigin("https://evil.example", request({ host: "ifam.tailnet-1234.ts.net" }))).toBe(false);
    });
  });

  describe("in development with SITE_URL", () => {
    it("accepts SITE_URL and the address next dev was opened at", () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("SITE_URL", "http://localhost:3000");

      expect(isAppOrigin("http://localhost:3000", request())).toBe(true);
      expect(isAppOrigin("http://192.168.1.20:3000", request({ host: "192.168.1.20:3000" }))).toBe(true);
      expect(isAppOrigin("http://localhost:3001", request({ host: "localhost:3000" }))).toBe(false);
      expect(isAppOrigin("https://evil.example", request({ host: "localhost:3000" }))).toBe(false);
    });
  });

  it.each(["null", "not a url", "file:///etc/passwd", "chrome-extension://abc"])("refuses Origin: %s", (origin) => {
    vi.stubEnv("SITE_URL", "");
    expect(isAppOrigin(origin, request())).toBe(false);
  });

  it("falls back to the request's host when SITE_URL isn't a URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "not a url");
    expect(isAppOrigin("http://127.0.0.1:3000", request())).toBe(true);
  });
});
