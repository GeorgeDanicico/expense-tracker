import { describe, expect, it } from "vitest";

import { familyInvestmentTotals } from "@/lib/investments/family-totals";
import type { FamilyInvestmentsOverview, InvestmentsOverview } from "@/lib/investments/types";

type Total = InvestmentsOverview["brokers"][number]["totalsByCurrency"][number];

function member(id: string, ...totals: Total[]) {
  return {
    memberId: id,
    name: id,
    currency: "EUR",
    overview: { brokers: [{ accountId: id, brokerId: "TRADING212", totalsByCurrency: totals, assets: [] }] },
  } as unknown as FamilyInvestmentsOverview["members"][number];
}

describe("familyInvestmentTotals", () => {
  it("adds members up per currency without mixing currencies", () => {
    const totals = familyInvestmentTotals({
      members: [
        member("a", { currency: "EUR", currentValue: "110.50", remainingCost: "100", unrealizedGain: "10.50" }),
        member(
          "b",
          { currency: "EUR", currentValue: "50", remainingCost: "40", unrealizedGain: "10" },
          { currency: "USD", currentValue: "5", remainingCost: "4", unrealizedGain: "1" },
        ),
      ],
    });
    expect(totals).toEqual([
      { currency: "EUR", currentValue: "160.5", remainingCost: "140", unrealizedGain: "20.5" },
      { currency: "USD", currentValue: "5", remainingCost: "4", unrealizedGain: "1" },
    ]);
  });

  it("leaves the value out when any member has no quote", () => {
    const [eur] = familyInvestmentTotals({
      members: [
        member("a", { currency: "EUR", currentValue: "110", remainingCost: "100", unrealizedGain: "10" }),
        member("b", { currency: "EUR", currentValue: null, remainingCost: "40", unrealizedGain: null }),
      ],
    });
    expect(eur).toEqual({ currency: "EUR", currentValue: null, remainingCost: "140", unrealizedGain: null });
  });

  it("returns nothing when nobody has investments", () => {
    expect(familyInvestmentTotals({ members: [member("a")] })).toEqual([]);
  });
});
