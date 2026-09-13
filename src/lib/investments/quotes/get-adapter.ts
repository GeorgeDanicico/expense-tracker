import "server-only";

import { PriceApiQuoteAdapter } from "@/lib/investments/quotes/price-api";
import type { ThirdPartyQuoteAdapter } from "@/lib/investments/quotes/types";

let quoteAdapter: ThirdPartyQuoteAdapter | undefined;

export function getInvestmentQuoteAdapter(): ThirdPartyQuoteAdapter {
  quoteAdapter ??= new PriceApiQuoteAdapter();
  return quoteAdapter;
}
