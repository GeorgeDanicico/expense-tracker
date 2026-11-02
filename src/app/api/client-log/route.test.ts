import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));

// Every line the route writes (`client_error`, `web_vital`, `client_log_dropped` and the `request` line) goes to `logged`.
const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));

import { getAuthenticatedUser } from "@/lib/auth";
import { CROSS_SITE_REFUSED } from "@/lib/http/guard";
import {
  CLIENT_LOG_MAX_EVENTS_PER_CLIENT,
  CLIENT_LOG_MAX_EVENTS_PER_PROCESS,
  resetRateLimits,
  TOO_MANY_CLIENT_REPORTS,
} from "@/lib/http/rate-limit";
import { BODY_TOO_LARGE, NOT_JSON } from "@/lib/http/route";
import { CLIENT_LOG_MAX_BYTES, NOT_A_CLIENT_REPORT, type ClientErrorEvent, type ClientEvent, type ClientVitalEvent } from "@/lib/log/client-report";
import { FAKE_SECRET_MARKERS, FAKE_SECRETS } from "@/test/fake-secrets";
import { loggedLines } from "@/test/log-lines";
import { signedInAs, testUser } from "@/test/route";

import { POST } from "./route";

const APP = "http://localhost";
const UUID = "6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f";

const errorEvent = (overrides: Partial<ClientErrorEvent> = {}): ClientErrorEvent => ({
  kind: "error",
  source: "unhandledrejection",
  name: "ApiError",
  message: "Something went wrong (ref 3fK9xQ2mBv0a)",
  stack: `ApiError: Something went wrong\n    at request (${APP}/_next/static/chunks/client.js?v=2:10:20)`,
  requestId: "3fK9xQ2mBv0a",
  page: `/expenses/${UUID}?month=2026-11`,
  release: "4f0c2b1",
  ...overrides,
});

const vitalEvent = (overrides: Partial<ClientVitalEvent> = {}): ClientVitalEvent => ({
  kind: "vital",
  name: "INP",
  value: 184,
  rating: "needs-improvement",
  navigationType: "navigate",
  page: "/dashboard",
  ...overrides,
});

let nextIp = 0;
/** A client IP no other request has used, so the per-IP request limit never gets in the way. */
function freshIp() {
  nextIp += 1;
  return `10.${Math.floor(nextIp / 250)}.${nextIp % 250}.1`;
}

function post(
  body: unknown,
  { ip = freshIp(), contentType = "application/json", headers = {} as Record<string, string> } = {},
) {
  return POST(
    new NextRequest(`${APP}/api/client-log`, {
      method: "POST",
      headers: { "content-type": contentType, "x-forwarded-for": ip, "sec-fetch-site": "same-origin", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const batch = (events: ClientEvent[]) => ({ events });
const vitals = (count: number) => batch(Array.from({ length: count }, () => vitalEvent()));
const lines = (event?: string) => loggedLines(logged, event);

beforeEach(() => {
  resetRateLimits();
  logged.length = 0;
  vi.mocked(getAuthenticatedUser).mockReset();
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/client-log", () => {
  it("logs a batch of errors as client_error at warn and answers 204", async () => {
    const response = await post(batch([errorEvent(), errorEvent({ source: "boundary", digest: "2817461234", requestId: undefined })]));

    expect(response.status).toBe(204);
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^[A-Za-z0-9]{12}$/);

    const [first, second] = lines("client_error");
    expect(first).toEqual({
      time: expect.any(String),
      level: "warn",
      event: "client_error",
      requestId,
      page: "/expenses/:id",
      source: "unhandledrejection",
      error: {
        name: "ApiError",
        message: "Something went wrong (ref 3fK9xQ2mBv0a)",
        stack: ["request@/_next/static/chunks/client.js:10:20"],
      },
      relatedRequestId: "3fK9xQ2mBv0a",
      release: "4f0c2b1",
    });
    expect(second).toMatchObject({ source: "boundary", digest: "2817461234", requestId });
    expect(second).not.toHaveProperty("relatedRequestId");
  });

  it("logs a batch of vitals as web_vital at info", async () => {
    const response = await post(batch([vitalEvent(), vitalEvent({ name: "CLS", value: 0.02, rating: "good", navigationType: undefined, page: `${APP}/calendar?d=3` })]));

    expect(response.status).toBe(204);
    const every = { time: expect.any(String), level: "info", event: "web_vital", requestId: response.headers.get("x-request-id") };
    expect(lines("web_vital")).toEqual([
      { ...every, page: "/dashboard", name: "INP", value: 184, rating: "needs-improvement", navigationType: "navigate" },
      { ...every, page: "/calendar", name: "CLS", value: 0.02, rating: "good" },
    ]);
  });

  it("writes one request line counting the events, with no userId when signed out", async () => {
    await post(vitals(3));

    const [request] = lines("request");
    expect(request).toMatchObject({ level: "info", method: "POST", route: "/api/client-log", status: 204, clientEvents: 3 });
    expect(request).not.toHaveProperty("userId");
    for (const line of lines("web_vital")) expect(line).not.toHaveProperty("userId");
  });

  it("adds the signed-in user's id to every line, and never refuses a signed-out report", async () => {
    signedInAs();
    const response = await post(batch([errorEvent(), vitalEvent()]));

    expect(response.status).toBe(204);
    expect(lines("client_error")[0].userId).toBe(testUser.id);
    expect(lines("web_vital")[0].userId).toBe(testUser.id);
    expect(lines("request")[0].userId).toBe(testUser.id);
  });

  it("treats a failed session check as signed out", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(new Error("Auth is down"));

    expect((await post(vitals(1))).status).toBe(204);
    expect(lines("web_vital")[0]).not.toHaveProperty("userId");
  });

  it("answers 400 with nothing more than the one message for any body that isn't a report", async () => {
    for (const body of [
      "",
      "not json",
      "[]",
      {},
      { events: [] },
      vitals(11),
      { events: [vitalEvent()], extra: 1 },
      { events: [{ ...vitalEvent(), userId: UUID }] },
      { events: [vitalEvent({ value: -5 })] },
      { events: [errorEvent({ message: "x".repeat(501) })] },
      { events: [errorEvent({ requestId: "not-an-id" })] },
    ]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(await response.json()).toEqual({ error: NOT_A_CLIENT_REPORT });
    }
    expect(lines("client_error")).toEqual([]);
    expect(lines("web_vital")).toEqual([]);
    // The session isn't checked for a body that isn't a report.
    expect(getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it(`answers 413 past ${CLIENT_LOG_MAX_BYTES} bytes and 415 for a body that isn't JSON`, async () => {
    const tooLarge = await post(JSON.stringify({ events: [vitalEvent()], pad: "x".repeat(CLIENT_LOG_MAX_BYTES) }));
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ error: BODY_TOO_LARGE });

    const plain = await post(vitals(1), { contentType: "text/plain" });
    expect(plain.status).toBe(415);
    expect(await plain.json()).toMatchObject({ error: NOT_JSON });
    expect(lines("web_vital")).toEqual([]);
  });

  it("accepts a full batch of the largest events under the size limit", async () => {
    const largest = errorEvent({ name: "n".repeat(80), message: "m".repeat(500), stack: `    at f (${APP}/a.js:1:1)\n`.repeat(140).slice(0, 4000) });
    const body = JSON.stringify(batch([largest, largest, largest]));
    expect(body.length).toBeLessThan(CLIENT_LOG_MAX_BYTES);
    expect((await post(body)).status).toBe(204);
  });

  it("refuses a report from another site before reading the session", async () => {
    const foreign: Record<string, string>[] = [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "", origin: "https://evil.example" }];
    for (const headers of foreign) {
      const response = await post(vitals(1), { headers });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: CROSS_SITE_REFUSED });
    }
    expect(getAuthenticatedUser).not.toHaveBeenCalled();
    expect(lines("web_vital")).toEqual([]);
  });

  describe("the per-client limit", () => {
    it(`lets a signed-out client log ${CLIENT_LOG_MAX_EVENTS_PER_CLIENT} events a minute, counted per event, then answers 429`, async () => {
      const ip = "203.0.113.20";
      for (let sent = 0; sent < CLIENT_LOG_MAX_EVENTS_PER_CLIENT; sent += 10) {
        expect((await post(vitals(10), { ip })).status).toBe(204);
      }

      const refused = await post(vitals(1), { ip });
      expect(refused.status).toBe(429);
      expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      expect(await refused.json()).toEqual({ error: TOO_MANY_CLIENT_REPORTS });
      expect(lines("web_vital")).toHaveLength(CLIENT_LOG_MAX_EVENTS_PER_CLIENT);

      // Another IP has its own count.
      expect((await post(vitals(1))).status).toBe(204);
    });

    it("logs the events of a batch that fit, then answers 429 for the rest", async () => {
      const ip = "203.0.113.21";
      await post(vitals(10), { ip });
      await post(vitals(10), { ip });
      await post(vitals(5), { ip });

      const response = await post(vitals(10), { ip });

      expect(response.status).toBe(429);
      expect(lines("web_vital")).toHaveLength(CLIENT_LOG_MAX_EVENTS_PER_CLIENT);
      expect(lines("request").at(-1)).toMatchObject({ status: 429, clientEvents: 5, clientEventsRefused: 5 });
    });

    it("counts a signed-in user by their id, whatever IP they send from", async () => {
      signedInAs();
      for (let sent = 0; sent < CLIENT_LOG_MAX_EVENTS_PER_CLIENT; sent += 10) {
        expect((await post(vitals(10))).status).toBe(204);
      }
      expect((await post(vitals(1))).status).toBe(429);

      signedInAs({ id: "20000000-0000-4000-8000-000000000002", email: "kid@example.test" });
      expect((await post(vitals(1))).status).toBe(204);
    });

    it("lets the client in again a minute later", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const ip = "203.0.113.22";
      for (let sent = 0; sent < CLIENT_LOG_MAX_EVENTS_PER_CLIENT; sent += 10) await post(vitals(10), { ip });
      expect((await post(vitals(1), { ip })).status).toBe(429);

      vi.setSystemTime(Date.now() + 60_001);
      expect((await post(vitals(1), { ip })).status).toBe(204);
    });
  });

  it(`drops events past ${CLIENT_LOG_MAX_EVENTS_PER_PROCESS} a minute across all clients, with one client_log_dropped line a minute`, async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const clients = CLIENT_LOG_MAX_EVENTS_PER_PROCESS / CLIENT_LOG_MAX_EVENTS_PER_CLIENT;
    for (let client = 0; client < clients; client += 1) {
      for (let sent = 0; sent < CLIENT_LOG_MAX_EVENTS_PER_CLIENT; sent += 10) {
        expect((await post(vitals(10), { ip: `192.0.2.${client}` })).status).toBe(204);
      }
    }
    expect(lines("web_vital")).toHaveLength(CLIENT_LOG_MAX_EVENTS_PER_PROCESS);

    // Past the cap: dropped, not refused (the client isn't over its own limit), and counted.
    expect((await post(vitals(4))).status).toBe(204);
    expect((await post(vitals(3))).status).toBe(204);
    expect(lines("web_vital")).toHaveLength(CLIENT_LOG_MAX_EVENTS_PER_PROCESS);
    expect(lines("client_log_dropped").map(({ level, dropped }) => ({ level, dropped }))).toEqual([{ level: "warn", dropped: 4 }]);
    expect(lines("request").at(-1)).toMatchObject({ status: 204, clientEvents: 0, clientEventsDropped: 3 });

    // A minute on, the cap has room again, and the next report writes the tally left over.
    vi.setSystemTime(Date.now() + 60_001);
    expect((await post(vitals(1))).status).toBe(204);
    expect(lines("client_log_dropped").map(({ dropped }) => dropped)).toEqual([4, 3]);
    expect(lines("web_vital")).toHaveLength(CLIENT_LOG_MAX_EVENTS_PER_PROCESS + 1);
  });

  it("logs nothing secret from reports with emails, JWTs and Supabase keys in every string field", async () => {
    signedInAs();
    const withSecret = (secret: string): ClientEvent[][] => [
      [errorEvent({ name: secret.slice(0, 80) })],
      [errorEvent({ message: `could not load ${secret} for ${secret}` })],
      [errorEvent({ stack: `Error: ${secret}\n    at ${secret} (${APP}/${encodeURIComponent(secret)}.js?t=${secret}:1:1)\n${secret}@https://cdn.example/${secret}:2:2` })],
      [errorEvent({ digest: secret.slice(0, 64) })],
      [errorEvent({ requestId: secret.slice(0, 12) })],
      [errorEvent({ page: `/x/${encodeURIComponent(secret)}?q=${encodeURIComponent(secret)}#${secret}` })],
      [errorEvent({ page: `${APP}/${secret}?${secret}` })],
      [errorEvent({ release: secret.slice(0, 64) })],
      [errorEvent({ source: secret as never })],
      [vitalEvent({ page: `/${secret}` })],
      [vitalEvent({ release: secret.slice(0, 64) })],
      [vitalEvent({ name: secret as never })],
      [vitalEvent({ rating: secret as never })],
      [vitalEvent({ navigationType: secret as never })],
      [{ ...vitalEvent(), [secret]: secret } as ClientEvent],
    ];

    const statuses = new Set<number>();
    for (const secret of FAKE_SECRETS) {
      resetRateLimits();
      for (const events of withSecret(secret)) {
        const response = await post(batch(events), { headers: { "x-request-id": secret.slice(0, 12), referer: `${APP}/?${secret}` } });
        statuses.add(response.status);
        expect([204, 400], JSON.stringify(events).slice(0, 120)).toContain(response.status);
      }
    }

    expect(statuses).toEqual(new Set([204, 400]));
    expect(lines("client_error").length).toBeGreaterThan(10);
    const text = logged.join("");
    for (const marker of FAKE_SECRET_MARKERS) expect(text).not.toContain(marker);
  });
});
