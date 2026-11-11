/**
 * How many subscribers hear that the module arrived in one go. A list of a few hundred rows has a lazy menu and
 * tooltips on each, and every one swaps its plain button for the real thing when told, so telling them all at once
 * rebuilt about a thousand widgets in a single block, most of a second on a phone-speed CPU (PF11). In batches,
 * with the browser free to handle a tap between them, the same swap takes no longer overall and never blocks.
 */
export const NOTIFY_BATCH = 24;

function notifyInBatches(subscribers: ReadonlySet<() => void>) {
  const waiting = [...subscribers];
  const run = () => {
    for (const listener of waiting.splice(0, NOTIFY_BATCH)) if (subscribers.has(listener)) listener();
    if (waiting.length) setTimeout(run, 0);
  };
  run();
}

/**
 * A script fetched once, on demand, that components can wait for (PF9): `lazySheet` and `useLazyMenu` both
 * keep one. `load()` starts the fetch (and returns the same promise every time); `get()` is the result once
 * it is in; `subscribe` calls back when it arrives, for `useSyncExternalStore`. `subscribeBefore` callbacks
 * run first, before any subscriber re-renders, for work that needs the page as it was (which element had the
 * focus). A failed fetch is forgotten, so the next `load()` tries again.
 */
export function createLazyModule<T>(fetchModule: () => Promise<T>) {
  let value: T | null = null;
  let loading: Promise<void> | null = null;
  const subscribers = new Set<() => void>();
  const beforeSubscribers = new Set<() => void>();
  const add = (set: Set<() => void>) => (listener: () => void) => {
    set.add(listener);
    return () => void set.delete(listener);
  };
  return {
    get: () => value,
    load(): Promise<void> {
      loading ??= fetchModule().then(
        (module) => {
          value = module;
          beforeSubscribers.forEach((listener) => listener());
          notifyInBatches(subscribers);
        },
        () => {
          loading = null;
        },
      );
      return loading;
    },
    subscribe: add(subscribers),
    subscribeBefore: add(beforeSubscribers),
  };
}
