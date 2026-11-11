"use client";

import useSWR, { useSWRConfig } from "swr";

import type { AccountData } from "@/lib/account/types";
import { DEDUPING_INTERVAL_MS } from "@/lib/api/client";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import { DEFAULT_CURRENCY } from "@/lib/utils/currency";

/**
 * Whether the only account there is came from the server with this page, moments ago: SWR's cache
 * has none of its own (so `useSWR` would show the `(app)` layout's fallback) and the page loaded less
 * than SWR's dedupe window ago, the time a fetched answer counts as fresh. Asking `/api/account` again
 * then would only repeat what the server just read (PF5).
 */
function onlyFreshServerAccount(cachedAccount: unknown) {
  return cachedAccount === undefined && performance.now() < DEDUPING_INTERVAL_MS;
}

/**
 * The signed-in account, shared through the `/api/account` SWR cache entry. Inside the `(app)`
 * layout it is there on the first render (the server's copy, as SWR's fallback); on the pages outside
 * it (sign-in, change password, join) it loads in the browser.
 * `currency` falls back to `DEFAULT_CURRENCY` until the account loads.
 *
 * Fields are getters so SWR only re-renders a component for the state it
 * actually reads (SWR tracks which of `data`/`error`/`isLoading` are accessed).
 */
export function useAccount() {
  const { cache } = useSWRConfig();
  const response = useSWR<AccountData>(ACCOUNT_API_KEY, {
    // With the server's copy only and fresh, a hook mounting doesn't revalidate. Once SWR has an
    // answer of its own, or after the window, it revalidates on mount as every other key does.
    revalidateIfStale: !onlyFreshServerAccount(cache.get(ACCOUNT_API_KEY)?.data),
  });
  return {
    get account() {
      return response.data;
    },
    get currency() {
      return response.data?.currency ?? DEFAULT_CURRENCY;
    },
    get error() {
      return response.error;
    },
    get isLoading() {
      return response.isLoading;
    },
    mutate: response.mutate,
  };
}
