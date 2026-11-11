"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import useSWR, { SWRConfig, useSWRConfig, type SWRConfiguration } from "swr";

import { DEDUPING_INTERVAL_MS } from "@/lib/api/client";

// The browser half of "first data on the server" (PF6; the server half and the whole pattern are
// described in src/lib/server-prefetch.ts).

/** What the nearest `ServerFallback` sent: its data by SWR key, and when it reached the browser (`performance.now()`). */
type Scope = { fallback: ServerFallbackData; arrivedAt: number };

/** The nearest `ServerFallback`'s data and arrival time; null outside one. */
const ServerScope = createContext<Scope | null>(null);

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
      <ServerScope.Provider value={{ fallback, arrivedAt }}>{children}</ServerScope.Provider>
    </SWRConfig>
  );
}

/**
 * `useSWR(key, config)` for a key a `ServerFallback` above may hold. What differs from plain `useSWR`:
 *
 * - **No request on mount** while the copy the server sent is fresh, and SWR would otherwise ask
 *   again right after hydration (it treats fallback data as stale), repeating what the server read a
 *   moment earlier. Fresh means: this `ServerFallback`'s own copy for the key (a page that has just
 *   been rendered on the server, on a first load or on a move from another page), or an earlier copy
 *   SWR holds that is younger than SWR's dedupe window (15 s, the time an answer SWR fetched itself
 *   counts as fresh), counted from when it reached the browser. This holds for every hook on the key.
 * - **The copy goes into SWR's cache** once it arrives, replacing an older answer SWR has for the key
 *   (an earlier visit to the page shows at once, and the server's newer copy follows). SWR never
 *   stores fallback data, so without this a write's `mutate(current => …)` would start from
 *   `undefined` and `mutate(filter)` would skip the key; written in, the server's answer is like one
 *   SWR fetched (focus, polling and later mounts revalidate it as usual). A copy that is `undefined`
 *   (the loader failed) makes the browser ask instead.
 */
export function useServerFirstSWR<Data>(key: string | null, config: SWRConfiguration<Data> = {}) {
  const { cache, mutate } = useSWRConfig();
  const scope = useContext(ServerScope);
  // SWR decides whether to revalidate when the hook mounts (and when its key changes), so the mount is what counts.
  const [mountedAt] = useState(() => performance.now());
  const cached: unknown = key === null ? undefined : cache.get(key)?.data;
  // What this `ServerFallback` sent for the key (a promise or a value).
  const copy: unknown = key === null ? undefined : scope?.fallback[key];
  const arrivedAt = scope?.arrivedAt ?? null;
  // When the answer SWR would show arrived: this page's server copy, or an earlier one already written in.
  const arrival = (cached === undefined ? (copy === undefined ? null : arrivedAt) : isObject(cached) ? arrivals.get(cached) : null) ?? null;
  // The copy is on its way to replace an older answer SWR holds: asking again would repeat it.
  const replacing = copy !== undefined && arrivedAt !== null && cached !== undefined && (arrival === null || arrival < arrivedAt);
  const fresh = replacing || (arrival !== null && mountedAt - arrival < DEDUPING_INTERVAL_MS);
  const response = useSWR<Data>(key, fresh ? { ...config, revalidateIfStale: false } : config);

  useEffect(() => {
    if (key === null || copy === undefined || arrivedAt === null) return;
    let current = true;
    // With an older answer in the cache this mount was told not to ask; with none, SWR asks by itself.
    const hadOlderAnswer = cache.get(key)?.data !== undefined;
    void Promise.resolve(copy).then((data: unknown) => {
      if (!current) return;
      // A copy that failed (the loader resolved to nothing): the browser asks instead.
      if (data === undefined) {
        if (hadOlderAnswer) mutate(key).catch(ignore);
        return;
      }
      if (cache.get(key)?.data === data) return;
      if (isObject(data)) arrivals.set(data, arrivedAt);
      // A hook that suspended on the server's promise and was replayed by React keeps an SWR callback
      // bound to its first, unfinished render, which throws when told about the very first answer for
      // its key (`returnedData` before initialization, SWR 2.4.1). The cache is written before the
      // callbacks run and the data is the same one on screen, so the throw is dropped, not surfaced.
      mutate(key, data, { revalidate: false }).catch(ignore);
    });
    return () => { current = false; };
  }, [key, copy, arrivedAt, cache, mutate]);

  return response;
}

const ignore = () => undefined;
const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;
