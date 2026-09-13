import { describe, expect, it, vi } from "vitest";

import { PriceApiQuoteAdapter } from "@/lib/investments/quotes/price-api";

describe("PriceApiQuoteAdapter", () => {
  it("requests each valid instrument through the OpenAPI endpoint and maps the response", async () => {
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      expect(init).toMatchObject({
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      return new Response(JSON.stringify({
        instrument: "VUAA.DE",
        source: "YAHOO_FINANCE",
        price: 127.865,
        currency: "EUR",
        asOf: "2026-09-11T15:36:06Z",
      }), {
        status: input.endsWith("VUAA.DE") ? 200 : 404,
        headers: { "Content-Type": "application/json" },
      });
    });
    const adapter = new PriceApiQuoteAdapter({
      serviceUrl: "https://prices.example.test/",
      fetcher,
    });

    const quotes = await adapter.getQuotes(["vuaa.de", "VUAA.DE", "invalid symbol"]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://prices.example.test/api/v1/price/VUAA.DE",
      expect.any(Object),
    );
    expect(quotes.get("VUAA.DE")).toEqual({
      instrument: "VUAA.DE",
      price: "127.865",
      currency: "EUR",
      asOf: "2026-09-11T15:36:06Z",
      source: "YAHOO_FINANCE",
    });
  });

  it("preserves the ZF source and omits non-success or malformed responses", async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.endsWith("BTEUROCLASIC")) {
        return new Response(JSON.stringify({
          instrument: "BTEUROCLASIC",
          source: "ZF",
          price: 18.2,
          currency: "RON",
          asOf: "2026-09-11",
        }), { status: 200 });
      }

      if (input.endsWith("MISSING.DE")) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });

      return new Response(JSON.stringify({
        instrument: "BROKEN.DE",
        source: "YAHOO_FINANCE",
        price: "not-a-number",
        currency: "EUR",
        asOf: "2026-09-11",
      }), { status: 200 });
    });
    const adapter = new PriceApiQuoteAdapter({ serviceUrl: "http://localhost:8080", fetcher });

    const quotes = await adapter.getQuotes(["BTEUROCLASIC", "MISSING.DE", "BROKEN.DE"]);

    expect(quotes).toEqual(new Map([[
      "BTEUROCLASIC",
      {
        instrument: "BTEUROCLASIC",
        price: "18.2",
        currency: "RON",
        asOf: "2026-09-11",
        source: "ZF",
      },
    ]]));
  });

  it("requires an absolute HTTP(S) service URL", () => {
    expect(() => new PriceApiQuoteAdapter({ serviceUrl: "prices.example.test" })).toThrow(
      "PRICE_SERVICE_URL must be a valid absolute URL.",
    );
  });
});
