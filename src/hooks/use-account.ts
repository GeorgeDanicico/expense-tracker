"use client";

import useSWR from "swr";

import type { AccountData } from "@/lib/account/types";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import { DEFAULT_CURRENCY } from "@/lib/utils/currency";

/**
 * The signed-in account, shared through the `/api/account` SWR cache entry.
 * `currency` falls back to `DEFAULT_CURRENCY` until the account loads.
 *
 * Fields are getters so SWR only re-renders a component for the state it
 * actually reads (SWR tracks which of `data`/`error`/`isLoading` are accessed).
 */
export function useAccount() {
  const response = useSWR<AccountData>(ACCOUNT_API_KEY);
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
