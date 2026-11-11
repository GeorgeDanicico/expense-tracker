import { useEffect } from "react";

/**
 * Loading a lazy part of the app (`next/dynamic`, PF9) before it is asked for, so a tap never waits for
 * its script. Two moments: when the browser is idle after the page has settled, and on intent
 * (hover, focus or a touch) at the button that opens it.
 */

/** The longest the idle preload waits for a quiet moment: after this it runs anyway. */
const IDLE_TIMEOUT_MS = 5_000;
/** The wait before the idle preload where `requestIdleCallback` doesn't exist (Safari). */
const IDLE_FALLBACK_MS = 2_000;

/**
 * Calls `load` once the page has loaded and the browser is idle, so the script it fetches never
 * competes with the page's own. Returns a function that cancels it.
 */
export function preloadWhenIdle(load: () => unknown): () => void {
  let cancelled = false;
  let cancel = () => {};
  const run = () => {
    if (cancelled) return;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => void load(), { timeout: IDLE_TIMEOUT_MS });
      cancel = () => window.cancelIdleCallback(id);
    } else {
      const id = window.setTimeout(() => void load(), IDLE_FALLBACK_MS);
      cancel = () => window.clearTimeout(id);
    }
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", run);
    cancel();
  };
}

/** `preloadWhenIdle` for a component: starts `load` once the page has settled and the browser is idle, and cancels if the component goes first. */
export function usePreloadWhenIdle(load: () => unknown) {
  // `load` is a module-level function (the page's `preloadSheets`), so it doesn't change between renders.
  useEffect(() => preloadWhenIdle(load), [load]);
}

/** Event handlers that call `preload` on hover, focus and touch: spread them on the button that opens a lazy part. */
export function preloadOnIntent(preload: () => unknown) {
  const handler = () => void preload();
  return { onPointerEnter: handler, onFocus: handler, onTouchStart: handler };
}
