import { strFromU8, unzipSync } from "fflate";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXPORT_SECTIONS, type ExportRow, type ExportSection } from "@/lib/account/data-repository";
import { forgetLastActive } from "@/lib/family/last-active";
import { DATA_EXPORT_MAX_ATTEMPTS, resetRateLimits, TOO_MANY_DATA_EXPORTS } from "@/lib/http/rate-limit";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs, testUser } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { POST } from "@/app/api/account/export/route";

// `POST /api/account/export` (security plan S13). Which rows each section holds, and that they're only
// the caller's, is the database's job (export_my_data, supabase/tests/account_deletion.sql); here the
// archive holds every section the database returns, as JSON and CSV, and nothing else.

const OTHER_USER = "20000000-0000-4000-8000-000000000002";

let repositories: FakeRepositories;

/** One row per section for `userId`, tagged so a leak shows. */
function exportFor(tag: string): Partial<Record<ExportSection, ExportRow[]>> {
  return Object.fromEntries(EXPORT_SECTIONS.map((section) => [section, [{ id: `${tag}-${section}`, section, owner: tag }]]));
}

beforeEach(() => {
  resetRateLimits();
  forgetLastActive();
  repositories = resetFakeRepositories();
  signedInAs();
  repositories.accountData.exports.set(testUser.id, exportFor("mine"));
  repositories.accountData.exports.set(OTHER_USER, exportFor("theirs"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Calls the route and unzips the archive it streams. */
async function download() {
  const response = await POST(new NextRequest("http://localhost/api/account/export", { method: "POST", headers: { "sec-fetch-site": "same-origin" } }));
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, files: unzipSync(bytes) };
}

describe("POST /api/account/export", () => {
  it("streams a ZIP with a README and every section as JSON and CSV", async () => {
    const { response, files } = await download();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="my-data-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(Object.keys(files)).toEqual([
      "README.txt",
      ...EXPORT_SECTIONS.flatMap((section) => [`${section}.json`, `${section}.csv`]),
    ]);
    expect(repositories.accountData.sectionsRead).toEqual([...EXPORT_SECTIONS]);
  });

  it("holds each section's rows, and nothing of another user", async () => {
    const { files } = await download();

    for (const section of EXPORT_SECTIONS) {
      expect(JSON.parse(strFromU8(files[`${section}.json`]))).toEqual([{ id: `mine-${section}`, section, owner: "mine" }]);
      expect(strFromU8(files[`${section}.csv`])).toBe(`id,section,owner\r\nmine-${section},${section},mine\r\n`);
    }
    const everything = Object.values(files).map((file) => strFromU8(file)).join("\n");
    expect(everything).not.toContain("theirs");
  });

  it("writes an empty section as [] and an empty CSV", async () => {
    repositories.accountData.exports.set(testUser.id, {});

    const { files } = await download();

    expect(strFromU8(files["expenses.json"])).toBe("[]\n");
    expect(strFromU8(files["expenses.csv"])).toBe("");
  });

  it("adds the profile picture when there is one", async () => {
    const path = `${testUser.id}/11111111-1111-4111-8111-111111111111.webp`;
    repositories.avatars.paths.set(testUser.id, path);
    repositories.avatars.files.set(path, new Uint8Array([82, 73, 70, 70]));

    const { files } = await download();

    expect([...files["picture.webp"]]).toEqual([82, 73, 70, 70]);
  });

  it("answers a JSON 500 when the first section can't be read, as without S13's migration", async () => {
    repositories.accountData.failSection = "profile";

    const response = await callRoute(POST, { method: "POST" });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to prepare your data. Please try again." } });
  });

  it("fails the download instead of ending with a partial archive when a later section can't be read", async () => {
    repositories.accountData.failSection = "reminders";

    const response = await POST(new NextRequest("http://localhost/api/account/export", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow("Unable to prepare your data.");
  });

  it(`answers 429 past ${DATA_EXPORT_MAX_ATTEMPTS} exports an hour`, async () => {
    for (let attempt = 0; attempt < DATA_EXPORT_MAX_ATTEMPTS; attempt += 1) {
      expect((await download()).response.status).toBe(200);
    }

    const limited = await callRoute(POST, { method: "POST" });

    expect(limited).toMatchObject({ status: 429, body: { error: TOO_MANY_DATA_EXPORTS } });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("refuses a request another site started", async () => {
    const response = await callRoute(POST, { method: "POST", headers: { "sec-fetch-site": "cross-site" } });

    expect(response.status).toBe(403);
    expect(repositories.accountData.sectionsRead).toEqual([]);
  });

  it("refuses a signed-out request", async () => {
    signedInAs(null as never);

    expect((await callRoute(POST, { method: "POST" })).status).toBe(401);
  });
});
