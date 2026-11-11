"use client";

import { useMemo } from "react";
import { useSWRConfig, type ScopedMutator } from "swr";

import { useNetWorthApi, type NetWorthApi, type NetWorthItemInput, type NetWorthItemPatch, type NetWorthValuationInput } from "@/components/net-worth/net-worth-api";
import { withValuation } from "@/components/net-worth/net-worth-cache";
import { NET_WORTH_API_KEY } from "@/lib/api/keys";
import type { NetWorthOverview } from "@/lib/net-worth/types";

const isNetWorthView = (key: unknown) => typeof key === "string" && (key === NET_WORTH_API_KEY || key.startsWith(`${NET_WORTH_API_KEY}?`));

/** Every cached balance sheet (yours, a member's, the family's) is read again: the server works out the totals. */
export const refreshNetWorthViews = (mutate: ScopedMutator) => mutate(isNetWorthView);

/**
 * A new value shows in your own balance sheet at once, then is sent. SWR does the bookkeeping: its
 * `optimisticData` is what the sheet shows while `write` runs (worked out from whatever the cache
 * holds, so a sheet the server seeded counts), and `rollbackOnError` puts back what the cache held
 * and rethrows when the write fails (a 4xx or a 5xx alike), for the form to show [S11]. On success
 * the views refetch (the totals and the change figure are the server's), so the write's own result
 * isn't put in the cache (`populateCache: false`).
 */
export async function addValuationOptimistically({
  mutate,
  write,
  itemId,
  input,
}: {
  mutate: ScopedMutator;
  write: () => Promise<void>;
  itemId: string;
  input: NetWorthValuationInput;
}) {
  await mutate<NetWorthOverview | undefined>(NET_WORTH_API_KEY, write().then(() => undefined), {
    optimisticData: (current) => withValuation(current, itemId, input.value, input.valuedOn),
    rollbackOnError: true,
    populateCache: false,
    revalidate: false,
  });
  await refreshNetWorthViews(mutate);
}

/**
 * The net-worth writes with their cache updates (audit D6): a dated value is optimistic, a new item
 * and an item's details or archiving wait for the server.
 */
export function netWorthWrites(api: NetWorthApi, mutate: ScopedMutator) {
  return {
    async createItem(input: NetWorthItemInput) {
      await api.createItem(input);
      await refreshNetWorthViews(mutate);
    },
    async updateItem(id: string, patch: NetWorthItemPatch) {
      await api.updateItem(id, patch);
      await refreshNetWorthViews(mutate);
    },
    addValuation(itemId: string, input: NetWorthValuationInput) {
      return addValuationOptimistically({ mutate, write: () => api.addValuation(itemId, input), itemId, input });
    },
  };
}

export function useNetWorthWrites() {
  const api = useNetWorthApi();
  const { mutate } = useSWRConfig();
  return useMemo(() => netWorthWrites(api, mutate), [api, mutate]);
}
