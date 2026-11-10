import { useMemo, useState, useSyncExternalStore } from "react";

/**
 * The SWR keys whose first load has taken longer than the provider's `loadingTimeout`. SWR tells the
 * provider when a load turns slow (`onLoadingSlow`) and when it ends (`onSuccess`, `onError`); this
 * is where that is kept so `DataLoading` can say so. Each mark has a sequence number, so a screen
 * only hears about loads that turned slow while it was on screen, never a leftover from a page that
 * was closed mid-load (SWR doesn't report the end of a load nobody is watching).
 */
const slow = new Map<string, number>();
const listeners = new Set<() => void>();
let sequence = 0;
let snapshot: readonly (readonly [string, number])[] = [];

function publish() {
  snapshot = [...slow];
  for (const listener of listeners) listener();
}

export function markSlow(key: string) {
  sequence += 1;
  slow.set(key, sequence);
  publish();
}

export function clearSlow(key: string) {
  if (slow.delete(key)) publish();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const NONE: typeof snapshot = [];

/** The keys that turned slow since the calling component mounted. */
export function useSlowKeys(): readonly string[] {
  const [since] = useState(() => sequence);
  const marks = useSyncExternalStore(subscribe, () => snapshot, () => NONE);
  return useMemo(() => marks.filter(([, mark]) => mark > since).map(([key]) => key), [marks, since]);
}
