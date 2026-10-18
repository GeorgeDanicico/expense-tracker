import { describe, expect, it } from "vitest";

import { AVATARS_API_PREFIX, avatarPathFromUrlParts, avatarUrl, newAvatarPath } from "@/lib/avatars/paths";

const userId = "10000000-0000-4000-8000-000000000001";
const fileId = "20000000-0000-4000-8000-000000000002";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

describe("avatar paths", () => {
  it("puts a new key in the user's own folder, with a fresh uuid each time", () => {
    const first = newAvatarPath(userId);

    expect(first).toMatch(new RegExp(`^${userId}/${UUID}\\.webp$`));
    expect(newAvatarPath(userId)).not.toBe(first);
  });

  it("round trips a new key to its API URL", () => {
    const path = newAvatarPath(userId);
    const fileUuid = path.slice(userId.length + 1, -".webp".length);

    expect(avatarUrl(path)).toBe(`${AVATARS_API_PREFIX}/${userId}/${fileUuid}`);
    expect(avatarPathFromUrlParts(userId, fileUuid)).toBe(path);
  });

  it("lowercases upper-case ids", () => {
    expect(newAvatarPath("ABCDEF00-0000-4000-8000-00000000000A")).toMatch(
      new RegExp(`^abcdef00-0000-4000-8000-00000000000a/${UUID}\\.webp$`),
    );
    expect(avatarPathFromUrlParts("ABCDEF00-0000-4000-8000-00000000000A", "ABCDEF00-0000-4000-8000-00000000000B")).toBe(
      "abcdef00-0000-4000-8000-00000000000a/abcdef00-0000-4000-8000-00000000000b.webp",
    );
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty key", ""],
    ["a key without uuids", "x/y.webp"],
    ["a .png key", `${userId}/${fileId}.png`],
    ["a key with an extra folder", `extra/${userId}/${fileId}.webp`],
    ["a key with a nested file", `${userId}/extra/${fileId}.webp`],
    ["an upper-case key", "ABCDEF00-0000-4000-8000-00000000000A/ABCDEF00-0000-4000-8000-00000000000B.webp"],
  ])("gives no URL for %s", (_name, path) => {
    expect(avatarUrl(path)).toBeNull();
  });
});
