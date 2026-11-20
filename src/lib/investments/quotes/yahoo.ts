import { isInvestmentCurrency } from "@/lib/investments/types";
import type { Quote } from "@/lib/investments/quotes/types";

/** Yahoo Finance's chart endpoint; the instrument goes after the last `/`. */
export const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

type Json = Record<string, unknown>;

function object(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
}

function firstOf(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The last finite number in `value`, when it's an array. */
function lastNumber(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const number = finiteNumber(value[index]);
    if (number !== undefined) return number;
  }
  return undefined;
}

/** Unix seconds as an ISO instant without milliseconds (`2026-09-11T15:36:06Z`). */
function instant(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * The quote in a Yahoo chart response, or `null` when it has none the app can use.
 *
 * The price is `meta.regularMarketPrice`, else the last close; the time is
 * `meta.regularMarketTime`, else the last timestamp. A currency that isn't an upper-case ISO code
 * (Yahoo's `GBp` for pence, say) gives `null`, as the old price service's answer did.
 */
export function parseYahooChart(instrument: string, payload: unknown): Quote | null {
  const chart = object(object(payload)?.chart);
  if (!chart) return null;
  if (chart.error !== undefined && chart.error !== null) return null;

  const result = object(firstOf(chart.result));
  if (!result) return null;
  const meta = object(result.meta) ?? {};
  const closes = object(firstOf(object(result.indicators)?.quote))?.close;

  const price = finiteNumber(meta.regularMarketPrice) ?? lastNumber(closes);
  const asOf = instant(finiteNumber(meta.regularMarketTime)) ?? instant(lastNumber(result.timestamp));
  const currency = meta.currency;
  if (price === undefined || asOf === undefined || typeof currency !== "string" || !isInvestmentCurrency(currency)) {
    return null;
  }

  return { instrument, price: String(price), currency, asOf, source: "YAHOO_FINANCE" };
}
