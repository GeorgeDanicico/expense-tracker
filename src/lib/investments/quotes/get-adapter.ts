import "server-only";

import { getEnv } from "@/lib/env";
import { ScrapingQuoteAdapter } from "@/lib/investments/quotes/scraper";
import type { ThirdPartyQuoteAdapter } from "@/lib/investments/quotes/types";

/** No prices at all, for INVESTMENT_PRICES_DISABLED (the lab, so its measurements never call out). */
const noQuotes: ThirdPartyQuoteAdapter = { getQuotes: async () => new Map() };

let quoteAdapter: ThirdPartyQuoteAdapter | undefined;

export function getInvestmentQuoteAdapter(): ThirdPartyQuoteAdapter {
  quoteAdapter ??= getEnv().INVESTMENT_PRICES_DISABLED ? noQuotes : new ScrapingQuoteAdapter();
  return quoteAdapter;
}
