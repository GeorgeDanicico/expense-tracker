import "server-only";

import { isInvestmentCurrency } from "@/lib/investments/types";
import { PRICE_SOURCES, type PriceSource, type Quote, type ThirdPartyQuoteAdapter } from "@/lib/investments/quotes/types";

const PRICE_SERVICE_URL_ENV = "PRICE_SERVICE_URL";
const INSTRUMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;
const PRICE_PATH = "/api/v1/price/";

type PriceResponse = {
  instrument: unknown;
  source: unknown;
  price: unknown;
  currency: unknown;
  asOf: unknown;
};

type PriceApiFetcher = (input: string, init?: RequestInit) => Promise<Response>;

function normalizeInstrument(instrument: string) {
  return instrument.trim().toUpperCase();
}

function isPriceSource(value: unknown): value is PriceSource {
  return typeof value === "string" && PRICE_SOURCES.includes(value as PriceSource);
}

function parsePriceResponse(payload: unknown, requestedInstrument: string): Quote | null {
  if (!payload || typeof payload !== "object") return null;

  const response = payload as PriceResponse;
  if (
    typeof response.instrument !== "string"
    || response.instrument !== requestedInstrument
    || typeof response.price !== "number"
    || !Number.isFinite(response.price)
    || typeof response.currency !== "string"
    || !isInvestmentCurrency(response.currency)
    || !isPriceSource(response.source)
    || typeof response.asOf !== "string"
    || !response.asOf
  ) {
    return null;
  }

  return {
    instrument: response.instrument,
    price: String(response.price),
    currency: response.currency,
    asOf: response.asOf,
    source: response.source,
  };
}

function normalizeServiceUrl(serviceUrl: string | undefined) {
  if (!serviceUrl?.trim()) {
    throw new Error(`Missing ${PRICE_SERVICE_URL_ENV} environment variable.`);
  }

  const trimmedServiceUrl = serviceUrl.trim();
  let url: URL;
  try {
    url = new URL(trimmedServiceUrl);
  } catch {
    throw new Error(`${PRICE_SERVICE_URL_ENV} must be a valid absolute URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${PRICE_SERVICE_URL_ENV} must use http or https.`);
  }
  if (url.search || url.hash) {
    throw new Error(`${PRICE_SERVICE_URL_ENV} must not include a query string or fragment.`);
  }

  return trimmedServiceUrl.replace(/\/+$/, "");
}

export class PriceApiQuoteAdapter implements ThirdPartyQuoteAdapter {
  private readonly serviceUrl: string;
  private readonly fetcher: PriceApiFetcher;

  constructor(options: { serviceUrl?: string; fetcher?: PriceApiFetcher } = {}) {
    this.serviceUrl = normalizeServiceUrl(options.serviceUrl ?? process.env.PRICE_SERVICE_URL);
    this.fetcher = options.fetcher ?? fetch;
  }

  async getQuotes(instruments: string[]) {
    const requested = [...new Set(instruments.map(normalizeInstrument))]
      .filter((instrument) => INSTRUMENT_PATTERN.test(instrument));

    const results = await Promise.all(
      requested.map(async (instrument) => {
        try {
          const response = await this.fetcher(
            `${this.serviceUrl}${PRICE_PATH}${encodeURIComponent(instrument)}`,
            {
              headers: { Accept: "application/json" },
              cache: "no-store",
            },
          );
          if (!response.ok) return null;

          const payload = await response.json();
          const quote = parsePriceResponse(payload, instrument);
          return quote ? ([instrument, quote] as const) : null;
        } catch {
          return null;
        }
      }),
    );

    return new Map(
      results.filter((result): result is readonly [string, Quote] => result !== null),
    );
  }
}
