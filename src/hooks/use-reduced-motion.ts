"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

import { REDUCED_MOTION_QUERY } from "@/components/ui/theme/global-css";

/** Whether the device asks for reduced motion right now (false outside a browser). */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && (window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false);
}

/** The media query as an external store, for `useSyncExternalStore`. */
export const reducedMotionStore = {
  subscribe(onChange: () => void) {
    const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
    query?.addEventListener("change", onChange);
    return () => query?.removeEventListener("change", onChange);
  },
  getSnapshot: prefersReducedMotion,
  getServerSnapshot: () => false,
};

/**
 * Forces reduced motion on for everything inside it: the dev gallery's and mockups'
 * "Simulate reduced motion" switch. The app itself never sets it.
 */
export const SimulatedReducedMotion = createContext(false);

/**
 * True when the device asks for reduced motion (or a preview simulates it). Only JavaScript-timed
 * motion needs it (the count-up, a delayed hand-off): CSS motion is turned off by the one
 * `@media (prefers-reduced-motion: reduce)` block in the theme's `global-css.ts`. Follows changes
 * to the setting while the page is open.
 */
export function useReducedMotion() {
  const simulated = useContext(SimulatedReducedMotion);
  const device = useSyncExternalStore(reducedMotionStore.subscribe, reducedMotionStore.getSnapshot, reducedMotionStore.getServerSnapshot);
  return simulated || device;
}
