import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Reads made at most once per request (PF4): who the caller is, their membership and their family.
 * Each request handled through `logRequest` gets a new, empty memo, and so does each
 * `runWithSupabaseClient` run (an MCP call acting as a token's user), so a read is shared only
 * between calls that act as the same caller. A page render is the one exception: `asPageCaller`
 * passes the same memo to every run in one render, so the layout and the page share it (PF6).
 * Outside all of these (the worker, a test calling a repository directly) nothing is kept and every
 * call reads again.
 *
 * React's `cache()` can't do this on its own: it only works while React renders, not in a route
 * handler. `asPageCaller` uses it only to find the render's memo.
 *
 * A failed read stays failed for the rest of the request, like a successful one stays read. A write
 * that changes what a key holds calls `forgetPerRequest` with it, so the next read asks again.
 */
export type RequestMemo = Map<string, Promise<unknown>>;

// One store per process, even if a bundler loads this module more than once (see request-context.ts).
const STORE_KEY = Symbol.for("expense-tracker.request-memo");
const globalStore = globalThis as typeof globalThis & { [STORE_KEY]?: AsyncLocalStorage<RequestMemo> };
const store = (globalStore[STORE_KEY] ??= new AsyncLocalStorage<RequestMemo>());

/** The keys in use, so a write can forget the read it changed. */
export const MEMO_KEYS = {
  /** `getAuthenticatedUser()` */
  user: "auth.user",
  /** `getCurrentMember()`: `get_my_membership()` */
  membership: "family.membership",
  /** `get_family()`, in the Supabase family repository */
  family: "family.family",
} as const;

/** Runs `fn` with `memo` (a new, empty one unless given), for everything it awaits or starts. */
export function runWithRequestMemo<T>(fn: () => T, memo: RequestMemo = new Map()): T {
  return store.run(memo, fn);
}

/** `load()`'s promise, shared by every call with this `key` in the current memo; a plain `load()` outside one. */
export function oncePerRequest<T>(key: string, load: () => Promise<T>): Promise<T> {
  const memo = store.getStore();
  if (!memo) return load();
  if (!memo.has(key)) memo.set(key, load());
  return memo.get(key) as Promise<T>;
}

/** Drops `keys` from the current memo, after a write that changed what they hold. */
export function forgetPerRequest(...keys: string[]): void {
  const memo = store.getStore();
  for (const key of keys) memo?.delete(key);
}
