import { describe, expect, it } from "vitest";

import { parseYahooChart } from "@/lib/investments/quotes/yahoo";

// The samples are the price service's own (investments-scraper, YahooPriceParserTest).
describe("parseYahooChart", () => {
  it("prefers the regular market price and time", () => {
    const payload = {
      chart: {
        result: [{
          meta: { currency: "EUR", regularMarketPrice: 127.865, regularMarketTime: 1789140966 },
          indicators: { quote: [{ close: [127.8] }] },
        }],
        error: null,
      },
    };

    expect(parseYahooChart("VUAA.DE", payload)).toEqual({
      instrument: "VUAA.DE",
      price: "127.865",
      currency: "EUR",
      asOf: "2026-09-11T15:36:06Z",
      source: "YAHOO_FINANCE",
    });
  });

  it("falls back to the last close and the last timestamp", () => {
    const payload = {
      chart: {
        result: [{
          meta: { currency: "EUR" },
          timestamp: [1789110000, 1789140966],
          indicators: { quote: [{ close: [126.54, 127.865, null] }] },
        }],
        error: null,
      },
    };

    expect(parseYahooChart("VWCE.DE", payload)).toMatchObject({ price: "127.865", asOf: "2026-09-11T15:36:06Z" });
  });

  it.each([
    ["an error", { chart: { result: null, error: { code: "Not Found", description: "No data found" } } }],
    ["no result", { chart: { result: [], error: null } }],
    ["no price", { chart: { result: [{ meta: { currency: "EUR", regularMarketTime: 1789140966 } }], error: null } }],
    ["no time", { chart: { result: [{ meta: { currency: "EUR", regularMarketPrice: 1 } }], error: null } }],
    ["a currency in pence", { chart: { result: [{ meta: { currency: "GBp", regularMarketPrice: 1, regularMarketTime: 1789140966 } }], error: null } }],
    ["no chart", "<html>"],
  ])("gives no quote for %s", (_, payload) => {
    expect(parseYahooChart("X", payload)).toBeNull();
  });
});
