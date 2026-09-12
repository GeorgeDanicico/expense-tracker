import "server-only";

import type { Quote } from "@/lib/investments/quotes/types";

export const MOCK_QUOTE_RECORDS: Readonly<Record<string, Quote>> = {
  "VWCE.DE": {
    instrument: "VWCE.DE",
    price: "129.42",
    currency: "EUR",
    asOf: "2026-09-12T12:00:00Z",
    displayName: "Vanguard FTSE All-World UCITS ETF",
    source: "mock",
  },
  "AAPL.US": {
    instrument: "AAPL.US",
    price: "238.99",
    currency: "USD",
    asOf: "2026-09-12T12:00:00Z",
    displayName: "Apple Inc.",
    source: "mock",
  },
  "TLV.BX": {
    instrument: "TLV.BX",
    price: "32.88",
    currency: "RON",
    asOf: "2026-09-12T12:00:00Z",
    displayName: "Banca Transilvania S.A.",
    source: "mock",
  },
};
