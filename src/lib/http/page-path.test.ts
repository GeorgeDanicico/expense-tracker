import { describe, expect, it } from "vitest";

import { pagePathOf } from "@/lib/http/page-path";

describe("pagePathOf", () => {
  it("keeps the path and its query", () => {
    expect(pagePathOf({ pathname: "/expenses", search: "?month=2026-10&tab=all" })).toBe("/expenses?month=2026-10&tab=all");
  });

  it("drops Next's `_rsc` parameter and the `?` it leaves empty", () => {
    expect(pagePathOf({ pathname: "/todos", search: "?_rsc=abc" })).toBe("/todos");
    expect(pagePathOf({ pathname: "/expenses", search: "?month=2026-10&_rsc=abc" })).toBe("/expenses?month=2026-10");
  });

  it("is the bare path without a query", () => {
    expect(pagePathOf({ pathname: "/dashboard", search: "" })).toBe("/dashboard");
  });
});
