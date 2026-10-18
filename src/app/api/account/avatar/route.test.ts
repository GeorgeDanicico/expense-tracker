import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import { AVATAR_UPLOAD_MAX_ATTEMPTS, AVATAR_UPLOAD_WINDOW_MS, resetRateLimits } from "@/lib/http/rate-limit";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs, testUser } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { DELETE, PUT } from "@/app/api/account/avatar/route";

const OTHER_USER = { id: "10000000-0000-4000-8000-000000000002", email: "other@example.test" };
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const WRONG_TYPE = "Choose a JPG or PNG image.";

/** A plain test image, made at test time so no binary fixtures are committed. */
const photo = (format: "jpeg" | "png") =>
  sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 40, g: 120, b: 200 } } })[format]().toBuffer();

const GIF_BYTES = new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;");

type UploadOptions = {
  /** The `Content-Type` header; `null` sends none. */
  type?: string | null;
  url?: string;
  headers?: Record<string, string>;
};

/** Calls `PUT` with a raw body, as the browser does; `callRoute` only sends JSON. */
async function upload(body: BodyInit, { type = "image/jpeg", url = "/api/account/avatar", headers = {} }: UploadOptions = {}) {
  const request = new NextRequest(new URL(url, "http://localhost"), {
    method: "PUT",
    headers: { ...(type === null ? {} : { "content-type": type }), ...headers },
    body,
    duplex: "half",
  });
  const response = await PUT(request, { params: Promise.resolve({}) });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  return { status: response.status, body: isJson ? await response.json() : null };
}

const bytes = (buffer: Buffer) => new Uint8Array(buffer);

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
  resetRateLimits();
  forgetLastActive();
  signedInAs();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PUT /api/account/avatar", () => {
  it("stores a JPEG as the caller's WebP picture and answers its URL", async () => {
    const response = await upload(bytes(await photo("jpeg")), { type: "image/jpeg" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ avatarUrl: expect.stringMatching(new RegExp(`^/api/avatars/${testUser.id}/${UUID}$`)) });
    expect(repositories.avatars.replaced).toEqual([testUser.id]);

    const path = repositories.avatars.paths.get(testUser.id)!;
    expect(response.body.avatarUrl).toBe(`/api/avatars/${path.replace(/\.webp$/, "")}`);
    const stored = repositories.avatars.files.get(path)!;
    expect(await sharp(stored).metadata()).toMatchObject({ format: "webp", width: 256, height: 256 });
  });

  it("accepts a PNG sent as image/png", async () => {
    const response = await upload(bytes(await photo("png")), { type: "image/png" });

    expect(response.status).toBe(200);
    expect(repositories.avatars.replaced).toEqual([testUser.id]);
  });

  it("accepts a PNG sent as image/jpeg, because the content decides", async () => {
    const response = await upload(bytes(await photo("png")), { type: "image/jpeg" });

    expect(response.status).toBe(200);
  });

  it("accepts a content type with parameters and in any case", async () => {
    const response = await upload(bytes(await photo("jpeg")), { type: "Image/JPEG; charset=binary" });

    expect(response.status).toBe(200);
  });

  it("refuses image/gif with 415 without storing anything", async () => {
    const response = await upload(GIF_BYTES, { type: "image/gif" });

    expect(response).toEqual({ status: 415, body: { error: WRONG_TYPE } });
    expect(repositories.avatars.replaced).toEqual([]);
  });

  it("refuses a body without a content type with 415", async () => {
    const response = await upload(bytes(await photo("jpeg")), { type: null });

    expect(response).toEqual({ status: 415, body: { error: WRONG_TYPE } });
    expect(repositories.avatars.replaced).toEqual([]);
  });

  it("refuses GIF bytes sent as image/png with 415", async () => {
    const response = await upload(GIF_BYTES, { type: "image/png" });

    expect(response).toEqual({ status: 415, body: { error: WRONG_TYPE } });
    expect(repositories.avatars.replaced).toEqual([]);
  });

  it("refuses an empty body with 415", async () => {
    const response = await upload(new Uint8Array(), { type: "image/png" });

    expect(response).toEqual({ status: 415, body: { error: WRONG_TYPE } });
  });

  it("refuses a Content-Length over 5 MB with 413 without reading the body", async () => {
    let pulled = false;
    // A high-water mark of 0 keeps the stream from pulling ahead: `pull` runs only when someone reads.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true;
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );

    const response = await upload(body, { headers: { "content-length": String(5 * 1024 * 1024 + 1) } });

    expect(response).toEqual({ status: 413, body: { error: "Choose an image under 5 MB." } });
    expect(pulled).toBe(false);
    expect(repositories.avatars.replaced).toEqual([]);
  });

  it("refuses a body over 5 MB without a Content-Length with 413", async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    oversized.set([0xff, 0xd8, 0xff]);

    const response = await upload(oversized);

    expect(response).toEqual({ status: 413, body: { error: "Choose an image under 5 MB." } });
  });

  it("refuses truncated JPEG bytes with 422", async () => {
    const jpeg = await photo("jpeg");

    const response = await upload(bytes(jpeg.subarray(0, Math.floor(jpeg.length / 2))));

    expect(response).toEqual({ status: 422, body: { error: "That image couldn't be read. Try another JPG or PNG." } });
    expect(repositories.avatars.replaced).toEqual([]);
  });

  it("refuses the 21st attempt within the hour, counting failed ones, and allows uploads again an hour later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
    for (let attempt = 0; attempt < AVATAR_UPLOAD_MAX_ATTEMPTS; attempt++) {
      expect((await upload(GIF_BYTES, { type: "image/gif" })).status).toBe(415);
    }

    const limited = await upload(bytes(await photo("jpeg")));

    expect(limited).toEqual({
      status: 429,
      body: { error: "You've changed your picture a lot recently. Try again in an hour." },
    });
    expect(repositories.avatars.replaced).toEqual([]);

    vi.setSystemTime(new Date(Date.now() + AVATAR_UPLOAD_WINDOW_MS));
    expect((await upload(bytes(await photo("jpeg")))).status).toBe(200);
    expect(repositories.avatars.replaced).toEqual([testUser.id]);
  });

  it("counts attempts per user", async () => {
    for (let attempt = 0; attempt < AVATAR_UPLOAD_MAX_ATTEMPTS; attempt++) await upload(GIF_BYTES, { type: "image/gif" });

    signedInAs(OTHER_USER);
    repositories.avatars.caller = { userId: OTHER_USER.id };

    expect((await upload(bytes(await photo("jpeg")))).status).toBe(200);
  });

  it("changes only the caller's own picture", async () => {
    const ownPath = `${OTHER_USER.id}/20000000-0000-4000-8000-0000000000b1.webp`;
    const othersPath = `${testUser.id}/20000000-0000-4000-8000-0000000000a1.webp`;
    const othersBytes = new Uint8Array([1, 2, 3]);
    repositories.avatars.paths.set(OTHER_USER.id, ownPath);
    repositories.avatars.files.set(ownPath, new Uint8Array([4, 5, 6]));
    repositories.avatars.paths.set(testUser.id, othersPath);
    repositories.avatars.files.set(othersPath, othersBytes);
    signedInAs(OTHER_USER);
    repositories.avatars.caller = { userId: OTHER_USER.id };

    const response = await upload(bytes(await photo("jpeg")));

    expect(response.status).toBe(200);
    expect(response.body.avatarUrl).toMatch(new RegExp(`^/api/avatars/${OTHER_USER.id}/`));
    expect(repositories.avatars.replaced).toEqual([OTHER_USER.id]);
    expect(repositories.avatars.paths.get(OTHER_USER.id)).not.toBe(ownPath);
    expect(repositories.avatars.files.has(ownPath)).toBe(false);
    expect(repositories.avatars.paths.get(testUser.id)).toBe(othersPath);
    expect(repositories.avatars.files.get(othersPath)).toEqual(othersBytes);
  });

  it.each([
    ["a userId in the query", { url: `/api/account/avatar?userId=${OTHER_USER.id}` }],
    ["a userId header", { headers: { userId: OTHER_USER.id } }],
  ])("ignores %s: only the caller's picture is replaced", async (_label, options) => {
    const othersPath = `${OTHER_USER.id}/20000000-0000-4000-8000-0000000000b1.webp`;
    const othersBytes = new Uint8Array([4, 5, 6]);
    repositories.avatars.paths.set(OTHER_USER.id, othersPath);
    repositories.avatars.files.set(othersPath, othersBytes);

    const response = await upload(bytes(await photo("jpeg")), options);

    expect(response.status).toBe(200);
    expect(response.body.avatarUrl).toMatch(new RegExp(`^/api/avatars/${testUser.id}/`));
    expect(repositories.avatars.replaced).toEqual([testUser.id]);
    expect(repositories.avatars.paths.get(OTHER_USER.id)).toBe(othersPath);
    expect(repositories.avatars.files.get(othersPath)).toEqual(othersBytes);
  });

  it("answers privately, so the new URL is never cached", async () => {
    const request = new NextRequest("http://localhost/api/account/avatar", {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: bytes(await photo("jpeg")),
    });

    const response = await PUT(request);

    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.avatars, "replace").mockRejectedValue(new Error("private storage failure"));

    const response = await upload(bytes(await photo("jpeg")));

    expect(response).toEqual({ status: 500, body: { error: "Unable to save your picture. Please try again." } });
  });
});

describe("DELETE /api/account/avatar", () => {
  it("removes the caller's picture and answers 204", async () => {
    const path = `${testUser.id}/20000000-0000-4000-8000-0000000000a1.webp`;
    repositories.avatars.paths.set(testUser.id, path);
    repositories.avatars.files.set(path, new Uint8Array([1, 2, 3]));

    const response = await callRoute(DELETE, { method: "DELETE" });

    expect(response.status).toBe(204);
    expect(repositories.avatars.removed).toEqual([testUser.id]);
    expect(repositories.avatars.paths.has(testUser.id)).toBe(false);
    expect(repositories.avatars.files.has(path)).toBe(false);
  });

  it("answers 204 when the caller has no picture", async () => {
    const response = await callRoute(DELETE, { method: "DELETE" });

    expect(response.status).toBe(204);
    expect(repositories.avatars.removed).toEqual([testUser.id]);
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.avatars, "remove").mockRejectedValue(new Error("private storage failure"));

    const response = await callRoute(DELETE, { method: "DELETE" });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to remove your picture. Please try again." } });
  });
});
