"use client";

import { Box, type BoxProps } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";

import { REDUCED_MOTION_STYLES } from "@/components/ui/theme/global-css";
import { DURATION_MS } from "@/components/ui/theme/motion";
import { SimulatedReducedMotion, useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * The mockups and the gallery's Motion section run on the real theme. This only adds the
 * "Simulate reduced motion" switch: with `reduced`, everything inside gets the theme's own
 * reduced-motion rules (global-css.ts) and `useReducedMotion()` answers true. Dialogs and menus
 * open in a portal, outside the wrapper, so the switch doesn't reach them; the device setting does.
 */
export function MotionScope({ reduced = false, ...props }: { reduced?: boolean } & Omit<BoxProps, "css">) {
  return (
    <SimulatedReducedMotion.Provider value={reduced}>
      <Box css={reduced ? { "&, & *, & *::before, & *::after": REDUCED_MOTION_STYLES } : undefined} {...props} />
    </SimulatedReducedMotion.Provider>
  );
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
      const t = Math.min(1, (now - start) / DURATION_MS.countUp);
      current.current = origin + (target - origin) * (1 - (1 - t) ** 3);
      setValue(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);
  return reduced ? target : value;
}
