"use client";

import { Box, type BoxProps } from "@chakra-ui/react";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { PROPOSED_COUNT_UP_MS, proposedScope } from "./proposed-theme";

const SimulatedReducedMotion = createContext(false);

/**
 * Previews the proposed radii, spacing, motion and touch sizes on everything inside it (see
 * `proposed-theme.ts`). `reduced` simulates `prefers-reduced-motion: reduce`.
 */
export function ProposedThemeScope({ reduced = false, ...props }: { reduced?: boolean } & Omit<BoxProps, "css">) {
  return (
    <SimulatedReducedMotion.Provider value={reduced}>
      <Box css={proposedScope(reduced)} {...props} />
    </SimulatedReducedMotion.Provider>
  );
}

const QUERY = "(prefers-reduced-motion: reduce)";
const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

/**
 * Stand-in for U4's shared `useReducedMotion()`: true when the device asks for reduced motion or the
 * scope simulates it. Only JavaScript-driven motion (the count-up, timed hand-offs) needs it; CSS
 * motion follows the scope's variables.
 */
export function useReducedMotion() {
  const simulated = useContext(SimulatedReducedMotion);
  const device = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  return simulated || device;
}

/** Waits `ms` before running `then`, or runs it at once under reduced motion (the action always happens). */
export function useMotionDelay() {
  const reduced = useReducedMotion();
  return (ms: number, then: () => void) => {
    if (reduced) then();
    else window.setTimeout(then, ms);
  };
}

/** Counts a number up (or down) to `target` with an ease-out curve; jumps straight there under reduced motion. */
export function useCountUp(target: number, from = 0) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(from);
  const current = useRef(from);
  useEffect(() => {
    if (reduced) return;
    const start = performance.now();
    const origin = current.current;
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / PROPOSED_COUNT_UP_MS);
      current.current = origin + (target - origin) * (1 - (1 - t) ** 3);
      setValue(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);
  return reduced ? target : value;
}
