import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { DomainError } from "@/lib/errors";
import { ImportError } from "@/lib/imports/types";
import { HttpError, json, noContent, notFound, parseBody, parseId, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { fakeSupabase } from "@/test/fake-supabase";

const PRIVATE = "private, no-store, max-age=0";
const user = { id: "user-1", email: "user@example.com" };
const schema = z.object({ name: z.string().min(1, "Name is required.") });
const post = (body: string) => new Request("http://localhost/api/test", { method: "POST", body });

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

describe("withUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(user);
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
    expect(await respond(() => { throw new Error("boom"); })).toEqual({ status: 500, body: { error: "Unable to do it." } });
  });

  it("lets unexpected errors propagate when no failure message is given", async () => {
    await expect(withUser(async () => { throw new Error("boom"); })()).rejects.toThrow("boom");
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
    expect(tokenDatabase.queries).toEqual([expect.objectContaining({ table: "profiles", filters: [["eq", "id", bearerUser.id]] })]);
    expect(mocks.createSupabaseClient).toHaveBeenCalledWith("http://supabase.test", "pk", expect.objectContaining({
      global: { headers: { Authorization: `Bearer ${VALID_TOKEN}` } },
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
