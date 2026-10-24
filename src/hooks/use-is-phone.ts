"use client";

import { useSyncExternalStore } from "react";

/** Narrower than Chakra's `md` breakpoint (48rem, 768 px): the layouts that switch at `md` treat this as a phone. */
export const PHONE_QUERY = "(max-width: 47.99rem)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True below 768 px, for layouts that differ in behaviour and not just in style (the to-do board shows
 * one column at a time there). False on the server and in the first client render, then the real value.
 */
export function useIsPhone() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
