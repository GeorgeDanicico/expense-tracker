"use client";

import { useEffect, useState, type MouseEvent, type PointerEvent } from "react";

import { DURATION_MS } from "@/components/ui/theme/motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export type SwipeSide = "left" | "right";

/** What a swipe to one side does. `commit` flies the row out before acting (a delete, Done). */
export type SwipeHandler = { onSwipe: () => void; commit?: boolean };

export type SwipeSides = Partial<Record<SwipeSide, SwipeHandler>>;

export const SWIPE = {
  /** Sideways travel that makes a touch a swipe; the same travel up or down makes it a scroll. */
  slop: 10,
  /** How far the row must travel for the swipe to act; short of it, it snaps back. */
  threshold: 80,
  /**
   * A finger that hasn't decided by then is a long press: the row's menu (`LONG_PRESS.delay`, 500
   * ms). The to-do board passes its drag's 200 ms.
   */
  holdMs: 500,
} as const;

/**
 * Where the row is: `dx` follows the finger, `out` is a committed row flown off that side, `side`
 * is the action shown behind it (kept while it snaps back), `dragging` turns the transition off.
 */
export type SwipeState = { dx: number; out: SwipeSide | null; side: SwipeSide | null; dragging: boolean };

export const SWIPE_AT_REST: SwipeState = { dx: 0, out: null, side: null, dragging: false };

type Pointer = Pick<PointerEvent, "clientX" | "clientY" | "pointerType" | "timeStamp"> & { isPrimary?: boolean };

/**
 * The swipe gesture without React, for touch only (a mouse and a pen use the `⋯` menu, the hover
 * icons and the board's own drag). After a pointer goes down:
 * - moving `slop` sideways (more than up or down) before `holdMs` starts a swipe: the row follows the
 *   finger, toward a side that has an action only;
 * - moving `slop` up or down first is a scroll (the row's `touch-action: pan-y` lets the page have it);
 * - nothing decided by `holdMs` is a long press (the menu, the board's drag), so the swipe stays out.
 * Released past `threshold`, the side's action runs (a `commit` side flies the row out first, unless
 * reduced motion is on); short of it, the row snaps back. The click after a swipe is swallowed, so a
 * tap still opens the row and a swipe never does.
 */
export function createSwipe({
  onChange,
  holdMs = SWIPE.holdMs,
  ...initial
}: {
  sides: SwipeSides;
  reducedMotion: boolean;
  onChange: (state: SwipeState) => void;
  holdMs?: number;
}) {
  let config = initial;
  const sides = () => config.sides;
  const reducedMotion = () => config.reducedMotion;
  let start: { x: number; y: number; time: number } | null = null;
  let swiping = false;
  let dx = 0;
  let swiped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const later = (ms: number, run: () => void) => {
    if (reducedMotion()) return run();
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };
  /** Back to rest; the action behind stays shown until the row has slid back over it. */
  const settle = (side: SwipeSide | null) => {
    onChange({ dx: 0, out: null, side, dragging: false });
    later(DURATION_MS.moderate, () => onChange(SWIPE_AT_REST));
  };

  return {
    /** The row's current actions (none while a write is in flight) and the motion setting. */
    configure(next: { sides: SwipeSides; reducedMotion: boolean }) {
      config = next;
    },
    onPointerDown(event: Pointer) {
      if (event.pointerType !== "touch" || event.isPrimary === false) return;
      start = { x: event.clientX, y: event.clientY, time: event.timeStamp };
      swiping = false;
      swiped = false;
      dx = 0;
    },
    onPointerMove(event: Pointer) {
      if (!start) return;
      const mx = event.clientX - start.x;
      const my = event.clientY - start.y;
      if (!swiping) {
        if (event.timeStamp - start.time > holdMs || (Math.abs(my) >= SWIPE.slop && Math.abs(my) >= Math.abs(mx))) {
          start = null;
          return;
        }
        if (Math.abs(mx) < SWIPE.slop) return;
        swiping = true;
      }
      const side: SwipeSide = mx < 0 ? "left" : "right";
      dx = sides()[side] ? mx : 0;
      onChange({ dx, out: null, side: dx === 0 ? null : side, dragging: true });
    },
    onPointerUp() {
      if (!start) return;
      start = null;
      if (!swiping) return;
      swiping = false;
      swiped = true;
      const side: SwipeSide | null = dx <= -SWIPE.threshold ? "left" : dx >= SWIPE.threshold ? "right" : null;
      const handler = side ? sides()[side] : undefined;
      if (!side || !handler) return settle(dx < 0 ? "left" : dx > 0 ? "right" : null);
      if (!handler.commit) {
        settle(side);
        return handler.onSwipe();
      }
      if (reducedMotion()) {
        handler.onSwipe();
        return onChange(SWIPE_AT_REST);
      }
      onChange({ dx: 0, out: side, side, dragging: false });
      // The row has flown out: act (the row collapses or leaves), then bring it back unseen, in case
      // it stays (Done that first asks about an expense, an undone delete).
      later(DURATION_MS.moderate, () => {
        handler.onSwipe();
        later(DURATION_MS.moderate, () => settle(side));
      });
    },
    /** The browser took the touch (a scroll): snap back. */
    onPointerCancel() {
      if (!start) return;
      start = null;
      if (swiping) settle(dx < 0 ? "left" : dx > 0 ? "right" : null);
      swiping = false;
    },
    onClickCapture(event: Pick<MouseEvent, "preventDefault" | "stopPropagation">) {
      if (!swiped) return;
      swiped = false;
      event.preventDefault();
      event.stopPropagation();
    },
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}

/**
 * `createSwipe` for a row: spread `handlers` on the part that moves, and draw it from `state`
 * (`SwipeRow` in `row-actions.tsx` does both).
 */
export function useSwipe(sides: SwipeSides, holdMs: number = SWIPE.holdMs) {
  const [state, setState] = useState<SwipeState>(SWIPE_AT_REST);
  const reducedMotion = useReducedMotion();
  const [swipe] = useState(() => createSwipe({ sides, reducedMotion, onChange: setState, holdMs }));
  useEffect(() => swipe.configure({ sides, reducedMotion }));
  useEffect(() => () => swipe.dispose(), [swipe]);
  const { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture } = swipe;
  return { state, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture } };
}
