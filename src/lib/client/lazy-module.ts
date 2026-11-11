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
          subscribers.forEach((listener) => listener());
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
