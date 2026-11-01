import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { CSP_REPORT_MAX_BYTES, CSP_REPORT_MAX_VIOLATIONS, NOT_A_CSP_REPORT, NOT_A_CSP_REPORT_TYPE } from "@/lib/http/csp-report";
import { REQUEST_GUARD_EXEMPTIONS } from "@/lib/http/guard";
import { CSP_REPORT_MAX_ATTEMPTS, resetRateLimits, TOO_MANY_CSP_REPORTS } from "@/lib/http/rate-limit";
import { BODY_TOO_LARGE } from "@/lib/http/route";

import { POST } from "./route";

const URL = "http://localhost/api/csp-report";

/** What Firefox and Safari send for `report-uri`. */
const LEGACY_REPORT = {
  "csp-report": {
    "document-uri": "https://ledger.tailnet.ts.net/expenses?month=2026-11&token=secret#top",
    referrer: "https://ledger.tailnet.ts.net/dashboard?x=1",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "default-src 'self'",
    disposition: "report",
    "blocked-uri": "https://evil.example/x.js?session=abc",
    "line-number": 12,
    "column-number": 4,
    "source-file": "https://ledger.tailnet.ts.net/_next/static/chunks/app.js?v=1",
    "status-code": 200,
    "script-sample": "alert(document.cookie)",
  },
};

/** What Chromium sends for `report-to`. */
function reportingApiReport(body: Record<string, unknown>, type = "csp-violation") {
  return {
    age: 10,
    type,
    url: "https://ledger.tailnet.ts.net/settings?tab=mcp",
    user_agent: "Mozilla/5.0",
    body: {
      documentURL: "https://ledger.tailnet.ts.net/settings?tab=mcp",
      effectiveDirective: "img-src",
      blockedURL: "https://tracker.example/pixel.gif?uid=42",
      disposition: "report",
      originalPolicy: "default-src 'self'",
      sample: "secret sample",
      statusCode: 200,
      ...body,
    },
  };
}

function post(body: unknown, { contentType = "application/csp-report", ip = "203.0.113.7", headers = {} as Record<string, string> } = {}) {
  return POST(
    new NextRequest(URL, {
      method: "POST",
      headers: { "content-type": contentType, "x-forwarded-for": ip, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/** The JSON objects logged, one per `console.warn` call. */
function loggedLines(spy: MockInstance) {
  return spy.mock.calls.map(([line]) => {
    expect(typeof line).toBe("string");
    expect(line).not.toContain("\n");
    return JSON.parse(line as string);
  });
}

describe("POST /api/csp-report", () => {
  let warn: MockInstance;

  beforeEach(() => {
    resetRateLimits();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("logs a report-uri report as one JSON line and answers 204", async () => {
    const response = await post(LEGACY_REPORT);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(loggedLines(warn)).toEqual([
      {
        event: "csp_violation",
        directive: "script-src-elem",
        document: "/expenses",
        blocked: "https://evil.example/x.js",
        source: "/_next/static/chunks/app.js",
        line: 12,
        column: 4,
        disposition: "report",
      },
    ]);
  });

  it("logs every CSP violation of a Reporting API batch and skips other report types", async () => {
    const batch = [
      reportingApiReport({}),
      reportingApiReport({ effectiveDirective: "script-src-elem", blockedURL: "inline", sourceFile: "https://ledger.tailnet.ts.net/login?next=%2F", lineNumber: 1 }),
      reportingApiReport({ message: "deprecated" }, "deprecation"),
      reportingApiReport({ effectiveDirective: "img-src", blockedURL: "data:image/png;base64,AAAA" }),
    ];
    const response = await post(batch, { contentType: "application/reports+json" });

    expect(response.status).toBe(204);
    expect(loggedLines(warn)).toEqual([
      { event: "csp_violation", directive: "img-src", document: "/settings", blocked: "https://tracker.example/pixel.gif", disposition: "report" },
      { event: "csp_violation", directive: "script-src-elem", document: "/settings", blocked: "inline", source: "/login", line: 1, disposition: "report" },
      { event: "csp_violation", directive: "img-src", document: "/settings", blocked: "data", disposition: "report" },
    ]);
  });

  it("logs no query string, fragment, sample, cookie or invite code", async () => {
    await post(
      { "csp-report": { ...LEGACY_REPORT["csp-report"], "document-uri": "https://ledger.tailnet.ts.net/join/K7Q2-PZ9M?ref=mail" } },
      { headers: { cookie: "sb-access-token=session-cookie" } },
    );
    await post([reportingApiReport({ documentURL: "https://ledger.tailnet.ts.net/oauth/consent?authorization_id=abc" })], {
      contentType: "application/reports+json",
    });

    const logged = warn.mock.calls.map(([line]) => String(line)).join("\n");
    for (const secret of ["?", "#", "token=secret", "session=abc", "uid=42", "K7Q2", "authorization_id", "alert(", "secret sample", "session-cookie", "Mozilla"]) {
      expect(logged).not.toContain(secret);
    }
    expect(loggedLines(warn).map((line) => line.document)).toEqual(["/join/:code", "/oauth/consent"]);
  });

  it("accepts a content type with parameters", async () => {
    expect((await post(LEGACY_REPORT, { contentType: "application/csp-report; charset=utf-8" })).status).toBe(204);
  });

  it("refuses other content types with 415, JSON included, and logs nothing", async () => {
    for (const contentType of ["application/json", "text/plain", "application/x-www-form-urlencoded"]) {
      const response = await post(LEGACY_REPORT, { contentType });
      expect(response.status, contentType).toBe(415);
      expect(await response.json()).toEqual({ error: NOT_A_CSP_REPORT_TYPE });
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses a body over the size limit with 413", async () => {
    const padding = "x".repeat(CSP_REPORT_MAX_BYTES);
    const response = await post({ "csp-report": { ...LEGACY_REPORT["csp-report"], padding } });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: BODY_TOO_LARGE });
    expect(warn).not.toHaveBeenCalled();
  });

  it("answers 400 to a body that isn't a report", async () => {
    for (const [body, contentType] of [
      ["not json", "application/csp-report"],
      [{ something: "else" }, "application/csp-report"],
      [{ "csp-report": { "blocked-uri": "inline" } }, "application/csp-report"],
      [{ type: "csp-violation" }, "application/reports+json"],
    ] as const) {
      const response = await post(body, { contentType });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ error: NOT_A_CSP_REPORT });
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs at most a fixed number of violations from one batch", async () => {
    const batch = Array.from({ length: CSP_REPORT_MAX_VIOLATIONS + 5 }, () => reportingApiReport({}));
    await post(batch, { contentType: "application/reports+json" });
    expect(warn).toHaveBeenCalledTimes(CSP_REPORT_MAX_VIOLATIONS);
  });

  it("limits each client IP, counting every request, and answers 429 with Retry-After", async () => {
    for (let attempt = 0; attempt < CSP_REPORT_MAX_ATTEMPTS; attempt++) {
      expect((await post(attempt % 2 ? LEGACY_REPORT : "not json")).status).not.toBe(429);
    }
    const limited = await post(LEGACY_REPORT);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: TOO_MANY_CSP_REPORTS });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    // Another IP is still let through.
    expect((await post(LEGACY_REPORT, { ip: "198.51.100.9" })).status).toBe(204);
  });

  it("takes reports from another site or with Origin: null, as browsers may send them", async () => {
    for (const headers of [{ "sec-fetch-site": "cross-site", origin: "https://other.example" }, { origin: "null" }, {}] as Record<string, string>[]) {
      expect((await post(LEGACY_REPORT, { headers })).status, JSON.stringify(headers)).toBe(204);
    }
    expect(REQUEST_GUARD_EXEMPTIONS["/api/csp-report"]).toMatch(/never reads cookies or the session/);
  });
});
