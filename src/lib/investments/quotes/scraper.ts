import "server-only";

import { log } from "@/lib/log";
import type { Quote, ThirdPartyQuoteAdapter } from "@/lib/investments/quotes/types";
import { parseYahooChart, YAHOO_CHART_URL } from "@/lib/investments/quotes/yahoo";
import { parseZfPage, ZF_FUND_PAGES } from "@/lib/investments/quotes/zf";

/**
 * Reads investment prices straight from their sources: Yahoo Finance for stocks and ETFs, zf.ro
 * for the funds in {@link ZF_FUND_PAGES}. It replaces the separate price service
 * (investments-scraper) and keeps its answers: the same instruments, prices, currencies, dates and
 * `source` values.
 *
 * The sources are asked rarely, whatever the traffic. Each instrument is fetched at most once per
 * {@link FRESH_FOR_MS} while it answers, and once per {@link RETRY_AFTER_MS} while it doesn't; pages
 * that ask at the same time share one call; and once a price is known, a page gets it straight from
 * the cache while a newer one is fetched behind it. The cache is one per process.
 */

/** How long a price is used before it's fetched again: 3 hours, as the old service's cache. */
export const FRESH_FOR_MS = 3 * 60 * 60 * 1000;
/** How long after a failed fetch (no answer, an error, or no price on the page) the source is asked again. */
export const RETRY_AFTER_MS = 30 * 60 * 1000;
/** The oldest price shown while its source keeps failing; after that the instrument has no price. */
export const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;
/** The most instruments kept; the least recently fetched goes first. */
export const MAX_CACHED_INSTRUMENTS = 256;
/** How long one call to a source may take, body included. */
export const SOURCE_TIMEOUT_MS = 5_000;

/** The User-Agent the price service sent, which both sources accept. */
const USER_AGENT = "investment-price-service/1.0";
const INSTRUMENT_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type Entry = {
  /** The last price fetched, or `null` when there's none to show. */
  quote: Quote | null;
  /** When `quote` was fetched. */
  fetchedAt: number;
  /** Before this, the source isn't asked again. */
  nextFetchAt: number;
};

export type QuoteCache = {
  entries: Map<string, Entry>;
  /** The fetch under way for an instrument, which every caller in the meantime waits on. */
  inFlight: Map<string, Promise<Quote | null>>;
};

export function createQuoteCache(): QuoteCache {
  return { entries: new Map(), inFlight: new Map() };
}

// One cache per process, even if a bundler loads this module more than once (see traced-fetch.ts).
const CACHE_KEY = Symbol.for("expense-tracker.investment-quotes");
const globalCache = globalThis as typeof globalThis & { [CACHE_KEY]?: QuoteCache };

/** The global `fetch`, looked up at call time so a stub in a test still applies. */
const globalFetch: Fetcher = (input, init) => fetch(input, init);

function normalizeInstrument(instrument: string) {
  return instrument.trim().toUpperCase();
}

export class ScrapingQuoteAdapter implements ThirdPartyQuoteAdapter {
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly cache: QuoteCache;

  constructor(options: { fetcher?: Fetcher; now?: () => number; cache?: QuoteCache } = {}) {
    this.fetcher = options.fetcher ?? globalFetch;
    this.now = options.now ?? Date.now;
    this.cache = options.cache ?? (globalCache[CACHE_KEY] ??= createQuoteCache());
  }

  async getQuotes(instruments: string[]) {
    const requested = [...new Set(instruments.map(normalizeInstrument))]
      .filter((instrument) => INSTRUMENT_PATTERN.test(instrument));
    const quotes = await Promise.all(requested.map((instrument) => this.quote(instrument)));
    return new Map(
      quotes.flatMap((quote, index) => (quote ? [[requested[index], quote] as const] : [])),
    );
  }

  /** The cached price while it's fresh; else the last one, if any, with a fetch behind it; else the fetch. */
  private quote(instrument: string): Promise<Quote | null> {
    const now = this.now();
    const entry = this.cache.entries.get(instrument);
    if (entry && now < entry.nextFetchAt) return Promise.resolve(entry.quote);

    const refresh = this.refresh(instrument);
    const shown = this.usable(entry, now);
    return shown ? Promise.resolve(shown) : refresh;
  }

  /** `entry`'s price when it isn't older than {@link STALE_LIMIT_MS}. */
  private usable(entry: Entry | undefined, now: number): Quote | null {
    return entry?.quote && now - entry.fetchedAt < STALE_LIMIT_MS ? entry.quote : null;
  }

  /** One fetch per instrument at a time; its result goes into the cache. Never rejects. */
  private refresh(instrument: string): Promise<Quote | null> {
    const pending = this.cache.inFlight.get(instrument);
    if (pending) return pending;

    const promise = this.fetchQuote(instrument)
      .catch(() => null)
      .then((quote) => {
        const now = this.now();
        if (quote) {
          this.store(instrument, { quote, fetchedAt: now, nextFetchAt: now + FRESH_FOR_MS });
          return quote;
        }
        // Keep showing the last price for a while, and don't ask again before the retry time.
        const previous = this.cache.entries.get(instrument);
        const kept = this.usable(previous, now);
        this.store(instrument, { quote: kept, fetchedAt: kept && previous ? previous.fetchedAt : now, nextFetchAt: now + RETRY_AFTER_MS });
        return kept;
      })
      .finally(() => this.cache.inFlight.delete(instrument));
    this.cache.inFlight.set(instrument, promise);
    return promise;
  }

  private store(instrument: string, entry: Entry) {
    const { entries } = this.cache;
    entries.delete(instrument);
    entries.set(instrument, entry);
    for (const oldest of entries.keys()) {
      if (entries.size <= MAX_CACHED_INSTRUMENTS) break;
      entries.delete(oldest);
    }
  }

  /** One call to the instrument's source. `null` when it doesn't answer in time, fails, or has no usable price. */
  private async fetchQuote(instrument: string): Promise<Quote | null> {
    const zfPage = Object.hasOwn(ZF_FUND_PAGES, instrument) ? ZF_FUND_PAGES[instrument] : undefined;
    const source = zfPage ? "zf" : "yahoo";
    const url = zfPage ?? `${YAHOO_CHART_URL}${encodeURIComponent(instrument)}?range=1d&interval=1d`;
    const startedAt = performance.now();
    let status: number | undefined;
    let quote: Quote | null = null;
    try {
      const response = await this.fetcher(url, {
        headers: { Accept: zfPage ? "text/html" : "application/json", "User-Agent": USER_AGENT },
        cache: "no-store",
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      });
      status = response.status;
      if (response.ok) {
        quote = zfPage ? parseZfPage(instrument, await response.text()) : parseYahooChart(instrument, await response.json());
      }
    } catch {
      // No answer in time, a network error or a body that isn't JSON: no price this time.
    }
    // The instrument isn't logged: together with the request it says what someone holds.
    log.info("quote_fetch", { source, ok: quote !== null, status, ms: Math.round(performance.now() - startedAt) });
    return quote;
  }
}
