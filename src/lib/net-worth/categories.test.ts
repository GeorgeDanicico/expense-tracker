import { describe, expect, it } from "vitest";

import { netWorthCategoryLabel, netWorthCategoryOptions, netWorthCategoryRank } from "@/lib/net-worth/types";

describe("net-worth categories", () => {
  it("offers each kind its own categories, then a custom one; Investments is never offered", () => {
    expect(netWorthCategoryOptions("asset")).toEqual([
      { value: "cash", label: "Cash" },
      { value: "property", label: "Property" },
      { value: "jewelry", label: "Jewelry" },
      { value: "custom", label: "Custom category" },
    ]);
    expect(netWorthCategoryOptions("liability")).toEqual([
      { value: "debt", label: "Debt or mortgage" },
      { value: "custom", label: "Custom category" },
    ]);
  });

  it("orders groups by the table, custom ones last", () => {
    const groups = ["collectibles", "debt", "cash", "investments"];
    expect(groups.toSorted((a, b) => netWorthCategoryRank(a) - netWorthCategoryRank(b))).toEqual(["investments", "cash", "debt", "collectibles"]);
  });

  it("labels known categories and title-cases custom ones", () => {
    expect(netWorthCategoryLabel("debt")).toBe("Debts");
    expect(netWorthCategoryLabel("art-pieces")).toBe("Art Pieces");
  });
});
