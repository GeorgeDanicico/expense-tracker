import { describe, expect, it } from "vitest";

import { buildNetWorthOverview, combineNetWorthTotals } from "@/lib/net-worth/calculation";
import type { NetWorthTotal } from "@/lib/net-worth/types";
import type { InvestmentsOverview } from "@/lib/investments/types";
import { aManualItem, aValuation } from "@/test/builders";

type Asset = InvestmentsOverview["brokers"][number]["assets"][number];

const pricedApple: Asset = {
  instrument: "AAPL.US",
  displayName: "Apple Inc.",
  currency: "USD",
  quantity: "2",
  remainingCost: "1000",
  averageCost: "500",
  realizedGain: "0",
  currentPrice: "600",
  currentValue: "1200",
  unrealizedGain: "200",
  priceAsOf: "2026-09-19T12:00:00Z",
  priceStatus: "current",
  priceSource: "YAHOO_FINANCE",
};
const unpriced = { currentValue: null, currentPrice: null, unrealizedGain: null, priceAsOf: null, priceStatus: "unavailable", priceSource: null } as const;

/** One XTB account holding `assets`, with its USD totals derived the way the investments module reports them. */
function investmentsHolding(...assets: Asset[]): InvestmentsOverview {
  const priced = assets.every((asset) => asset.currentValue !== null);
  return {
    brokers: [{
      accountId: "broker-account",
      brokerId: "xtb",
      totalsByCurrency: [{
        currency: "USD",
        currentValue: priced ? "1200" : null,
        remainingCost: "1000",
        unrealizedGain: priced ? "200" : null,
      }],
      assets,
    }],
    calculationIssues: [],
  };
}

const noInvestments: InvestmentsOverview = { brokers: [], calculationIssues: [] };

function anItemValuedAt(id: string, values: string[], overrides: Parameters<typeof aManualItem>[0] = {}) {
  // Newest first, one month apart, as the data layer returns them.
  const valuations = values.map((value, index) =>
    aValuation({ id: `${id}-v${index}`, itemId: id, value, valuedOn: `2026-0${9 - index}-19` }));
  return aManualItem({ id, ...overrides, valuations });
}

describe("buildNetWorthOverview", () => {
  it("keeps manual items and investments in separate native-currency totals", () => {
    const overview = buildNetWorthOverview(investmentsHolding(pricedApple), [anItemValuedAt("cash", ["1250.50"])]);

    expect(overview.totalsByCurrency.map(({ currency, assets }) => ({ currency, assets }))).toEqual([
      { currency: "EUR", assets: "1250.5" },
      { currency: "USD", assets: "1200" },
    ]);
  });

  it("adds every asset in a currency and subtracts its liabilities", () => {
    const overview = buildNetWorthOverview(noInvestments, [
      anItemValuedAt("cash", ["1250.50"]),
      anItemValuedAt("home", ["220000"], { category: "property", purchaseAmount: "180000" }),
      anItemValuedAt("jewelry", ["2500"], { category: "jewelry" }),
      anItemValuedAt("mortgage", ["180000"], { kind: "liability", category: "debt" }),
    ]);

    expect(overview.totalsByCurrency).toEqual([{
      currency: "EUR",
      assets: "223750.5",
      liabilities: "180000",
      knownSubtotal: "43750.5",
      netWorth: "43750.5",
      missingValueCount: 0,
      status: "complete",
    }]);
  });

  it.each([
    {
      item: "a cash balance",
      source: anItemValuedAt("cash", ["1250.50", "1000"]),
      comparison: { label: "Balance change", amount: "250.5", meaning: "balance_change" },
    },
    {
      item: "a debt",
      source: anItemValuedAt("mortgage", ["180000", "181000"], { kind: "liability", category: "debt" }),
      comparison: { label: "Debt reduced", amount: "1000", meaning: "debt_reduction" },
    },
  ])("compares $item with its previous valuation", ({ source, comparison }) => {
    const overview = buildNetWorthOverview(noInvestments, [source]);

    expect(overview.entries[0].comparison).toMatchObject(comparison);
  });

  it("has no comparison for an item with one valuation and no purchase amount", () => {
    const overview = buildNetWorthOverview(noInvestments, [anItemValuedAt("jewelry", ["2500"], { category: "jewelry" })]);

    expect(overview.entries[0].comparison).toBeNull();
  });

  it("does not count a holding without a quote as zero", () => {
    const overview = buildNetWorthOverview(investmentsHolding({ ...pricedApple, ...unpriced }), []);

    expect(overview.totalsByCurrency[0]).toMatchObject({
      currency: "USD",
      assets: "0",
      knownSubtotal: "0",
      netWorth: null,
      missingValueCount: 1,
      status: "incomplete",
    });
  });

  it("asks for attention to a holding without a current quote", () => {
    const overview = buildNetWorthOverview(investmentsHolding({ ...pricedApple, ...unpriced }), []);

    expect(overview.attention[0].message).toContain("no current market quote");
  });

  it("leaves fully sold positions out of the entries", () => {
    const sold: Asset = { ...pricedApple, ...unpriced, instrument: "SOLD.US", displayName: "Sold position", quantity: "0", remainingCost: "0" };

    const overview = buildNetWorthOverview(investmentsHolding({ ...pricedApple, ...unpriced }, sold), []);

    expect(overview.entries.map((entry) => entry.name)).toEqual(["Apple Inc."]);
  });
});

describe("combineNetWorthTotals", () => {
  const total = (overrides: Partial<NetWorthTotal>): NetWorthTotal => ({
    currency: "EUR", assets: "0", liabilities: "0", knownSubtotal: "0", netWorth: "0",
    missingValueCount: 0, status: "complete", ...overrides,
  });

  it("adds members' totals per currency and keeps currencies apart", () => {
    const combined = combineNetWorthTotals([
      [total({ assets: "100.1", liabilities: "20", knownSubtotal: "80.1", netWorth: "80.1" })],
      [
        total({ assets: "50.2", knownSubtotal: "50.2", netWorth: "50.2" }),
        total({ currency: "RON", assets: "7", knownSubtotal: "7", netWorth: "7" }),
      ],
    ]);

    expect(combined).toEqual([
      { currency: "EUR", assets: "150.3", liabilities: "20", knownSubtotal: "130.3", netWorth: "130.3", missingValueCount: 0, status: "complete" },
      { currency: "RON", assets: "7", liabilities: "0", knownSubtotal: "7", netWorth: "7", missingValueCount: 0, status: "complete" },
    ]);
  });

  it("leaves the combined net worth unknown when any member's is incomplete", () => {
    const [eur] = combineNetWorthTotals([
      [total({ assets: "10", knownSubtotal: "10", netWorth: "10" })],
      [total({ assets: "5", knownSubtotal: "5", netWorth: null, missingValueCount: 2, status: "incomplete" })],
    ]);

    expect(eur).toMatchObject({ knownSubtotal: "15", netWorth: null, missingValueCount: 2, status: "incomplete" });
  });

  it("returns nothing for members without totals", () => {
    expect(combineNetWorthTotals([[], []])).toEqual([]);
  });
});
