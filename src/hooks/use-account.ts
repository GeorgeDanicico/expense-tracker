"use client";

import useSWR from "swr";

import type { AccountData } from "@/lib/account/types";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import { STABLE_DATA } from "@/lib/api/stable-data";
import { DEFAULT_CURRENCY } from "@/lib/utils/currency";

/**
 * The signed-in account, shared through the `/api/account` SWR cache entry. Inside the `(app)`
 * layout it is there on the first render (the server's copy, as SWR's fallback) and no page asks
 * for it again (`STABLE_DATA`: it is read again when you come back to the app and after your own
 * writes, `invalidate.ts`); on the pages outside it (sign-in, change password, join) it loads in the
 * browser.
 * `currency` falls back to `DEFAULT_CURRENCY` until the account loads.
 *
 * Fields are getters so SWR only re-renders a component for the state it
 * actually reads (SWR tracks which of `data`/`error`/`isLoading` are accessed).
 */
export function useAccount() {
  const response = useSWR<AccountData>(ACCOUNT_API_KEY, STABLE_DATA);
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
