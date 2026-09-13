import type { InvestmentCurrency } from "@/lib/investments/types";

export const PRICE_SOURCES = ["YAHOO_FINANCE", "ZF"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export type Quote = {
  instrument: string;
  price: string;
  currency: InvestmentCurrency;
  asOf: string;
  displayName?: string;
  source: PriceSource;
};

export interface ThirdPartyQuoteAdapter {
  getQuotes(instruments: string[]): Promise<Map<string, Quote>>;
}
