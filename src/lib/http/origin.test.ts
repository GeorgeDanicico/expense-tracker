import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/http/origin";

describe("safeNextPath", () => {
  it.each(["/expenses", "/join/ABCD2345", "/settings/family?tab=1"])("keeps the same-site path %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    ["an external URL", "https://evil.test/"],
    ["a protocol-relative path", "//evil.test/path"],
    ["a backslash path", "/\\evil.test"],
    ["a relative path", "expenses"],
    ["an empty value", ""],
    ["a missing value", null],
    ["an undefined value", undefined],
  ])("falls back to the dashboard for %s", (_, value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });
});
