"use client";

import { useMemo } from "react";
import { useSWRConfig, type ScopedMutator } from "swr";

import { useInvestmentApi, type InvestmentApi, type InvestmentOrderInput } from "@/components/investments/investment-api";
import { INVESTMENTS_API_KEY, NET_WORTH_API_KEY } from "@/lib/api/keys";

const isOrderList = (key: unknown) => typeof key === "string" && key.startsWith("/api/investment-transactions?");

/**
 * After an order is saved or removed: the overview, net worth (which values the holding) and every
 * cached order list (the family view's too) are read again.
 */
export function refreshInvestmentViews(mutate: ScopedMutator) {
  return Promise.allSettled([mutate(INVESTMENTS_API_KEY), mutate(NET_WORTH_API_KEY), mutate(isOrderList)]);
}

/**
 * The order writes with their refreshes (audit D6). Not optimistic: each waits for the server, which
 * can refuse an order for a reason the user must see (a sell of units not held), and throws that error
 * for the form (`useApiForm`) to show while it shows its pending state. The views refresh only after
 * a success.
 */
export function investmentWrites(api: InvestmentApi, mutate: ScopedMutator) {
  return {
    async createOrder(input: InvestmentOrderInput) {
      await api.createOrder(input);
      await refreshInvestmentViews(mutate);
    },
    async removeOrder(id: string) {
      await api.removeOrder(id);
      await refreshInvestmentViews(mutate);
    },
  };
}

export function useInvestmentWrites() {
  const api = useInvestmentApi();
  const { mutate } = useSWRConfig();
  return useMemo(() => investmentWrites(api, mutate), [api, mutate]);
}
