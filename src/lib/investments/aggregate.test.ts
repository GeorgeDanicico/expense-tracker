import { describe, expect, it } from "vitest";

import {
  aggregateInvestments,
  calculateInvestmentPosition,
} from "@/lib/investments/aggregate";
import type { InvestmentAccount } from "@/lib/investments/types";
import { aTransaction } from "@/test/builders";

const accountXtb: InvestmentAccount = { id: "account-xtb", brokerId: "xtb" };
const accountBt: InvestmentAccount = {
  id: "account-bt",
  brokerId: "banca_transilvania",
};

describe("investment aggregation", () => {
  it("calculates fractional weighted-average cost and a partial sell", () => {
    const position = calculateInvestmentPosition([
      aTransaction({ id: "01-buy", side: "buy" }),
      aTransaction({
        id: "02-buy",
        side: "buy",
        amount: "30",
        quantity: "0.25",
        unitPrice: "120",
        executedAt: "2026-01-02T10:00:00Z",
      }),
      aTransaction({
        id: "03-sell",
        side: "sell",
        amount: "70",
        quantity: "0.5",
        unitPrice: "140",
        executedAt: "2026-01-03T10:00:00Z",
      }),
    ]);

    expect(position.quantity).toBe("1.25");
    expect(position.remainingCost).toBe("128.5714285714");
    expect(position.averageCost).toBe("102.8571428571");
    expect(position.realizedGain).toBe("18.5714285714");
  });

  it("processes same-time orders by id for deterministic results", () => {
    const position = calculateInvestmentPosition([
      aTransaction({
        id: "a-buy",
        side: "buy",
        quantity: "1.5",
        amount: "150",
        executedAt: "2026-01-01T10:00:00Z",
      }),
      aTransaction({
        id: "z-sell",
        side: "sell",
        quantity: "0.5",
        amount: "70",
        executedAt: "2026-01-01T10:00:00Z",
      }),
    ]);

    expect(position.quantity).toBe("1");
    expect(position.remainingCost).toBe("100");
    expect(position.realizedGain).toBe("20");
  });

  it("supports a full sell and preserves realized gain with no remaining cost", () => {
    const position = calculateInvestmentPosition([
      aTransaction({ id: "01-buy", side: "buy" }),
      aTransaction({
        id: "02-sell",
        side: "sell",
        amount: "180",
        quantity: "1.5",
        unitPrice: "120",
        executedAt: "2026-01-02T10:00:00Z",
      }),
    ]);

    expect(position.quantity).toBe("0");
    expect(position.remainingCost).toBe("0");
    expect(position.averageCost).toBeNull();
    expect(position.realizedGain).toBe("30");
  });

  it("keeps instruments and totals separated by native currency", () => {
    const result = aggregateInvestments(
      [accountXtb, accountBt],
      [
        aTransaction({ id: "eur", side: "buy", amount: "100" }),
        aTransaction({
          id: "usd",
          side: "buy",
          instrument: "AAPL.US",
          currency: "USD",
          amount: "250",
          quantity: "0.5",
          unitPrice: "500",
        }),
        aTransaction({
          id: "ron",
          side: "buy",
          investmentAccountId: accountBt.id,
          instrument: "TLV.BX",
          currency: "RON",
          amount: "8750",
          quantity: "100",
          unitPrice: "87.5",
        }),
      ],
    );

    expect(result.issues).toEqual([]);
    expect(result.brokers).toHaveLength(2);
    expect(result.brokers[0].brokerId).toBe("xtb");
    expect(result.brokers[0].totalsByCurrency).toEqual([
      { currency: "EUR", remainingCost: "100", realizedGain: "0" },
      { currency: "USD", remainingCost: "250", realizedGain: "0" },
    ]);
    expect(result.brokers[1].brokerId).toBe("banca_transilvania");
    expect(result.brokers[1].totalsByCurrency).toEqual([
      { currency: "RON", remainingCost: "8750", realizedGain: "0" },
    ]);
  });

  it("reports an oversell as an affected-asset issue instead of a negative holding", () => {
    const result = aggregateInvestments(
      [accountXtb],
      [
        aTransaction({ id: "01-buy", side: "buy" }),
        aTransaction({
          id: "02-sell-too-much",
          side: "sell",
          amount: "200",
          quantity: "2",
          unitPrice: "100",
          executedAt: "2026-01-02T10:00:00Z",
        }),
      ],
    );

    expect(result.brokers).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: "oversell",
        accountId: accountXtb.id,
        instrument: "VWCE.DE",
        currency: "EUR",
        transactionId: "02-sell-too-much",
        message: "Sell quantity exceeds the available VWCE.DE position.",
      },
    ]);
  });

  it("rejects a sell when no units are available", () => {
    expect(() => calculateInvestmentPosition([
      aTransaction({
        id: "01-sell",
        side: "sell",
        amount: "100",
        quantity: "1",
      }),
    ])).toThrow("Sell quantity exceeds the available VWCE.DE position.");
  });
});
