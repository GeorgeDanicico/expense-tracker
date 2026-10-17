import { describe, expect, it } from "vitest";

import type { FamilyDashboardMember } from "@/lib/expenses/types";

import { categoryBars, currenciesByTotal, membersIn, monthShares, percentOf, trendColumns } from "./family-charts";

const member = (overrides: Partial<FamilyDashboardMember>): FamilyDashboardMember => ({
  memberId: "m",
  name: "M",
  currency: "EUR",
  total: 0,
  count: 0,
  series: [],
  categoryTotals: [],
  ...overrides,
});

const mara = member({
  memberId: "m1",
  name: "Mara",
  currency: "RON",
  total: 300,
  series: [{ key: "2026-08", label: "", total: 100 }, { key: "2026-09", label: "", total: 300 }],
  categoryTotals: [{ category: "groceries", label: "Groceries", total: 80 }, { category: "car", label: "Car", total: 20 }],
});
const dan = member({
  memberId: "m2",
  name: "Dan",
  currency: "RON",
  total: 100,
  series: [{ key: "2026-09", label: "", total: 100 }],
  categoryTotals: [{ category: "car", label: "Car", total: 90 }, { category: "health", label: "Health", total: 0 }],
});
const ana = member({ memberId: "m3", name: "Ana", currency: "EUR", total: 500 });

describe("currenciesByTotal", () => {
  it("puts the currency with the largest total first, never adding across currencies", () => {
    expect(currenciesByTotal([mara, dan, ana])).toEqual(["EUR", "RON"]);
    expect(currenciesByTotal([mara, dan, member({ currency: "EUR", total: 399 })])).toEqual(["RON", "EUR"]);
  });

  it("is empty without members", () => {
    expect(currenciesByTotal([])).toEqual([]);
  });
});

describe("membersIn", () => {
  it("keeps only the members of that currency", () => {
    expect(membersIn([mara, dan, ana], "RON").map((m) => m.name)).toEqual(["Mara", "Dan"]);
  });
});

describe("monthShares", () => {
  it("totals the members and gives each a share, biggest first", () => {
    const { total, shares } = monthShares([dan, mara]);

    expect(total).toBe(400);
    expect(shares.map((s) => [s.name, s.share])).toEqual([["Mara", 75], ["Dan", 25]]);
  });

  it("has zero shares for an empty month", () => {
    expect(monthShares([member({ name: "A" })]).shares[0].share).toBe(0);
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe("trendColumns", () => {
  it("lines the members up by month, oldest first, with 0 for a missing month", () => {
    const columns = trendColumns([mara, dan]);

    expect(columns.map((c) => [c.key, c.total])).toEqual([["2026-08", 100], ["2026-09", 400]]);
    expect(columns[0].segments.map((s) => [s.name, s.total])).toEqual([["Mara", 100], ["Dan", 0]]);
  });
});

describe("categoryBars", () => {
  it("splits each category by member, sorted by total, leaving out zero spending", () => {
    const bars = categoryBars([mara, dan]);

    expect(bars.map((b) => [b.label, b.total])).toEqual([["Car", 110], ["Groceries", 80]]);
    expect(bars[0].segments.map((s) => [s.name, s.total])).toEqual([["Mara", 20], ["Dan", 90]]);
  });
});
