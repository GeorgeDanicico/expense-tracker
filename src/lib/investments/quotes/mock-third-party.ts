import "server-only";

import { MOCK_QUOTE_RECORDS } from "@/lib/investments/quotes/mock-data";
import type { Quote, ThirdPartyQuoteAdapter } from "@/lib/investments/quotes/types";

export class MockThirdPartyQuoteAdapter implements ThirdPartyQuoteAdapter {
  constructor(
    private readonly records: Readonly<Record<string, Quote>> = MOCK_QUOTE_RECORDS,
  ) {}

  async getQuotes(instruments: string[]) {
    const requested = new Set(instruments.map((instrument) => instrument.trim().toUpperCase()));
    const quotes = new Map<string, Quote>();

    for (const instrument of requested) {
      const quote = this.records[instrument];
      if (quote) quotes.set(instrument, quote);
    }

    return quotes;
  }
}
