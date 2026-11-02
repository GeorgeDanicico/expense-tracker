import { describe, expect, it } from "vitest";

import {
  CLIENT_ERROR_MESSAGE_MAX,
  CLIENT_ERROR_NAME_MAX,
  CLIENT_ERROR_STACK_MAX,
  CLIENT_LOG_MAX_EVENTS,
  CLIENT_PAGE_MAX,
  CLIENT_VITAL_MAX,
  clientEventLine,
  clientLogBodySchema,
  MAX_STACK_FRAMES,
  sanitizePage,
  sanitizeStack,
  type ClientErrorEvent,
  type ClientEvent,
  type ClientVitalEvent,
} from "@/lib/log/client-report";
import { loggablePagePath, loggableResourcePath } from "@/lib/log/loggable-path";
import { REDACTED } from "@/lib/log/redact";
import { FAKE_EMAIL, FAKE_JWT, FAKE_SB_SECRET, FAKE_SECRET_MARKERS, FAKE_SECRETS } from "@/test/fake-secrets";

const APP = "https://ledger.tailnet.ts.net";
const isApp = (origin: string) => origin === APP;
const UUID = "6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f";

const errorEvent = (overrides: Partial<ClientErrorEvent> = {}): ClientErrorEvent => ({
  kind: "error",
  source: "window",
  name: "TypeError",
  message: "Cannot read properties of undefined (reading 'amount')",
  page: "/expenses",
  ...overrides,
});

const vitalEvent = (overrides: Partial<ClientVitalEvent> = {}): ClientVitalEvent => ({
  kind: "vital",
  name: "LCP",
  value: 1234.5,
  rating: "good",
  page: "/dashboard",
  ...overrides,
});

const accepts = (events: unknown[]) => clientLogBodySchema.safeParse({ events }).success;

describe("the client log schema", () => {
  it("accepts a batch of each kind, and a mixed one, with every optional field", () => {
    expect(accepts([errorEvent()])).toBe(true);
    expect(accepts([vitalEvent()])).toBe(true);
    expect(
      accepts([
        errorEvent({
          source: "boundary",
          stack: "TypeError: x\n    at f (https://ledger.tailnet.ts.net/_next/static/chunks/app.js:1:2)",
          digest: "2817461234",
          requestId: "3fK9xQ2mBv0a",
          release: "4f0c2b1.v1-2_3",
        }),
        vitalEvent({ name: "CLS", value: 0.031, rating: "needs-improvement", navigationType: "back-forward-cache", release: "abc" }),
        ...["window", "unhandledrejection", "global_boundary"].map((source) => errorEvent({ source: source as ClientErrorEvent["source"] })),
        ...["INP", "TTFB", "FCP"].map((name) => vitalEvent({ name: name as ClientVitalEvent["name"] })),
      ]),
    ).toBe(true);
  });

  it(`takes 1 to ${CLIENT_LOG_MAX_EVENTS} events`, () => {
    expect(accepts([])).toBe(false);
    expect(accepts(Array.from({ length: CLIENT_LOG_MAX_EVENTS }, () => vitalEvent()))).toBe(true);
    expect(accepts(Array.from({ length: CLIENT_LOG_MAX_EVENTS + 1 }, () => vitalEvent()))).toBe(false);
    expect(clientLogBodySchema.safeParse({}).success).toBe(false);
    expect(clientLogBodySchema.safeParse(null).success).toBe(false);
    expect(clientLogBodySchema.safeParse([vitalEvent()]).success).toBe(false);
  });

  it("refuses unknown keys, on the body and on each kind of event", () => {
    expect(clientLogBodySchema.safeParse({ events: [vitalEvent()], userId: UUID }).success).toBe(false);
    expect(accepts([{ ...errorEvent(), userId: UUID }])).toBe(false);
    expect(accepts([{ ...vitalEvent(), id: "v1-123" }])).toBe(false);
    // A field of the other kind is unknown too.
    expect(accepts([{ ...vitalEvent(), message: "x" }])).toBe(false);
    expect(accepts([{ ...errorEvent(), rating: "good" }])).toBe(false);
  });

  it("refuses an unknown kind, source, metric, rating or navigation type", () => {
    expect(accepts([{ ...vitalEvent(), kind: "log" }])).toBe(false);
    expect(accepts([errorEvent({ source: "console" as never })])).toBe(false);
    expect(accepts([vitalEvent({ name: "FID" as never })])).toBe(false);
    expect(accepts([vitalEvent({ rating: "bad" as never })])).toBe(false);
    expect(accepts([vitalEvent({ navigationType: "teleport" as never })])).toBe(false);
  });

  it("holds every length limit", () => {
    expect(accepts([errorEvent({ name: "x".repeat(CLIENT_ERROR_NAME_MAX) })])).toBe(true);
    expect(accepts([errorEvent({ name: "x".repeat(CLIENT_ERROR_NAME_MAX + 1) })])).toBe(false);
    expect(accepts([errorEvent({ name: "" })])).toBe(false);
    expect(accepts([errorEvent({ message: "" })])).toBe(true);
    expect(accepts([errorEvent({ message: "x".repeat(CLIENT_ERROR_MESSAGE_MAX) })])).toBe(true);
    expect(accepts([errorEvent({ message: "x".repeat(CLIENT_ERROR_MESSAGE_MAX + 1) })])).toBe(false);
    expect(accepts([errorEvent({ stack: "x".repeat(CLIENT_ERROR_STACK_MAX) })])).toBe(true);
    expect(accepts([errorEvent({ stack: "x".repeat(CLIENT_ERROR_STACK_MAX + 1) })])).toBe(false);
    expect(accepts([errorEvent({ page: `/${"x".repeat(CLIENT_PAGE_MAX - 1)}` })])).toBe(true);
    expect(accepts([errorEvent({ page: `/${"x".repeat(CLIENT_PAGE_MAX)}` })])).toBe(false);
  });

  it("takes a value that is a finite number from 0 to 600 000", () => {
    expect(accepts([vitalEvent({ value: 0 })])).toBe(true);
    expect(accepts([vitalEvent({ value: CLIENT_VITAL_MAX })])).toBe(true);
    expect(accepts([vitalEvent({ value: CLIENT_VITAL_MAX + 0.1 })])).toBe(false);
    expect(accepts([vitalEvent({ value: -1 })])).toBe(false);
    expect(accepts([vitalEvent({ value: Number.POSITIVE_INFINITY })])).toBe(false);
    expect(accepts([vitalEvent({ value: Number.NaN })])).toBe(false);
    expect(accepts([{ ...vitalEvent(), value: "12" }])).toBe(false);
  });

  it("takes a request id only in the server's format", () => {
    expect(accepts([errorEvent({ requestId: "3fK9xQ2mBv0a" })])).toBe(true);
    for (const requestId of ["3fK9xQ2mBv0", "3fK9xQ2mBv0ab", "3fK9xQ2mBv0-", FAKE_EMAIL]) {
      expect(accepts([errorEvent({ requestId })]), requestId).toBe(false);
    }
  });

  it("takes a release of at most 64 of [A-Za-z0-9._-], and a digest of at most 64 of [A-Za-z0-9_-]", () => {
    expect(accepts([vitalEvent({ release: "a".repeat(64) })])).toBe(true);
    expect(accepts([vitalEvent({ release: "a".repeat(65) })])).toBe(false);
    expect(accepts([vitalEvent({ release: "1.2.3 beta" })])).toBe(false);
    expect(accepts([vitalEvent({ release: "" })])).toBe(false);
    expect(accepts([errorEvent({ digest: "NEXT_HTTP_ERROR_FALLBACK-404" })])).toBe(true);
    expect(accepts([errorEvent({ digest: "a".repeat(65) })])).toBe(false);
    expect(accepts([errorEvent({ digest: "has spaces" })])).toBe(false);
  });

  it("takes a page that is a path or an http(s) URL, nothing else", () => {
    for (const page of ["/", "/expenses?month=11", `${APP}/settings#mcp`, "http://localhost:3000/login"]) {
      expect(accepts([vitalEvent({ page })]), page).toBe(true);
    }
    for (const page of ["", "expenses", "//evil.example/x", "javascript:alert(1)", "data:text/html,x", "ftp://x/y"]) {
      expect(accepts([vitalEvent({ page })]), page).toBe(false);
    }
  });
});

describe("sanitizePage", () => {
  it("keeps the path only, with ids replaced as in the request line's route template", () => {
    expect(sanitizePage(`/expenses/${UUID}?month=2026-11&token=abc#top`)).toBe("/expenses/:id");
    expect(sanitizePage(`${APP}/settings?tab=mcp`)).toBe("/settings");
    expect(sanitizePage("/join/K7Q2PZ9M")).toBe("/join/:code");
    expect(sanitizePage("/join/K7Q2%2FPZ9M")).toBe("/join/:code");
    expect(sanitizePage(`/x/${"a1".repeat(10)}`)).toBe("/x/:value");
  });

  it("redacts a secret in a path segment, as sent or percent-encoded", () => {
    // Short enough to survive the template's long-segment rule, so the segment rule must catch it.
    const shortEmail = ["ann", "kin.test"].join("@");
    expect(sanitizePage(`/people/${shortEmail}`)).toBe(`/people/${REDACTED}`);
    expect(sanitizePage(`/people/${encodeURIComponent(shortEmail)}`)).toBe(`/people/${REDACTED}`);
    expect(sanitizePage(`/people/${encodeURIComponent(FAKE_EMAIL)}`)).toBe("/people/:value");
    expect(sanitizePage(`/a/${encodeURIComponent(`Bearer x`)}/b`)).toBe(`/a/${REDACTED}/b`);
  });
});

describe("the loggable paths", () => {
  it("keep a resource's own name but drop its query, an invite code and any secret segment", () => {
    expect(loggableResourcePath("/_next/static/chunks/app/(app)/page-0a1b2c3d4e5f6a7b.js?v=1")).toBe(
      "/_next/static/chunks/app/(app)/page-0a1b2c3d4e5f6a7b.js",
    );
    expect(loggableResourcePath("/join/ABCD2345")).toBe("/join/:code");
    expect(loggableResourcePath(`/x/${FAKE_SB_SECRET}/y.js`)).toBe(`/x/${REDACTED}/y.js`);
  });

  it("clip a path to 200 characters", () => {
    expect(loggablePagePath(`/${"abc/".repeat(100)}`)).toHaveLength(200);
  });
});

describe("sanitizeStack", () => {
  it("keeps the app's own frames as function@path:line:col, without query strings", () => {
    const stack = [
      "TypeError: Cannot read properties of undefined",
      `    at ExpenseRow (${APP}/_next/static/chunks/app/(app)/expenses/page-1a2b.js?dpl=abc:12:345)`,
      `    at async loadMore (${APP}/_next/static/chunks/4bd1-0a1b.js:1:2)`,
      `    at ${APP}/_next/static/chunks/main.js:7:8`,
    ].join("\n");

    expect(sanitizeStack(stack, isApp)).toEqual([
      "ExpenseRow@/_next/static/chunks/app/(app)/expenses/page-1a2b.js:12:345",
      "async loadMore@/_next/static/chunks/4bd1-0a1b.js:1:2",
      "@/_next/static/chunks/main.js:7:8",
    ]);
  });

  it("reads Firefox's and Safari's fn@location frames", () => {
    const stack = [
      `ExpenseRow@${APP}/_next/static/chunks/page.js?x=1:12:5`,
      `loadMore/<@${APP}/_next/static/chunks/page.js:30:1`,
      `@${APP}/_next/static/chunks/main.js:1:1`,
      "global code@https://cdn.example/lib.js:1:1",
      "[native code]",
    ].join("\n");

    expect(sanitizeStack(stack, isApp)).toEqual([
      "ExpenseRow@/_next/static/chunks/page.js:12:5",
      "loadMore/<@/_next/static/chunks/page.js:30:1",
      "@/_next/static/chunks/main.js:1:1",
      "global code@https://cdn.example",
    ]);
  });

  it("drops another origin's URL to its origin, and other schemes to the scheme", () => {
    const stack = [
      "    at track (https://tracker.example/t.js?uid=42&session=abc:1:99)",
      "    at inject (chrome-extension://abcdefghijklmnop/content.js:3:4)",
      "    at run (blob:https://ledger.tailnet.ts.net/6c3f4a8e:1:1)",
      "    at eval (eval at compile (https://ledger.tailnet.ts.net/x.js:1:1), <anonymous>:1:1)",
      "    at Array.map (<anonymous>)",
      "    at JSON.parse (native)",
    ].join("\n");

    expect(sanitizeStack(stack, isApp)).toEqual([
      "track@https://tracker.example",
      "inject@chrome-extension",
      "run@blob",
      "eval@eval",
      "Array.map@anonymous",
      "JSON.parse@native",
    ]);
  });

  it(`keeps at most ${MAX_STACK_FRAMES} frames, and only lines that are frames`, () => {
    const lines = ["Error: boom", "not a frame at all", ...Array.from({ length: 40 }, (_, index) => `    at f${index} (${APP}/a.js:${index}:1)`)];
    const frames = sanitizeStack(lines.join("\n"), isApp);

    expect(frames).toHaveLength(MAX_STACK_FRAMES);
    expect(frames[0]).toBe("f0@/a.js:0:1");
  });

  it("comes out clean from a stack full of tokens, query strings and foreign URLs", () => {
    const stack = [
      `Error: failed for ${FAKE_EMAIL} with ${FAKE_JWT}`,
      `    at ${FAKE_SB_SECRET} (${APP}/_next/static/chunks/page.js?token=${FAKE_JWT}:1:1)`,
      `    at handler (${APP}/join/K7Q2PZ9M/${FAKE_SB_SECRET}.js:2:2)`,
      `    at ${FAKE_EMAIL} (https://cdn.example/${FAKE_JWT}/x.js:3:3)`,
      `fn!@${APP}/${encodeURIComponent(FAKE_EMAIL)}/a.js:4:4`,
      `${FAKE_EMAIL.replace("@", "!@")}@${APP}/a.js:5:5`,
      `    at load (https://user:${FAKE_SB_SECRET}@cdn.example/x.js?k=${FAKE_SB_SECRET}#${FAKE_JWT}:5:5)`,
    ].join("\n");

    const frames = sanitizeStack(stack, isApp);
    const text = JSON.stringify(frames);
    for (const marker of FAKE_SECRET_MARKERS) expect(text).not.toContain(marker);
    expect(text).not.toContain("?");
    expect(text).not.toContain("K7Q2PZ9M");
    expect(frames).toEqual([
      `${REDACTED}@/_next/static/chunks/page.js:1:1`,
      `handler@/join/:code/${REDACTED}:2:2`,
      `${REDACTED}@https://cdn.example`,
      `fn@/${REDACTED}/a.js:4:4`,
      "load@https://cdn.example",
    ]);
  });
});

describe("clientEventLine", () => {
  it("writes an error as client_error at warn, in the shape of a server error", () => {
    const line = clientEventLine(
      errorEvent({
        source: "boundary",
        stack: `TypeError: x\n    at f (${APP}/a.js:1:2)`,
        digest: "2817461234",
        requestId: "3fK9xQ2mBv0a",
        release: "4f0c2b1",
        page: `/expenses/${UUID}?q=1`,
      }),
      isApp,
    );

    expect(line).toEqual({
      event: "client_error",
      level: "warn",
      fields: {
        page: "/expenses/:id",
        source: "boundary",
        error: { name: "TypeError", message: "Cannot read properties of undefined (reading 'amount')", stack: ["f@/a.js:1:2"] },
        digest: "2817461234",
        relatedRequestId: "3fK9xQ2mBv0a",
        release: "4f0c2b1",
      },
    });
  });

  it("leaves out a stack with no frames in it", () => {
    const line = clientEventLine(errorEvent({ stack: "just text" }), isApp);
    expect(line.fields.error).toEqual({ name: "TypeError", message: "Cannot read properties of undefined (reading 'amount')" });
  });

  it("writes a vital as web_vital at info, its value to four decimals", () => {
    expect(clientEventLine(vitalEvent({ name: "CLS", value: 0.123456789, navigationType: "reload", page: `${APP}/calendar?d=1` }), isApp)).toEqual({
      event: "web_vital",
      level: "info",
      fields: { page: "/calendar", name: "CLS", value: 0.1235, rating: "good", navigationType: "reload", release: undefined },
    });
  });

  it("logs nothing secret from an event with secrets in every string field it accepts", () => {
    for (const secret of FAKE_SECRETS) {
      const events: ClientEvent[] = [
        errorEvent({
          name: secret.slice(0, CLIENT_ERROR_NAME_MAX),
          message: `failed: ${secret} (${secret})`,
          stack: `Error: ${secret}\n    at ${secret} (${APP}/${secret}/x.js?${secret}:1:1)\n${secret}@https://${secret}/y.js:2:2`,
          page: `/x/${encodeURIComponent(secret)}?q=${encodeURIComponent(secret)}#${secret}`,
        }),
        vitalEvent({ page: `${APP}/${secret}?${secret}` }),
      ];
      expect(clientLogBodySchema.safeParse({ events }).success).toBe(true);
      const text = JSON.stringify(events.map((event) => clientEventLine(event, isApp)));
      for (const marker of FAKE_SECRET_MARKERS) expect(text, secret).not.toContain(marker);
    }
  });
});
