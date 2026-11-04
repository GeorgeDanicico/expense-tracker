"use client";

import { createContext, useContext, type ReactNode } from "react";

import { apiRequest } from "@/lib/api/client";
import type { InvestmentTransactionMutationResponse } from "@/lib/investments/types";

/** One order as the form checked it: the server validates the amounts and the units against the position. */
export type InvestmentOrderInput = {
  brokerId: string;
  instrument: string;
  currency: string;
  side: string;
  amount: string;
  quantity: string;
  unitPrice: string;
  /** An instant (ISO 8601). */
  executedAt: string;
};

/**
 * Every investment write (audit D6). The app uses the REST API; `/dev/preview` swaps in an in-memory
 * one. `useInvestmentWrites` calls these. Orders are never optimistic: the server checks a sell against
 * the units held at its time, so the answer (or its error) is shown instead of a guess.
 */
export type InvestmentApi = {
  createOrder(input: InvestmentOrderInput): Promise<void>;
  removeOrder(id: string): Promise<void>;
};

export const restInvestmentApi: InvestmentApi = {
  async createOrder(input) {
    await apiRequest<InvestmentTransactionMutationResponse>("/api/investment-transactions", { method: "POST", body: JSON.stringify(input) });
  },
  async removeOrder(id) {
    await apiRequest<Record<string, never>>(`/api/investment-transactions/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

const InvestmentApiContext = createContext<InvestmentApi>(restInvestmentApi);

export function InvestmentApiProvider({ api, children }: { api: InvestmentApi; children: ReactNode }) {
  return <InvestmentApiContext.Provider value={api}>{children}</InvestmentApiContext.Provider>;
}

export function useInvestmentApi() {
  return useContext(InvestmentApiContext);
}
