import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";
import { describe, expect, it } from "vitest";

import {
  contentSecurityPolicy,
  createNonce,
  CSP_HEADER,
  CSP_REPORT_GROUP,
  CSP_REPORT_PATH,
  REPORTING_ENDPOINTS,
} from "@/lib/http/csp";

/** The policy as `{ directive: sources }`. */
function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split(";").map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

describe("createNonce", () => {
  it("makes a fresh 128-bit base64 value every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(atob(nonce)).toHaveLength(16);
    }
  });
});

describe("contentSecurityPolicy", () => {
  const nonce = createNonce();

  it("allows scripts only through this response's nonce and what they load", () => {
    const policy = directives(contentSecurityPolicy({ nonce, dev: false }));
    expect(policy["script-src"]).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]);
    expect(policy["script-src"]).not.toContain("'unsafe-inline'");
  });

  it("is a policy Next takes the nonce from, so its own scripts carry it", () => {
    expect(getScriptNonceFromHeader(contentSecurityPolicy({ nonce, dev: false }))).toBe(nonce);
    expect(getScriptNonceFromHeader(contentSecurityPolicy({ nonce, dev: true }))).toBe(nonce);
  });

  it("adds 'unsafe-eval' in development only", () => {
    expect(directives(contentSecurityPolicy({ nonce, dev: true }))["script-src"]).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ nonce, dev: false })).not.toContain("unsafe-eval");
  });

  it("locks down everything else to the app's own origin", () => {
    expect(directives(contentSecurityPolicy({ nonce, dev: false }))).toMatchObject({
      "default-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "blob:"],
      "font-src": ["'self'"],
      "connect-src": ["'self'"],
      "worker-src": ["'self'"],
      "manifest-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
    });
  });

  it("sends reports to /api/csp-report through both report-uri and report-to", () => {
    const policy = directives(contentSecurityPolicy({ nonce, dev: false }));
    expect(policy["report-uri"]).toEqual([CSP_REPORT_PATH]);
    expect(policy["report-to"]).toEqual([CSP_REPORT_GROUP]);
    expect(CSP_REPORT_PATH).toBe("/api/csp-report");
    expect(REPORTING_ENDPOINTS).toBe(`${CSP_REPORT_GROUP}="/api/csp-report"`);
  });

  it("is report-only until S14 enforces it", () => {
    expect(CSP_HEADER).toBe("Content-Security-Policy-Report-Only");
  });

  it("is a single header line", () => {
    expect(contentSecurityPolicy({ nonce, dev: true })).not.toMatch(/[\r\n]/);
  });
});
