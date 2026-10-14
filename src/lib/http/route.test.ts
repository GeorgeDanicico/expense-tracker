import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

import { DomainError } from "@/lib/errors";
import { HttpError, json, noContent, notFound, parseBody, parseId, withUser } from "@/lib/http/route";

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

  it("maps any other error to a 500 with the route's failure message", async () => {
    expect(await respond(() => { throw new Error("boom"); })).toEqual({ status: 500, body: { error: "Unable to do it." } });
  });

  it("lets unexpected errors propagate when no failure message is given", async () => {
    await expect(withUser(async () => { throw new Error("boom"); })()).rejects.toThrow("boom");
  });
});
