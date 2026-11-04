"use client";

import { useEffect, useState } from "react";

/** How often `useNow` moves on by default. */
export const NOW_TICK_MS = 60_000;

/**
 * The current time, moving on every `intervalMs` while `enabled`, for "due in 2 h", "expires in 19 h"
 * and the calendar's now line to stay true while the page is open.
 */
export function useNow(intervalMs = NOW_TICK_MS, enabled = true) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return undefined;
    const tick = () => setNow(new Date());
    // Once at once, so turning `enabled` on after a while doesn't show the time it was last on.
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [intervalMs, enabled]);
  return now;
}
