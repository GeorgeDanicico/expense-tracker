import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  headers: vi.fn(),
  cookies: vi.fn(),
  createServerClient: vi.fn(),
  createSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
// Only the "withUser on Supabase auth" tests reach these: they swap the real `getAuthenticatedUser` back in.
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: mocks.cookies }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createSupabaseClient }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseConfig: () => ({ url: "http://supabase.test", publishableKey: "pk" }) }));
// The wrappers' request lines go to `logged` instead of stdout (see "the request line" below).
const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));

import { DomainError } from "@/lib/errors";
import { ImportError } from "@/lib/imports/types";
import {
  HttpError,
  json,
  JSON_BODY_MAX_BYTES,
  noContent,
  notFound,
  parseBody,
  parseId,
  readJson,
  withAnonymousLimit,
  withRequestGuard,
  withUser,
} from "@/lib/http/route";
import {
  ANONYMOUS_MAX_REQUESTS,
  resetRateLimits,
  SIGNED_OUT_MAX_REQUESTS,
  TOO_MANY_REQUESTS,
  USER_READ_MAX_REQUESTS,
  USER_WRITE_MAX_REQUESTS,
} from "@/lib/http/rate-limit";
import { log } from "@/lib/log";
import { tracedFetch } from "@/lib/log/traced-fetch";
import { addRequestFields, currentRequest } from "@/lib/log/request-context";
import { getRepositories } from "@/lib/repositories";
import { fakeSupabase } from "@/test/fake-supabase";
import { loggedLines } from "@/test/log-lines";

beforeEach(() => {
  resetRateLimits();
});

const PRIVATE = "private, no-store, max-age=0";
const user = { id: "user-1", email: "user@example.com" };
const schema = z.object({ name: z.string().min(1, "Name is required.") });
const post = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request("http://localhost/api/test", { method: "POST", body, headers });

/**
 * The cookie session's database for the plain `withUser` tests: `withUser` reads the caller's
 * "must change password" flag from `profiles` through the real account repository.
 */
function cookieDatabaseWith(profiles: Record<string, unknown>[] = [], fail?: Parameters<typeof fakeSupabase>[1]) {
  const database = fakeSupabase({ profiles }, fail);
  mocks.headers.mockResolvedValue(new Headers());
  mocks.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });
  mocks.createServerClient.mockReturnValue(database.client);
  return database;
}

describe("json", () => {
  it("adds the private no-store header to every response", async () => {
    const response = json({ ok: true }, { status: 405, headers: { Allow: "POST" } });
    expect(response.status).toBe(405);
    expect(response.headers.get("cache-control")).toBe(PRIVATE);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("accepts a bare status code", () => {
    expect(json({}, 201).status).toBe(201);
  });
});

describe("noContent", () => {
  it("returns an empty private 204", async () => {
    const response = noContent();
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe(PRIVATE);
    expect(await response.text()).toBe("");
  });
});

describe("parseId", () => {
  it("returns a valid UUID unchanged", () => {
    const id = "6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f";
    expect(parseId(id, "Invalid id.")).toBe(id);
  });

  it("throws a 400 with the route's message for anything else", () => {
    expect(() => parseId("nope", "Invalid id.")).toThrow(expect.objectContaining({ status: 400, message: "Invalid id." }));
  });
});

describe("parseBody", () => {
  it("returns the parsed body", async () => {
    await expect(parseBody(post(JSON.stringify({ name: "Rent" })), schema, "Check it.")).resolves.toEqual({ name: "Rent" });
  });

  it("treats a malformed body as null and throws a 422", async () => {
    await expect(parseBody(post("{"), schema, "Check it.")).rejects.toMatchObject({ status: 422, message: "Check it." });
  });

  it("throws a 422 carrying the schema's field errors", async () => {
    await expect(parseBody(post(JSON.stringify({ name: "" })), schema, "Check it.")).rejects.toMatchObject({
      status: 422,
      fieldErrors: { name: ["Name is required."] },
    });
  });
});

describe("readJson", () => {
  it("accepts application/json with a charset, in any case", async () => {
    await expect(readJson(post('{"a":1}', { "content-type": "Application/JSON; charset=utf-8" }))).resolves.toEqual({ a: 1 });
  });

  it("drops a leading byte-order mark, like request.json()", async () => {
    await expect(readJson(post('\uFEFF{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it.each([
    ["text/plain", { "content-type": "text/plain" }],
    ["form-encoded", { "content-type": "application/x-www-form-urlencoded" }],
    ["multipart", { "content-type": "multipart/form-data; boundary=x" }],
    ["application/json-ish", { "content-type": "application/jsonp" }],
    ["no Content-Type", {}],
  ])("refuses a %s body with a 415", async (_name, headers) => {
    const request = new Request("http://localhost/api/test", { method: "POST", body: '{"a":1}', headers });
    if (!("content-type" in headers)) request.headers.delete("content-type");
    await expect(readJson(request)).rejects.toMatchObject({ status: 415 });
  });

  it("answers null for an empty body whatever its type, so bodyless writes still work", async () => {
    await expect(readJson(new Request("http://localhost/api/test", { method: "DELETE" }))).resolves.toBeNull();
    await expect(readJson(post("", { "content-type": "text/plain" }))).resolves.toBeNull();
  });

  it("refuses a body over 64 KB with a 413, by Content-Length or by counting", async () => {
    const big = JSON.stringify({ text: "x".repeat(JSON_BODY_MAX_BYTES) });
    await expect(readJson(post(big))).rejects.toMatchObject({ status: 413 });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const streamed = new Request("http://localhost/api/test", {
      method: "POST", body: stream, duplex: "half", headers: { "content-type": "application/json" },
    } as RequestInit);
    expect(streamed.headers.get("content-length")).toBeNull();
    await expect(readJson(streamed)).rejects.toMatchObject({ status: 413 });
  });

  it("takes a route's own larger limit", async () => {
    const big = JSON.stringify({ text: "x".repeat(JSON_BODY_MAX_BYTES) });
    await expect(readJson(post(big), { maxBytes: 2 * JSON_BODY_MAX_BYTES })).resolves.toEqual({ text: "x".repeat(JSON_BODY_MAX_BYTES) });
  });
});

describe("the request guard in withUser and withRequestGuard", () => {
  const ok = async () => json({ ok: true });
  const write = (headers: Record<string, string>, method = "POST") =>
    new Request("http://localhost/api/test", { method, headers });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(user);
    cookieDatabaseWith();
  });

  it.each([
    ["Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site: same-site", { "sec-fetch-site": "same-site" }],
    ["a foreign Origin", { origin: "https://evil.example" }],
  ])("refuses %s with a 403 before reading the session", async (_name, headers) => {
    const handler = vi.fn(ok);
    const response = await withUser(handler)(write(headers));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "This request didn't come from the app, so it was refused." });
    expect(response.headers.get("cache-control")).toBe(PRIVATE);
    expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets a same-origin write through to the session check", async () => {
    const response = await withUser(ok)(write({ "sec-fetch-site": "same-origin", origin: "http://localhost" }));
    expect(response.status).toBe(200);
    expect(mocks.getAuthenticatedUser).toHaveBeenCalledOnce();
  });

  it("never checks a GET", async () => {
    const response = await withUser(ok)(write({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }, "GET"));
    expect(response.status).toBe(200);
  });

  it("guards a route outside withUser and maps its HttpErrors", async () => {
    const guarded = withRequestGuard(async (request: Request) => json(await readJson(request)));

    expect((await guarded(write({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await guarded(post("hi", { "content-type": "text/plain" }))).status).toBe(415);
    expect(await (await guarded(post('{"a":1}'))).json()).toEqual({ a: 1 });
    await expect(withRequestGuard(async () => { throw new Error("boom"); })()).rejects.toThrow("boom");
  });
});

describe("withUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(user);
    cookieDatabaseWith();
  });

  const respond = async (fail: () => never, options = { failure: "Unable to do it." }) => {
    const response = await withUser(async () => fail(), options)();
    expect(response.headers.get("cache-control")).toBe(PRIVATE);
    return { status: response.status, body: await response.json() };
  };

  it("returns 401 without calling the handler when nobody is signed in", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const handler = vi.fn();
    const response = await withUser(handler, { failure: "x" })();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe(PRIVATE);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the request, user and route context to the handler", async () => {
    const handler = vi.fn(async () => json({ ok: true }));
    const request = post("{}");
    const context = { params: Promise.resolve({ id: "1" }) };
    await withUser(handler, { failure: "x" })(request, context);
    expect(handler).toHaveBeenCalledWith(request, user, context);
  });

  it("maps an HttpError to its status and message", async () => {
    expect(await respond(() => notFound("Thing not found."))).toEqual({ status: 404, body: { error: "Thing not found." } });
  });

  it("maps an HttpError's field errors", async () => {
    expect(await respond(() => { throw new HttpError(422, "Check it.", { name: ["Bad."] }); })).toEqual({
      status: 422,
      body: { error: "Check it.", fieldErrors: { name: ["Bad."] } },
    });
  });

  it("maps a DomainError to its status, message and field errors", async () => {
    expect(await respond(() => { throw new DomainError("Not enough shares.", 409, { quantity: ["Too many."] }); })).toEqual({
      status: 409,
      body: { error: "Not enough shares.", fieldErrors: { quantity: ["Too many."] } },
    });
  });

  it("maps an ImportError to its status, message and code, without field errors", async () => {
    expect(await respond(() => { throw new ImportError("already_imported", "You imported this statement."); })).toEqual({
      status: 409,
      body: { error: "You imported this statement.", code: "already_imported" },
    });
    expect(await respond(() => { throw new ImportError("file_too_large", "Choose a statement under 2 MB."); })).toEqual({
      status: 413,
      body: { error: "Choose a statement under 2 MB.", code: "file_too_large" },
    });
  });

  it("maps any other error to a 500 with the route's failure message", async () => {
    expect(await respond(() => { throw new Error("boom"); })).toEqual({ status: 500, body: { error: "Unable to do it.", requestId: expect.any(String) } });
  });

  it("lets unexpected errors propagate when no failure message is given", async () => {
    await expect(withUser(async () => { throw new Error("boom"); })()).rejects.toThrow("boom");
  });
});

describe("the request limits in the wrappers", () => {
  const ok = async () => json({ ok: true });
  const sameOrigin = { "sec-fetch-site": "same-origin" };
  const call = (method: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/test", { method, headers: { ...sameOrigin, ...headers } });
  const otherUser = { id: "user-2", email: "other@example.com" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T09:00:00.000Z"));
    mocks.getAuthenticatedUser.mockResolvedValue(user);
    cookieDatabaseWith();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Sends `times` requests and returns how many were answered 429. */
  async function limitedOf(handler: ReturnType<typeof withUser>, times: number, method: string) {
    let limited = 0;
    for (let sent = 0; sent < times; sent += 1) if ((await handler(call(method))).status === 429) limited += 1;
    return limited;
  }

  it("answers a signed-in read past 600 a minute with 429, Retry-After and the usual error shape", async () => {
    const handler = withUser(ok);
    expect(await limitedOf(handler, USER_READ_MAX_REQUESTS, "GET")).toBe(0);

    const response = await handler(call("GET"));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe(PRIVATE);
    expect(await response.json()).toEqual({ error: TOO_MANY_REQUESTS });
  });

  it("answers a signed-in write past 120 a minute with 429, while reads still go through", async () => {
    const handler = vi.fn(ok);
    const route = withUser(handler);
    expect(await limitedOf(route, USER_WRITE_MAX_REQUESTS, "POST")).toBe(0);

    const response = await route(call("POST"));

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(handler).toHaveBeenCalledTimes(USER_WRITE_MAX_REQUESTS);
    expect((await route(call("GET"))).status).toBe(200);
  });

  it.each(["PUT", "PATCH", "DELETE"])("counts %s as a write", async (method) => {
    const route = withUser(ok);
    expect(await limitedOf(route, USER_WRITE_MAX_REQUESTS, method)).toBe(0);

    expect((await route(call(method))).status).toBe(429);
  });

  it("counts HEAD and OPTIONS as reads", async () => {
    const route = withUser(ok);
    for (let sent = 0; sent < USER_WRITE_MAX_REQUESTS + 5; sent += 1) {
      expect((await route(call(sent % 2 === 0 ? "HEAD" : "OPTIONS"))).status).toBe(200);
    }
  });

  it("limits each user alone, whatever their IP", async () => {
    const route = withUser(ok);
    await limitedOf(route, USER_WRITE_MAX_REQUESTS + 1, "POST");

    mocks.getAuthenticatedUser.mockResolvedValue(otherUser);
    expect((await route(call("POST"))).status).toBe(200);
  });

  it("lets a user in again as the window slides, without waiting for a whole minute to pass", async () => {
    const route = withUser(ok);
    await route(call("POST"));
    vi.advanceTimersByTime(30_000);
    await limitedOf(route, USER_WRITE_MAX_REQUESTS - 1, "POST");
    expect((await route(call("POST"))).status).toBe(429);

    // The first request leaves the window after 60 seconds, so one more is allowed, then none.
    vi.advanceTimersByTime(30_000);
    expect((await route(call("POST"))).status).toBe(200);
    expect((await route(call("POST"))).status).toBe(429);
  });

  it("doesn't run the handler for a limited request", async () => {
    const handler = vi.fn(ok);
    const route = withUser(handler);
    await limitedOf(route, USER_WRITE_MAX_REQUESTS, "POST");
    handler.mockClear();

    await route(call("POST"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("never limits a realistic burst: a page load, SWR revalidation, then an import and a few edits, all inside a minute", async () => {
    const route = withUser(ok);
    // Ten tabs' worth of page loads (about ten GETs each), then 30 edits and an upload and its confirm.
    expect(await limitedOf(route, 100, "GET")).toBe(0);
    expect(await limitedOf(route, 30, "POST")).toBe(0);
    expect(await limitedOf(route, 40, "GET")).toBe(0);
  });

  it("counts requests that carry no session per client IP, answering 429 past 120 a minute and 401 before", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const route = withUser(ok);
    const from = (ip: string) => route(call("GET", { "x-forwarded-for": ip }));
    for (let sent = 0; sent < SIGNED_OUT_MAX_REQUESTS; sent += 1) expect((await from("203.0.113.7")).status).toBe(401);

    const response = await from("203.0.113.7");

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await from("203.0.113.8")).status).toBe(401);
  });

  it("doesn't let a made-up first X-Forwarded-For hop get a fresh signed-out limit", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const route = withUser(ok);
    for (let sent = 0; sent < SIGNED_OUT_MAX_REQUESTS; sent += 1) {
      await route(call("GET", { "x-forwarded-for": `198.51.100.${sent}, 203.0.113.7` }));
    }

    expect((await route(call("GET", { "x-forwarded-for": "198.51.100.250, 203.0.113.7" }))).status).toBe(429);
  });

  it("limits withRequestGuard routes per client IP, 60 a minute", async () => {
    const route = withRequestGuard(ok);
    const from = (ip: string) => route(call("POST", { "x-forwarded-for": ip }));
    for (let sent = 0; sent < ANONYMOUS_MAX_REQUESTS; sent += 1) expect((await from("203.0.113.7")).status).toBe(200);

    const response = await from("203.0.113.7");

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await response.json()).toEqual({ error: TOO_MANY_REQUESTS });
    expect((await from("203.0.113.8")).status).toBe(200);
  });

  it("limits withAnonymousLimit routes per client IP, 60 a minute, and passes the request and context on", async () => {
    const handler = vi.fn(ok);
    const route = withAnonymousLimit(handler);
    const request = call("GET", { "x-forwarded-for": "203.0.113.7" });
    const context = { params: Promise.resolve({}) };
    await route(request, context);
    expect(handler).toHaveBeenCalledWith(request, context);

    for (let sent = 1; sent < ANONYMOUS_MAX_REQUESTS; sent += 1) await route(call("GET", { "x-forwarded-for": "203.0.113.7" }));

    expect((await route(call("GET", { "x-forwarded-for": "203.0.113.7" }))).status).toBe(429);
    expect((await route(call("GET", { "x-forwarded-for": "203.0.113.8" }))).status).toBe(200);
  });
});

describe("withUser and the must-change-password flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(user);
  });

  it("reads the caller's flag with one query on their own profile row", async () => {
    const database = cookieDatabaseWith([{ id: user.id, must_change_password: false }]);

    expect((await withUser(async () => json({ ok: true }))()).status).toBe(200);
    expect(database.queries).toEqual([
      expect.objectContaining({ table: "profiles", operation: "select", filters: [["eq", "id", user.id]] }),
    ]);
  });

  it("refuses a flagged account with 403 password_change_required before the handler runs", async () => {
    cookieDatabaseWith([{ id: user.id, must_change_password: true }]);
    const handler = vi.fn(async () => json({ ok: true }));

    const response = await withUser(handler, { failure: "x" })(post("{}"));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe(PRIVATE);
    expect(await response.json()).toEqual({
      error: "Choose a new password before you keep using the app.",
      code: "password_change_required",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets a flagged account into a route that allows it, without reading the flag", async () => {
    const database = cookieDatabaseWith([{ id: user.id, must_change_password: true }]);

    const response = await withUser(async () => json({ ok: true }), { allowPasswordChangeRequired: true })();

    expect(response.status).toBe(200);
    expect(database.queries).toEqual([]);
  });

  it("lets an account without a profile row in", async () => {
    cookieDatabaseWith([]);

    expect((await withUser(async () => json({ ok: true }))()).status).toBe(200);
  });

  it("answers the route's 500, never the handler, when the flag can't be read", async () => {
    cookieDatabaseWith([{ id: user.id, must_change_password: false }], { fail: () => true });
    const handler = vi.fn(async () => json({ ok: true }));

    const response = await withUser(handler, { failure: "Unable to do it." })();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to do it.", requestId: expect.any(String) });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("withUser on Supabase auth", () => {
  const cookieUser = { id: "10000000-0000-4000-8000-000000000141", email: "cookie@example.test" };
  const bearerUser = { id: "10000000-0000-4000-8000-000000000142", email: "bearer@example.test" };
  const VALID_TOKEN = "valid-token";

  /** Reads the caller's currency through the real account repository, so the test sees which client served it. */
  const route = withUser(async (_request, user) => json({ user, currency: await getRepositories().account.getCurrency(user.id) }));

  let cookieDatabase: ReturnType<typeof fakeSupabase>;
  let tokenDatabase: ReturnType<typeof fakeSupabase>;

  /** Sets up one request: its Authorization header, and whether its cookies hold a valid session. */
  function request({ authorization, cookieSession }: { authorization?: string; cookieSession: boolean }) {
    mocks.headers.mockResolvedValue(new Headers(authorization === undefined ? {} : { authorization }));
    cookieDatabase = fakeSupabase({ profiles: [{ id: cookieUser.id, currency: "USD" }] });
    mocks.createServerClient.mockReturnValue({
      ...cookieDatabase.client,
      auth: {
        getClaims: vi.fn().mockResolvedValue(
          cookieSession ? { data: { claims: { sub: cookieUser.id, email: cookieUser.email } }, error: null } : { data: null, error: null },
        ),
      },
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
    mocks.getAuthenticatedUser.mockImplementation(actual.getAuthenticatedUser);
    mocks.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });

    tokenDatabase = fakeSupabase({ profiles: [{ id: bearerUser.id, currency: "RON" }] });
    mocks.createSupabaseClient.mockImplementation(() => ({
      ...tokenDatabase.client,
      auth: {
        getClaims: vi.fn(async (token?: string) =>
          token === VALID_TOKEN
            ? { data: { claims: { sub: bearerUser.id, email: bearerUser.email } }, error: null }
            : { data: null, error: { message: "JWT has expired" } },
        ),
      },
    }));
  });

  const call = async () => {
    const response = await route();
    return { status: response.status, body: await response.json() };
  };

  it("acts as the cookie session's user when there is no bearer", async () => {
    request({ cookieSession: true });

    expect(await call()).toEqual({ status: 200, body: { user: cookieUser, currency: "USD" } });
    expect(mocks.createSupabaseClient).not.toHaveBeenCalled();
  });

  it("acts as the bearer token's user and sends repository calls through the token client", async () => {
    request({ authorization: `Bearer ${VALID_TOKEN}`, cookieSession: false });

    expect(await call()).toEqual({ status: 200, body: { user: bearerUser, currency: "RON" } });
    // The must-change-password flag, then the handler's currency: both through the token client.
    expect(tokenDatabase.queries).toEqual([
      expect.objectContaining({ table: "profiles", filters: [["eq", "id", bearerUser.id]] }),
      expect.objectContaining({ table: "profiles", filters: [["eq", "id", bearerUser.id]] }),
    ]);
    expect(mocks.createSupabaseClient).toHaveBeenCalledWith("http://supabase.test", "pk", expect.objectContaining({
      global: { headers: { Authorization: `Bearer ${VALID_TOKEN}` }, fetch: tracedFetch },
    }));
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("uses the bearer over the cookie session when a request carries both", async () => {
    request({ authorization: `Bearer ${VALID_TOKEN}`, cookieSession: true });

    expect(await call()).toEqual({ status: 200, body: { user: bearerUser, currency: "RON" } });
    expect(cookieDatabase.queries).toEqual([]);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it.each([
    ["an expired or invalid token", "Bearer expired-token"],
    ["a bearer header without a token", "Bearer"],
  ])("returns 401 for %s, without falling back to the cookie session", async (_, authorization) => {
    request({ authorization, cookieSession: true });

    expect(await call()).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(cookieDatabase.queries).toEqual([]);
    expect(tokenDatabase.queries).toEqual([]);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("never hands one request's user to the next", async () => {
    request({ cookieSession: true });
    expect((await call()).body.user).toEqual(cookieUser);

    request({ authorization: `Bearer ${VALID_TOKEN}`, cookieSession: true });
    expect((await call()).body.user).toEqual(bearerUser);

    request({ authorization: "Bearer expired-token", cookieSession: true });
    expect((await call()).status).toBe(401);
  });

  it("keeps the cookie session for a non-bearer Authorization header", async () => {
    request({ authorization: "Basic dXNlcjpwYXNz", cookieSession: true });

    expect(await call()).toEqual({ status: 200, body: { user: cookieUser, currency: "USD" } });
    expect(mocks.createSupabaseClient).not.toHaveBeenCalled();
  });
});

describe("the request line", () => {
  const ok = async () => json({ ok: true });
  const sameOrigin = { "sec-fetch-site": "same-origin" };
  const call = (method = "GET", path = "/api/test", headers: Record<string, string> = {}, body?: string) =>
    new Request(`http://localhost${path}`, { method, headers: { ...sameOrigin, ...headers }, body });
  const requestLines = () => loggedLines(logged, "request");

  beforeEach(() => {
    vi.clearAllMocks();
    logged.length = 0;
    mocks.getAuthenticatedUser.mockResolvedValue(user);
    cookieDatabaseWith();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The one request line written, checked against the response's `x-request-id`. */
  function onlyLine(response: Response) {
    const lines = requestLines();
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(response.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(line.requestId).toBe(response.headers.get("x-request-id"));
    return line;
  }

  it("writes one info line for a signed-in 200, with the user, the route template and the timing", async () => {
    const response = await withUser(ok)(call("GET", "/api/expenses/6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f"));

    expect(response.status).toBe(200);
    expect(onlyLine(response)).toEqual({
      time: expect.any(String),
      level: "info",
      event: "request",
      requestId: response.headers.get("x-request-id"),
      method: "GET",
      route: "/api/expenses/:id",
      status: 200,
      ms: expect.any(Number),
      userId: user.id,
      spans: [],
      dbMs: 0,
      dbCalls: 0,
    });
  });

  it("never logs the body, the query string or the caller's email", async () => {
    const route = withUser(async (request: Request) => json(await readJson(request)));
    const secret = ["sb", "secret", "x".repeat(20)].join("_");
    await route(call("POST", "/api/test?email=someone@example.test&token=abc", { "content-type": "application/json" }, JSON.stringify({ password: secret })));

    const written = logged.join("");
    expect(written).not.toContain(secret);
    expect(written).not.toContain("someone@example.test");
    expect(written).not.toContain(user.email);
    expect(written).not.toContain("?");
    expect(requestLines()[0].route).toBe("/api/test");
  });

  it("writes one info line without a user for a 401", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const response = await withUser(ok)(call());

    const line = onlyLine(response);
    expect(line).toMatchObject({ level: "info", status: 401 });
    expect(line).not.toHaveProperty("userId");
  });

  it("writes one info line for a 403 from the request guard, in withUser and withRequestGuard", async () => {
    const foreign = { "sec-fetch-site": "cross-site" };
    const fromUser = await withUser(ok)(call("POST", "/api/test", foreign));
    expect(onlyLine(fromUser)).toMatchObject({ level: "info", status: 403, method: "POST" });

    logged.length = 0;
    const fromGuard = await withRequestGuard(ok)(call("POST", "/api/auth", foreign));
    expect(onlyLine(fromGuard)).toMatchObject({ level: "info", status: 403, route: "/api/auth" });
  });

  it("writes a 429 at warn", async () => {
    const route = withUser(ok);
    for (let sent = 0; sent < USER_WRITE_MAX_REQUESTS; sent += 1) await route(call("POST"));
    logged.length = 0;

    const response = await route(call("POST"));

    expect(response.status).toBe(429);
    expect(onlyLine(response)).toMatchObject({ level: "warn", status: 429, userId: user.id });
  });

  it.each([
    ["an HttpError", () => new HttpError(404, "Thing not found."), 404, undefined],
    ["a DomainError", () => new DomainError("Not enough shares.", 409), 409, undefined],
    ["an ImportError", () => new ImportError("already_imported", "You imported this statement."), 409, "already_imported"],
  ])("writes %s at info with its status, and no failure", async (_name, error, status, errorCode) => {
    const response = await withUser(async () => { throw error(); }, { failure: "x" })(call());

    const line = onlyLine(response);
    expect(line).toMatchObject({ level: "info", status });
    expect(line.errorCode).toBe(errorCode);
    expect(loggedLines(logged, "request_failed")).toEqual([]);
  });

  it("names the password-change refusal by its code", async () => {
    cookieDatabaseWith([{ id: user.id, must_change_password: true }]);
    const response = await withUser(ok)(call());

    expect(onlyLine(response)).toMatchObject({ level: "info", status: 403, errorCode: "password_change_required" });
  });

  it("logs an unexpected error before answering 500 with the request id in the body", async () => {
    const response = await withUser(async () => { throw new Error("database exploded"); }, { failure: "Unable to do it." })(call());

    const line = onlyLine(response);
    expect(line).toMatchObject({ level: "error", status: 500, userId: user.id });
    expect(await response.json()).toEqual({ error: "Unable to do it.", requestId: line.requestId });
    const failures = loggedLines(logged, "request_failed");
    expect(failures).toEqual([
      expect.objectContaining({
        level: "error",
        requestId: line.requestId,
        route: "/api/test",
        error: expect.objectContaining({ name: "Error", message: "database exploded" }),
      }),
    ]);
    expect(logged.findIndex((text) => text.includes('"request_failed"'))).toBeLessThan(logged.findIndex((text) => text.includes('"event":"request",')));
  });

  it("logs an unexpected error without a failure message once, then lets it propagate unchanged", async () => {
    const boom = new Error("boom");
    await expect(withUser(async () => { throw boom; })(call())).rejects.toBe(boom);

    expect(loggedLines(logged, "request_failed")).toHaveLength(1);
    expect(requestLines()).toEqual([expect.objectContaining({ level: "error", status: 500, userId: user.id })]);
  });

  it("logs an error withRequestGuard and withAnonymousLimit let through, and rethrows it", async () => {
    await expect(withRequestGuard(async () => { throw new Error("boom"); })(call())).rejects.toThrow("boom");
    await expect(withAnonymousLimit(async () => { throw new Error("boom"); })(call())).rejects.toThrow("boom");

    expect(loggedLines(logged, "request_failed")).toHaveLength(2);
    expect(requestLines().map((line) => [line.level, line.status])).toEqual([["error", 500], ["error", 500]]);
  });

  it("writes a request slower than LOG_SLOW_MS at warn with slow: true", async () => {
    vi.stubEnv("LOG_SLOW_MS", "5");
    const response = await withUser(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return json({ ok: true });
    })(call());

    expect(onlyLine(response)).toMatchObject({ level: "warn", status: 200, slow: true });
  });

  it("writes one line with an id for withRequestGuard and withAnonymousLimit", async () => {
    const guarded = await withRequestGuard(ok)(call("POST", "/api/auth"));
    expect(onlyLine(guarded)).toMatchObject({ level: "info", status: 200, method: "POST", route: "/api/auth" });

    logged.length = 0;
    const token = `sl_cal_${"A".repeat(43)}`;
    const anonymous = await withAnonymousLimit(ok)(call("GET", `/api/calendar/feed/${token}.ics`));
    const line = onlyLine(anonymous);
    expect(line).toMatchObject({ level: "info", status: 200, route: "/api/calendar/feed/:token" });
    expect(JSON.stringify(line)).not.toContain(token);
  });

  it("writes one line when one wrapper runs inside another", async () => {
    const response = await withRequestGuard(withAnonymousLimit(ok))(call("POST"));

    onlyLine(response);
  });

  it("adds a handler's own fields to the line, without letting them replace its own", async () => {
    const response = await withUser(async () => {
      addRequestFields({ familyId: "family-1", status: 999, route: "/forged" });
      return json({ ok: true });
    })(call());

    expect(onlyLine(response)).toMatchObject({ familyId: "family-1", status: 200, route: "/api/test" });
  });

  it("puts the request id on every line written inside the request, and on none outside", async () => {
    log.info("before");
    const response = await withUser(async () => {
      log.warn("inside", { step: 1 });
      return json({ ok: true });
    })(call());
    log.info("after");

    const id = response.headers.get("x-request-id");
    expect(loggedLines(logged, "inside")).toEqual([expect.objectContaining({ requestId: id, step: 1 })]);
    expect(loggedLines(logged, "before")[0]).not.toHaveProperty("requestId");
    expect(loggedLines(logged, "after")[0]).not.toHaveProperty("requestId");
    expect(currentRequest()).toBeUndefined();
  });

  it("keeps two interleaved requests apart: each line carries its own request's id", async () => {
    let releaseFirst!: () => void;
    const firstWaits = new Promise<void>((resolve) => (releaseFirst = resolve));
    const route = withUser(async (request: Request) => {
      const name = new URL(request.url).searchParams.get("name");
      log.info("step", { name, at: "start" });
      if (name === "first") await firstWaits;
      log.info("step", { name, at: "end" });
      return json({ name });
    });

    const first = route(call("GET", "/api/test?name=first"));
    const second = await route(call("GET", "/api/test?name=second"));
    releaseFirst();
    const firstResponse = await first;

    const ids = { first: firstResponse.headers.get("x-request-id"), second: second.headers.get("x-request-id") };
    expect(ids.first).not.toBe(ids.second);
    const steps = loggedLines(logged, "step");
    expect(steps.map((line) => line.name)).toEqual(["first", "second", "second", "first"]);
    for (const line of steps) expect(line.requestId).toBe(ids[line.name as "first" | "second"]);
    for (const line of requestLines()) expect([ids.first, ids.second]).toContain(line.requestId);
    expect(new Set(requestLines().map((line) => line.requestId)).size).toBe(2);
  });

  it("uses the id the proxy gave the request", async () => {
    const response = await withUser(ok)(call("GET", "/api/test", { "x-request-id": "Proxy1234567", "x-request-id-source": "proxy" }));

    expect(response.headers.get("x-request-id")).toBe("Proxy1234567");
    expect(onlyLine(response).requestId).toBe("Proxy1234567");
  });

  it.each([
    ["without the proxy's marker", { "x-request-id": "Forged123456" }],
    ["with a forged marker", { "x-request-id": "Forged123456", "x-request-id-source": "proxy" }],
  ])("ignores a client's x-request-id %s on a route the proxy skips", async (_name, headers) => {
    const response = await withAnonymousLimit(ok)(call("GET", "/api/calendar/feed/sl_cal_token.ics", headers));

    expect(response.headers.get("x-request-id")).not.toBe("Forged123456");
    expect(onlyLine(response).requestId).not.toBe("Forged123456");
  });

  it("ignores an x-request-id without the proxy's marker even where the proxy runs", async () => {
    const response = await withUser(ok)(call("GET", "/api/test", { "x-request-id": "Forged123456" }));

    expect(onlyLine(response).requestId).not.toBe("Forged123456");
  });

  it("sets x-request-id on a response whose headers can't be changed", async () => {
    const response = await withAnonymousLimit(async () => Response.redirect("http://localhost/login", 302))(call());

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/login");
    onlyLine(response);
  });

  it("writes a line for a handler called without a request, as tests do", async () => {
    const response = await withUser(ok)();

    expect(onlyLine(response)).toMatchObject({ method: "GET", route: "unknown", status: 200 });
  });
});
