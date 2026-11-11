import type { SWRConfiguration } from "swr";

/**
 * How SWR treats answers that rarely change while you use the app: the account and the family list
 * (member names, colours, roles). PF8.
 *
 * - `revalidateIfStale: false`: a hook mounting with an answer in hand (the server's copy, or one
 *   SWR fetched earlier) doesn't ask again. Without it every page you open asks for the account and
 *   the family again once SWR's 15 s dedupe window has passed, for data that didn't change.
 *   The Next docs name this option as the way to stop it: SWR treats fallback data as stale, and
 *   the setting "applies to every mount" (`client-side-data-fetching/swr.md`).
 * - `revalidateOnFocus: true` (SWR's global setting here is off): coming back to the app is when
 *   something may have changed elsewhere (a parent changed your permissions on another device), so
 *   that is when they are read again, at most once per `focusThrottleInterval` (5 s).
 *
 * Your own writes refresh them through `src/lib/api/invalidate.ts`. A key with no answer yet is
 * still fetched: the option only stops a refetch of an answer that is already there.
 */
export const STABLE_DATA = {
  revalidateIfStale: false,
  revalidateOnFocus: true,
} as const satisfies SWRConfiguration;
