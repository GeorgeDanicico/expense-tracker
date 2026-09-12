import { describe, expect, it } from "vitest";

import { mergeInvestmentQuotes } from "@/lib/investments/valuation";
import type { InvestmentsAggregate } from "@/lib/investments/types";
import type { Quote } from "@/lib/investments/quotes/types";

const baseAggregate: InvestmentsAggregate = {
  brokers: [{
    accountId: "account-xtb",
    brokerId: "xtb",
    totalsByCurrency: [{ currency: "EUR", remainingCost: "150", realizedGain: "0" }],
    assets: [{
      accountId: "account-xtb",
      brokerId: "xtb",
      instrument: "VWCE.DE",
      currency: "EUR",
      quantity: "1.5",
      remainingCost: "150",
      averageCost: "100",
      realizedGain: "0",
      transactionCount: 1,
    }],
  }],
  issues: [],
};

const euroQuote: Quote = {
  instrument: "VWCE.DE",
  price: "120",
  currency: "EUR",
  asOf: "2026-09-12T12:00:00Z",
  displayName: "Vanguard FTSE All-World UCITS ETF",
  source: "mock",
};

describe("investment quote valuation", () => {
  it("calculates current value and unrealized gain in the native currency", () => {
    const overview = mergeInvestmentQuotes(baseAggregate, new Map([[euroQuote.instrument, euroQuote]]));
    const asset = overview.brokers[0].assets[0];

    expect(asset.currentPrice).toBe("120");
    expect(asset.currentValue).toBe("180");
    expect(asset.unrealizedGain).toBe("30");
    expect(asset.priceStatus).toBe("current");
    expect(asset.priceSource).toBe("mock");
    expect(overview.brokers[0].totalsByCurrency[0]).toEqual({
      currency: "EUR",
      remainingCost: "150",
      currentValue: "180",
      unrealizedGain: "30",
    });
  });

  it("leaves value unavailable when a quote is missing", () => {
    const overview = mergeInvestmentQuotes(baseAggregate, new Map());
    const asset = overview.brokers[0].assets[0];

    expect(asset.currentValue).toBeNull();
    expect(asset.unrealizedGain).toBeNull();
    expect(asset.priceStatus).toBe("unavailable");
    expect(overview.brokers[0].totalsByCurrency[0].currentValue).toBeNull();
  });

  it("withholds valuation when the quote currency does not match", () => {
    const mismatchedQuote = { ...euroQuote, currency: "USD" };
    const overview = mergeInvestmentQuotes(
      baseAggregate,
      new Map([[mismatchedQuote.instrument, mismatchedQuote]]),
    );
    const asset = overview.brokers[0].assets[0];

    expect(asset.currentPrice).toBeNull();
    expect(asset.currentValue).toBeNull();
    expect(asset.unrealizedGain).toBeNull();
    expect(asset.priceStatus).toBe("currency_mismatch");
    expect(asset.priceSource).toBe("mock");
    expect(overview.brokers[0].totalsByCurrency[0].currentValue).toBeNull();
  });
});
