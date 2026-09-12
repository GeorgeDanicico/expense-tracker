import { describe, expect, it } from "vitest";

import { MockThirdPartyQuoteAdapter } from "@/lib/investments/quotes/mock-third-party";
import type { Quote } from "@/lib/investments/quotes/types";

describe("MockThirdPartyQuoteAdapter", () => {
  it("deduplicates requested instruments and omits unknown quotes", async () => {
    const adapter = new MockThirdPartyQuoteAdapter({
      "VWCE.DE": {
        instrument: "VWCE.DE",
        price: "129.42",
        currency: "EUR",
        asOf: "2026-09-12T12:00:00Z",
        source: "mock",
      },
    });

    const quotes = await adapter.getQuotes(["VWCE.DE", "VWCE.DE", "MISSING.DE"]);

    expect([...quotes.keys()]).toEqual(["VWCE.DE"]);
    expect(quotes.get("VWCE.DE")?.source).toBe("mock");
  });

  it("returns only the requested quote records", async () => {
    const records: Record<string, Quote> = {
      "VWCE.DE": {
        instrument: "VWCE.DE",
        price: "129.42",
        currency: "EUR",
        asOf: "2026-09-12T12:00:00Z",
        source: "mock",
      },
      "AAPL.US": {
        instrument: "AAPL.US",
        price: "238.99",
        currency: "USD",
        asOf: "2026-09-12T12:00:00Z",
        source: "mock",
      },
    };
    const adapter = new MockThirdPartyQuoteAdapter(records);

    const quotes = await adapter.getQuotes(["AAPL.US"]);

    expect([...quotes.keys()]).toEqual(["AAPL.US"]);
  });
});
