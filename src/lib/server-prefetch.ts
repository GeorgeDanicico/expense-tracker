import "server-only";

import { asPageCaller } from "@/lib/auth";
import { errorFields, log } from "@/lib/log";

/*
 * First data on the server (PF6): the pattern every page copies (Home first; Expenses, To-dos and
 * Reminders in PF7). Plan: docs/performance-plan.md, Design 1–3; review: docs/performance.md, PF6.
 *
 * 1. One loader per resource, in src/lib/<feature>/load-*.ts, that returns exactly what the API
 *    route answers for a query (`loadDashboard`, `loadReminders`, `loadTodos`). The route calls it
 *    too, so both give the same shape after the same checks.
 * 2. The page is a server component. It awaits only what it needs to decide which blocks it has
 *    (the account, `loadPageAccount`, which the `(app)` layout has already read in this render), then
 *    starts one `prefetch(page, key, loader)` per block **without awaiting it**, and passes the
 *    promises to `<ServerFallback fallback={{ [key]: promise }}>` (src/lib/api/server-fallback.tsx).
 *    A block the person can't see gets no entry, so none of its data is in the HTML.
 * 3. Keys come from src/lib/api/keys.ts, the same functions the browser's hooks use, and `prefetch`
 *    hands the loader the key's own query. If the two keys differed, SWR would ignore the fallback
 *    and fetch in the browser (`swr.md`).
 * 4. The client components keep `useSWR`'s key, through `useServerFirstSWR`. SWR 2.4.1 waits on a
 *    promise in `fallback` whether or not `suspense: true` is set (it calls React's `use()` on it;
 *    PF6's spike, see src/lib/home/load-home.ts), so each block suspends to the nearest `<Suspense>`.
 *    Give every block its own boundary, a `StreamedSection` (src/components/ui/streamed-section.tsx)
 *    with its loading card as the fallback, never a bare `<Suspense>`: on the server it gives the
 *    block's styles a cache of their own, without which streamed content lost its styles until
 *    hydration (a 0.34 layout shift in the lab). Keep the heading outside all of them: it paints at
 *    once and the blocks stream in as their data arrives (`streaming.md`, "Streaming and Web Vitals").
 * 5. `useServerFirstSWR` skips the first revalidation while the server's copy is fresh and writes the
 *    copy into SWR's cache, so nothing is fetched again on the first render and optimistic writes
 *    start from the server's data.
 * 6. A loader that fails doesn't break the page: `prefetch` logs `server_prefetch_failed` (the page
 *    and the API path, never the data) and resolves to `undefined`, and the browser fetches that key
 *    as it did before PF6, showing the block's own error if that fails too.
 *
 * A page render writes no `request` line (only API requests do), so the loaders' Supabase calls don't
 * show in production's logs; only their failures do, as `server_prefetch_failed`.
 */

/**
 * Starts `load` for the SWR `key` as the page's caller (`asPageCaller`, sharing the render's memo
 * with the layout), handing it the key's query. Resolves to `undefined` when it fails, after logging
 * `server_prefetch_failed` with `page` (the route, like `/dashboard`) and the key's path.
 */
export function prefetch<T>(page: string, key: string, load: (query: URLSearchParams) => Promise<T>): Promise<T | undefined> {
  const url = new URL(key, "http://localhost");
  return asPageCaller(() => load(url.searchParams)).catch((error: unknown) => {
    log.error("server_prefetch_failed", { route: page, api: url.pathname, ...errorFields(error) });
    return undefined;
  });
}
