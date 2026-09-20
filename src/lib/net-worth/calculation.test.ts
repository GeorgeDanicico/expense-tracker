import { describe, expect, it } from "vitest";

import { buildNetWorthOverview } from "@/lib/net-worth/calculation";
import type { InvestmentsOverview } from "@/lib/investments/types";

const investments: InvestmentsOverview = {
  brokers: [{
    accountId: "broker-account",
    brokerId: "xtb",
    totalsByCurrency: [{
      currency: "USD",
      currentValue: "1200",
      remainingCost: "1000",
      unrealizedGain: "200",
    }],
    assets: [{
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
    }],
  }],
  calculationIssues: [],
};

describe("net-worth calculation", () => {
  it("keeps manual items and investments separate by native currency", () => {
    const overview = buildNetWorthOverview(investments, [
      {
        id: "cash-1",
        name: "EUR current account",
        kind: "asset",
        category: "cash",
        currency: "EUR",
        purchaseAmount: null,
        archivedAt: null,
        valuations: [
          { id: "cash-v2", itemId: "cash-1", value: "1250.50", valuedOn: "2026-09-19" },
          { id: "cash-v1", itemId: "cash-1", value: "1000", valuedOn: "2026-09-18" },
        ],
      },
      {
        id: "home-1",
        name: "Apartment",
        kind: "asset",
        category: "property",
        currency: "EUR",
        purchaseAmount: "180000",
        archivedAt: null,
        valuations: [
          { id: "home-v1", itemId: "home-1", value: "220000", valuedOn: "2026-09-19" },
        ],
      },
      {
        id: "mortgage-1",
        name: "Mortgage",
        kind: "liability",
        category: "debt",
        currency: "EUR",
        purchaseAmount: null,
        archivedAt: null,
        valuations: [
          { id: "mortgage-v2", itemId: "mortgage-1", value: "180000", valuedOn: "2026-09-19" },
          { id: "mortgage-v1", itemId: "mortgage-1", value: "181000", valuedOn: "2026-08-19" },
        ],
      },
      {
        id: "jewelry-1",
        name: "Wedding jewelry",
        kind: "asset",
        category: "jewelry",
        currency: "EUR",
        purchaseAmount: null,
        archivedAt: null,
        valuations: [
          { id: "jewelry-v1", itemId: "jewelry-1", value: "2500", valuedOn: "2026-09-19" },
        ],
      },
    ]);

    expect(overview.totalsByCurrency).toEqual([
      {
        currency: "EUR",
        assets: "223750.5",
        liabilities: "180000",
        knownSubtotal: "43750.5",
        netWorth: "43750.5",
        missingValueCount: 0,
        status: "complete",
      },
      {
        currency: "USD",
        assets: "1200",
        liabilities: "0",
        knownSubtotal: "1200",
        netWorth: "1200",
        missingValueCount: 0,
        status: "complete",
      },
    ]);

    expect(overview.entries.find((entry) => entry.id === "manual:cash-1")?.comparison).toMatchObject({
      label: "Balance change",
      amount: "250.5",
      meaning: "balance_change",
    });
    expect(overview.entries.find((entry) => entry.id === "manual:mortgage-1")?.comparison).toMatchObject({
      label: "Debt reduced",
      amount: "1000",
      meaning: "debt_reduction",
    });
    expect(overview.entries.find((entry) => entry.id === "manual:jewelry-1")?.comparison).toBeNull();
  });

  it("does not treat missing quotes as zero and excludes fully sold positions", () => {
    const overview = buildNetWorthOverview({
      brokers: [{
        accountId: "broker-account",
        brokerId: "xtb",
        totalsByCurrency: [{
          currency: "USD",
          currentValue: null,
          remainingCost: "1000",
          unrealizedGain: null,
        }],
        assets: [
          {
            ...investments.brokers[0].assets[0],
            currentValue: null,
            currentPrice: null,
            unrealizedGain: null,
            priceAsOf: null,
            priceStatus: "unavailable",
            priceSource: null,
          },
          {
            ...investments.brokers[0].assets[0],
            instrument: "SOLD.US",
            displayName: "Sold position",
            quantity: "0",
            remainingCost: "0",
            currentValue: null,
            currentPrice: null,
            unrealizedGain: null,
            priceAsOf: null,
            priceStatus: "unavailable",
            priceSource: null,
          },
        ],
      }],
      calculationIssues: [],
    }, []);

    expect(overview.entries).toHaveLength(1);
    expect(overview.totalsByCurrency[0]).toMatchObject({
      currency: "USD",
      assets: "0",
      knownSubtotal: "0",
      netWorth: null,
      missingValueCount: 1,
      status: "incomplete",
    });
    expect(overview.attention[0].message).toContain("no current market quote");
  });
});
