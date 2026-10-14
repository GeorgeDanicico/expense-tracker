import { describe, expect, it } from "vitest";

import { purchaseAmountAllowed } from "@/lib/net-worth/rules";

describe("purchaseAmountAllowed", () => {
  it.each([
    { kind: "asset" as const, category: "property", allowed: true },
    { kind: "asset" as const, category: "cash", allowed: false },
    { kind: "liability" as const, category: "debt", allowed: false },
  ])("is $allowed for a $kind in $category", ({ kind, category, allowed }) => {
    expect(purchaseAmountAllowed(kind, category)).toBe(allowed);
  });
});
