import { beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));

import {
  createQuoteCache,
  FRESH_FOR_MS,
  MAX_CACHED_INSTRUMENTS,
  RETRY_AFTER_MS,
  ScrapingQuoteAdapter,
  STALE_LIMIT_MS,
} from "@/lib/investments/quotes/scraper";
import { YAHOO_CHART_URL } from "@/lib/investments/quotes/yahoo";
import { ZF_FUND_PAGES } from "@/lib/investments/quotes/zf";
import { loggedLines } from "@/test/log-lines";

function chart(price: number, currency = "EUR") {
  return { chart: { result: [{ meta: { currency, regularMarketPrice: price, regularMarketTime: 1789140966 } }], error: null } };
}

const ZF_HTML = `<div class="fond-mutual"><p><strong>13,5200 eur</strong></p><p style="font-size:11px">din data de 2026-09-09</p></div>`;

/** Lets a fetch started behind a cached answer finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let now: number;
let prices: Map<string, number>;
let fetcher: ReturnType<typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>>;

function adapter() {
  return new ScrapingQuoteAdapter({ fetcher, now: () => now, cache: createQuoteCache() });
}

beforeEach(() => {
  logged.length = 0;
  now = Date.UTC(2026, 10, 20, 9);
  prices = new Map([["VUAA.DE", 127.865]]);
  fetcher = vi.fn(async (input: string) => {
    if (input === ZF_FUND_PAGES.BTEUROCLASIC) return new Response(ZF_HTML, { status: 200 });
    const instrument = decodeURIComponent(new URL(input).pathname.split("/").pop() ?? "");
    const price = prices.get(instrument);
    return price === undefined
      ? Response.json({ chart: { result: null, error: { code: "Not Found" } } }, { status: 404 })
      : Response.json(chart(price));
  });
});

describe("ScrapingQuoteAdapter", () => {
  it("asks Yahoo once per valid instrument and ZF for its funds, with a time limit", async () => {
    const quotes = await adapter().getQuotes(["vuaa.de", " VUAA.DE ", "BTEUROCLASIC", "invalid symbol"]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith(`${YAHOO_CHART_URL}VUAA.DE?range=1d&interval=1d`, expect.objectContaining({
      cache: "no-store",
      headers: expect.objectContaining({ Accept: "application/json" }),
      signal: expect.any(AbortSignal),
    }));
    expect(fetcher).toHaveBeenCalledWith(ZF_FUND_PAGES.BTEUROCLASIC, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(quotes).toEqual(new Map([
      ["VUAA.DE", { instrument: "VUAA.DE", price: "127.865", currency: "EUR", asOf: "2026-09-11T15:36:06Z", source: "YAHOO_FINANCE" }],
      ["BTEUROCLASIC", { instrument: "BTEUROCLASIC", price: "13.5200", currency: "EUR", asOf: "2026-09-09", source: "ZF" }],
    ]));
  });

  it("logs each call to a source without the instrument", async () => {
    await adapter().getQuotes(["VUAA.DE", "MISSING.DE"]);

    const lines = loggedLines(logged, "quote_fetch");
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "yahoo", ok: true, status: 200 }),
      expect.objectContaining({ source: "yahoo", ok: false, status: 404 }),
    ]));
    expect(logged.join("\n")).not.toMatch(/VUAA|MISSING/);
  });

  it("answers from the cache for 3 hours, however many pages ask", async () => {
    const quotes = adapter();
    await quotes.getQuotes(["VUAA.DE"]);
    prices.set("VUAA.DE", 130);

    for (let page = 0; page < 50; page += 1) await quotes.getQuotes(["VUAA.DE"]);
    now += FRESH_FOR_MS - 1;
    const later = await quotes.getQuotes(["VUAA.DE"]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(later.get("VUAA.DE")?.price).toBe("127.865");
  });

  it("shares one call between pages that ask at the same time", async () => {
    const quotes = adapter();

    const answers = await Promise.all(Array.from({ length: 10 }, () => quotes.getQuotes(["VUAA.DE"])));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(answers.every((answer) => answer.get("VUAA.DE")?.price === "127.865")).toBe(true);
  });

  it("after 3 hours shows the cached price at once and fetches a newer one behind it", async () => {
    const quotes = adapter();
    await quotes.getQuotes(["VUAA.DE"]);
    prices.set("VUAA.DE", 130);
    now += FRESH_FOR_MS;

    const stale = await quotes.getQuotes(["VUAA.DE"]);
    await settle();
    const fresh = await quotes.getQuotes(["VUAA.DE"]);

    expect(stale.get("VUAA.DE")?.price).toBe("127.865");
    expect(fresh.get("VUAA.DE")?.price).toBe("130");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("asks again about an instrument with no price only after 30 minutes", async () => {
    const quotes = adapter();
    expect((await quotes.getQuotes(["MISSING.DE"])).size).toBe(0);

    now += RETRY_AFTER_MS - 1;
    expect((await quotes.getQuotes(["MISSING.DE"])).size).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);

    prices.set("MISSING.DE", 5);
    now += 1;
    expect((await quotes.getQuotes(["MISSING.DE"])).get("MISSING.DE")?.price).toBe("5");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps showing the last price while the source fails, for up to a day", async () => {
    const quotes = adapter();
    await quotes.getQuotes(["VUAA.DE"]);
    fetcher.mockRejectedValue(new TypeError("fetch failed"));

    now += FRESH_FOR_MS;
    expect((await quotes.getQuotes(["VUAA.DE"])).get("VUAA.DE")?.price).toBe("127.865");
    await settle();
    // The failure isn't retried before its own wait is over.
    now += RETRY_AFTER_MS - 1;
    expect((await quotes.getQuotes(["VUAA.DE"])).get("VUAA.DE")?.price).toBe("127.865");
    expect(fetcher).toHaveBeenCalledTimes(2);

    now = now - FRESH_FOR_MS - (RETRY_AFTER_MS - 1) + STALE_LIMIT_MS;
    expect((await quotes.getQuotes(["VUAA.DE"])).size).toBe(0);
  });

  it("gives no quote when the source times out, fails or answers something else", async () => {
    fetcher.mockImplementation(async (input: string) => {
      // What fetch rejects with when the time limit's signal fires.
      if (input.includes("SLOW")) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      if (input.includes("HTML")) return new Response("<html>", { status: 200 });
      if (input.includes("BUSY")) return new Response("Too Many Requests", { status: 429 });
      throw new TypeError("fetch failed");
    });

    expect((await adapter().getQuotes(["SLOW.DE", "HTML.DE", "BUSY.DE", "DOWN.DE"])).size).toBe(0);
  });

  it(`keeps at most ${MAX_CACHED_INSTRUMENTS} instruments, dropping the least recently fetched`, async () => {
    const quotes = adapter();
    const many = Array.from({ length: MAX_CACHED_INSTRUMENTS + 1 }, (_, index) => `S${index}`);
    for (const instrument of many) prices.set(instrument, 1);

    await quotes.getQuotes(["S0"]);
    await quotes.getQuotes(many.slice(1));
    await quotes.getQuotes(many.slice(1));
    expect(fetcher).toHaveBeenCalledTimes(many.length);

    await quotes.getQuotes(["S0"]);
    expect(fetcher).toHaveBeenCalledTimes(many.length + 1);
  });
});
