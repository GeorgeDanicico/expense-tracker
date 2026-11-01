import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET } from "@/app/api/avatars/[userId]/[file]/route";

const USER_ID = "10000000-0000-4000-8000-0000000000aa";
const FILE_ID = "20000000-0000-4000-8000-0000000000bb";
const PATH = `${USER_ID}/${FILE_ID}.webp`;
const BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);
const NOT_FOUND = { error: "That picture wasn't found." };

type Params = { userId: string; file: string };

/** Calls `GET` like Next does and keeps the raw response, since a picture isn't JSON. */
function get(params: Params) {
  const request = new NextRequest(`http://localhost/api/avatars/${params.userId}/${params.file}`);
  return GET(request, { params: Promise.resolve(params) });
}

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  signedInAs();
});

describe("GET /api/avatars/[userId]/[file]", () => {
  it("answers a stored picture as WebP that the browser may keep for a year", async () => {
    repositories.avatars.files.set(PATH, BYTES);

    const response = await get({ userId: USER_ID, file: FILE_ID });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-length")).toBe(String(BYTES.byteLength));
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
  });

  it("answers a picture the caller may not see with the same 404 as a missing one", async () => {
    repositories.avatars.files.set(PATH, BYTES);
    repositories.avatars.hidden.add(PATH);

    const hidden = await callRoute<Params>(GET, { params: { userId: USER_ID, file: FILE_ID } });
    const missing = await callRoute<Params>(GET, { params: { userId: USER_ID, file: "20000000-0000-4000-8000-0000000000cc" } });

    expect(hidden).toMatchObject({ status: 404, body: NOT_FOUND });
    expect(missing).toMatchObject({ status: 404, body: NOT_FOUND });
    expect(hidden.body).toEqual(missing.body);
    expect(hidden.headers.get("content-type")).toBe(missing.headers.get("content-type"));
  });

  it("answers 404 for a missing picture", async () => {
    const response = await callRoute<Params>(GET, { params: { userId: USER_ID, file: FILE_ID } });

    expect(response).toMatchObject({ status: 404, body: NOT_FOUND });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it.each([
    ["user id", { userId: "not-a-uuid", file: FILE_ID }],
    ["file id", { userId: USER_ID, file: "not-a-uuid" }],
    ["file id with an extension", { userId: USER_ID, file: `${FILE_ID}.webp` }],
    ["user id that is a path", { userId: "..", file: FILE_ID }],
  ])("answers 400 for a malformed %s", async (_label, params) => {
    repositories.avatars.files.set(PATH, BYTES);

    const response = await callRoute<Params>(GET, { params });

    expect(response).toMatchObject({ status: 400, body: NOT_FOUND });
  });

  // Path traversal: whatever the URL's two segments hold, only a uuid pair ever becomes a storage key.
  it.each([
    ["dot-dot as the file", { userId: USER_ID, file: ".." }],
    ["dot as the file", { userId: USER_ID, file: "." }],
    ["a relative path as the user", { userId: "../..", file: FILE_ID }],
    ["a relative path as the file", { userId: USER_ID, file: `../${USER_ID}/${FILE_ID}` }],
    ["a slash inside the file", { userId: USER_ID, file: `${USER_ID}/${FILE_ID}` }],
    ["a slash inside the user", { userId: `${USER_ID}/${FILE_ID}`, file: FILE_ID }],
    ["an encoded slash that was already decoded", { userId: USER_ID, file: `..%2F${FILE_ID}` }],
    ["an encoded dot-dot", { userId: "%2e%2e", file: FILE_ID }],
    ["an absolute path as the file", { userId: USER_ID, file: "/etc/passwd" }],
    ["an absolute path as the user", { userId: "/etc", file: FILE_ID }],
    ["a backslash path", { userId: USER_ID, file: `..\\${FILE_ID}` }],
    ["a trailing newline", { userId: USER_ID, file: `${FILE_ID}\n` }],
    ["a null byte", { userId: USER_ID, file: `${FILE_ID}\0` }],
    ["a leading space", { userId: USER_ID, file: ` ${FILE_ID}` }],
    ["an empty user", { userId: "", file: FILE_ID }],
    ["an empty file", { userId: USER_ID, file: "" }],
    ["a storage wildcard", { userId: "*", file: "*" }],
  ])("never reads storage for %s", async (_label, params) => {
    repositories.avatars.files.set(PATH, BYTES);
    const read = vi.spyOn(repositories.avatars, "read");

    const response = await callRoute<Params>(GET, { params });

    expect(response).toMatchObject({ status: 400, body: NOT_FOUND });
    expect(read).not.toHaveBeenCalled();
  });

  it("finds the lowercase key for upper-case ids in the URL", async () => {
    repositories.avatars.files.set(PATH, BYTES);

    const response = await get({ userId: USER_ID.toUpperCase(), file: FILE_ID.toUpperCase() });

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.avatars, "read").mockRejectedValue(new Error("private storage failure"));

    const response = await callRoute<Params>(GET, { params: { userId: USER_ID, file: FILE_ID } });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to load the picture." } });
  });
});
