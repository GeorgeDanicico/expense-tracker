import "server-only";

import { MockThirdPartyQuoteAdapter } from "@/lib/investments/quotes/mock-third-party";
import type { ThirdPartyQuoteAdapter } from "@/lib/investments/quotes/types";

const quoteAdapter = new MockThirdPartyQuoteAdapter();

export function getInvestmentQuoteAdapter(): ThirdPartyQuoteAdapter {
  return quoteAdapter;
}
