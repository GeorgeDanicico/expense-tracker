"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import useSWR, { SWRConfig, useSWRConfig, type SWRConfiguration } from "swr";

import { DEDUPING_INTERVAL_MS } from "@/lib/api/client";

// The browser half of "first data on the server" (PF6; the server half and the whole pattern are
// described in src/lib/server-prefetch.ts).

/** When this page's server data reached the browser (`performance.now()`); null outside a `ServerFallback`. */
const ArrivedAt = createContext<number | null>(null);

/**
 * When each server answer `useServerFirstSWR` wrote into SWR's cache reached the browser, so a hook
 * mounting later (a block that hydrates after another wrote the copy in) still knows how fresh it is.
 * An answer SWR fetches itself is a new object, not in here.
 */
const arrivals = new WeakMap<object, number>();

/** SWR keys and what the server sent for each: a promise it started without waiting, or a value. */
export type ServerFallbackData = Record<string, unknown>;

/**
 * Puts the server's data in SWR's `fallback` for everything under it, as the Next docs' SWR guide
 * does (`swr.md`, "Provide initial data from a Server Component"). A `useSWR` reading one of these
 * keys before SWR has an answer of its own waits for the server's promise (React suspends it to the
 * nearest `<Suspense>`), with or without `suspense: true`, so components don't change. A promise
 * that resolves to `undefined` (a loader that failed) leaves the key to the browser.
 */
export function ServerFallback({ fallback, children }: { fallback: ServerFallbackData; children: ReactNode }) {
  const [arrivedAt] = useState(() => performance.now());
  return (
    <SWRConfig value={{ fallback }}>
      <ArrivedAt.Provider value={arrivedAt}>{children}</ArrivedAt.Provider>
    </SWRConfig>
  );
}

/**
 * `useSWR(key, config)` for a key a `ServerFallback` above may hold. Two things differ from plain
 * `useSWR`, and only while the copy SWR shows is the server's:
 *
 * - **No request on mount** while that copy is younger than SWR's dedupe window (15 s, the time an
 *   answer SWR fetched itself counts as fresh), counted from when it reached the browser. Otherwise
 *   SWR treats fallback data as stale and asks again right after hydration, repeating what the
 *   server read a moment earlier. This holds for every hook on the key, including one that mounts
 *   after another has written the copy into the cache.
 * - **The copy goes into SWR's cache** once it is on screen. SWR never stores fallback data, so a
 *   write's `mutate(current => …)` would start from `undefined` and `mutate(filter)` would skip the
 *   key; written in, the server's answer is like one SWR fetched (focus, polling and later mounts
 *   revalidate it as usual).
 */
export function useServerFirstSWR<Data>(key: string | null, config: SWRConfiguration<Data> = {}) {
  const { cache, mutate, fallback } = useSWRConfig();
  const arrivedAt = useContext(ArrivedAt);
  // SWR decides whether to revalidate when the hook mounts (and when its key changes), so the mount is what counts.
  const [mountedAt] = useState(() => performance.now());
  const cached: unknown = key === null ? undefined : cache.get(key)?.data;
  const onlyServerCopy = key !== null && cached === undefined && fallback[key] !== undefined;
  // When the copy SWR would show arrived: this page's server data, or the server's answer already written in.
  const arrival = (onlyServerCopy ? arrivedAt : isObject(cached) ? arrivals.get(cached) : null) ?? null;
  const fresh = arrival !== null && mountedAt - arrival < DEDUPING_INTERVAL_MS;
  const response = useSWR<Data>(key, fresh ? { ...config, revalidateIfStale: false } : config);
  const { data } = response;

  useEffect(() => {
    if (key === null || !onlyServerCopy || data === undefined || cache.get(key)?.data !== undefined) return;
    if (isObject(data) && arrivedAt !== null) arrivals.set(data, arrivedAt);
    // A hook that suspended on the server's promise and was replayed by React keeps an SWR callback
    // bound to its first, unfinished render, which throws when told about the very first answer for
    // its key (`returnedData` before initialization, SWR 2.4.1). The cache is written before the
    // callbacks run and the data is the same one on screen, so the throw is dropped, not surfaced.
    mutate(key, data, { revalidate: false }).catch(() => undefined);
  }, [onlyServerCopy, data, cache, mutate, key, arrivedAt]);

  return response;
}

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;
