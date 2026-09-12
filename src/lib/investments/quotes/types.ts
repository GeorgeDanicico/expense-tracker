import type { InvestmentCurrency } from "@/lib/investments/types";

export type Quote = {
  instrument: string;
  price: string;
  currency: InvestmentCurrency;
  asOf: string;
  displayName?: string;
  source: "mock";
};

export interface ThirdPartyQuoteAdapter {
  getQuotes(instruments: string[]): Promise<Map<string, Quote>>;
}
