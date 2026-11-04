"use client";

import { useMemo } from "react";
import { useSWRConfig, type ScopedMutator } from "swr";

import { useNetWorthApi, type NetWorthApi, type NetWorthItemInput, type NetWorthItemPatch, type NetWorthValuationInput } from "@/components/net-worth/net-worth-api";
import { withValuation } from "@/components/net-worth/net-worth-cache";
import { NET_WORTH_API_KEY } from "@/lib/api/keys";
import type { NetWorthOverview } from "@/lib/net-worth/types";

type Swr = { mutate: ScopedMutator; cache: { get(key: string): { data?: unknown } | undefined } };

const isNetWorthView = (key: unknown) => typeof key === "string" && (key === NET_WORTH_API_KEY || key.startsWith(`${NET_WORTH_API_KEY}?`));

/** Every cached balance sheet (yours, a member's, the family's) is read again: the server works out the totals. */
export const refreshNetWorthViews = (mutate: ScopedMutator) => mutate(isNetWorthView);

/**
 * A new value shows in your own balance sheet at once, then is sent. On success the views refetch
 * (the totals and the change figure are the server's); on failure your sheet goes back to what it
 * held and the error is thrown for the form to show.
 */
export async function addValuationOptimistically({
  mutate,
  cache,
  write,
  itemId,
  input,
}: Swr & {
  write: () => Promise<void>;
  itemId: string;
  input: NetWorthValuationInput;
}) {
  const before = cache.get(NET_WORTH_API_KEY)?.data as NetWorthOverview | undefined;
  const shown = withValuation(before, itemId, input.value, input.valuedOn);
  if (shown !== before) await mutate(NET_WORTH_API_KEY, shown, { revalidate: false });
  try {
    await write();
  } catch (caught) {
    if (shown !== before) await mutate(NET_WORTH_API_KEY, before, { revalidate: false });
    throw caught;
  }
  await refreshNetWorthViews(mutate);
}

/**
 * The net-worth writes with their cache updates (audit D6): a dated value is optimistic, a new item
 * and an item's details or archiving wait for the server.
 */
export function netWorthWrites(api: NetWorthApi, { mutate, cache }: Swr) {
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
      return addValuationOptimistically({ mutate, cache, write: () => api.addValuation(itemId, input), itemId, input });
    },
  };
}

export function useNetWorthWrites() {
  const api = useNetWorthApi();
  const { mutate, cache } = useSWRConfig();
  return useMemo(() => netWorthWrites(api, { mutate, cache }), [api, cache, mutate]);
}
