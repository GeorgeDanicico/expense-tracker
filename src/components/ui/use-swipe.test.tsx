import { ChakraProvider } from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focusNeighbour, isDeleteKey, LONG_PRESS, SwipeRow } from "@/components/ui/row-actions";
import { ledgerSystem } from "@/components/ui/theme";
import { DURATION_MS } from "@/components/ui/theme/motion";
import { createSwipe, SWIPE, SWIPE_AT_REST, type SwipeSides, type SwipeState } from "@/components/ui/use-swipe";

const render = (element: ReactElement) => renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{element}</ChakraProvider>);

/** A synthetic pointer event at `x, y`, `time` ms after the gesture began. */
const at = (x: number, y: number, time = 0, pointerType: "touch" | "mouse" | "pen" = "touch") => ({ clientX: x, clientY: y, timeStamp: time, pointerType, isPrimary: true });
const click = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });

function setUp({ sides, reducedMotion = false, holdMs }: { sides?: SwipeSides; reducedMotion?: boolean; holdMs?: number } = {}) {
  const left = { onSwipe: vi.fn(), commit: true };
  const right = { onSwipe: vi.fn() };
  const states: SwipeState[] = [];
  const swipe = createSwipe({ sides: sides ?? { left, right }, reducedMotion, onChange: (state) => states.push(state), holdMs });
  /** Down at (100, 100), then through each point, then up. */
  const drag = (...points: ReturnType<typeof at>[]) => {
    swipe.onPointerDown(at(100, 100));
    for (const point of points) swipe.onPointerMove(point);
    swipe.onPointerUp();
  };
  return { swipe, left, right, states, drag, last: () => states.at(-1) };
}

describe("createSwipe: what a touch is", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts a swipe after 10 px sideways, and the row follows the finger", () => {
    const { swipe, states } = setUp();
    swipe.onPointerDown(at(100, 100));
    swipe.onPointerMove(at(95, 101, 30));
    expect(states).toEqual([]);
    swipe.onPointerMove(at(90, 102, 40));
    expect(states.at(-1)).toEqual({ dx: -10, out: null, side: "left", dragging: true });
    swipe.onPointerMove(at(40, 104, 80));
    expect(states.at(-1)).toEqual({ dx: -60, out: null, side: "left", dragging: true });
  });

  it("leaves a mostly vertical movement to the page's scroll", () => {
    const { drag, states, left, right, swipe } = setUp();
    drag(at(104, 112, 30), at(80, 160, 60));
    expect(states).toEqual([]);
    expect(left.onSwipe).not.toHaveBeenCalled();
    expect(right.onSwipe).not.toHaveBeenCalled();
    const tap = click();
    swipe.onClickCapture(tap);
    expect(tap.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves a finger that rests past the long press to the menu or the drag", () => {
    const { drag, states, left } = setUp();
    drag(at(98, 100, SWIPE.holdMs + 1), at(0, 100, SWIPE.holdMs + 50));
    expect(states).toEqual([]);
    expect(left.onSwipe).not.toHaveBeenCalled();
  });

  it("swipes before the board's 200 ms drag starts, and not after", () => {
    const early = setUp({ holdMs: 200 });
    early.drag(at(88, 100, 150), at(0, 100, 260));
    expect(early.states.length).toBeGreaterThan(0);
    const late = setUp({ holdMs: 200 });
    late.drag(at(88, 100, 250), at(0, 100, 300));
    expect(late.states).toEqual([]);
  });

  it("waits for the row menu's long press by default", () => {
    expect(SWIPE.holdMs).toBe(LONG_PRESS.delay);
  });

  it("ignores a mouse and a pen (desktop has hover icons and the Delete key)", () => {
    const { swipe, states } = setUp();
    for (const type of ["mouse", "pen"] as const) {
      swipe.onPointerDown(at(100, 100, 0, type));
      swipe.onPointerMove(at(0, 100, 20, type));
      swipe.onPointerUp();
    }
    expect(states).toEqual([]);
  });

  it("doesn't move toward a side with no action", () => {
    const { drag, states, right } = setUp({ sides: { left: { onSwipe: vi.fn() } } });
    drag(at(150, 100, 20), at(300, 100, 40));
    expect(states.every((state) => state.dx === 0)).toBe(true);
    expect(right.onSwipe).not.toHaveBeenCalled();
  });
});

describe("createSwipe: letting go", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("snaps back short of the threshold, acts on nothing, and swallows the click", () => {
    const { drag, left, last, swipe } = setUp();
    drag(at(60, 100, 20), at(100 - SWIPE.threshold + 1, 100, 40));
    expect(last()).toEqual({ dx: 0, out: null, side: "left", dragging: false });
    vi.advanceTimersByTime(DURATION_MS.moderate);
    expect(last()).toEqual(SWIPE_AT_REST);
    expect(left.onSwipe).not.toHaveBeenCalled();
    const after = click();
    swipe.onClickCapture(after);
    expect(after.preventDefault).toHaveBeenCalled();
    expect(after.stopPropagation).toHaveBeenCalled();
    const next = click();
    swipe.onClickCapture(next);
    expect(next.preventDefault).not.toHaveBeenCalled();
  });

  it("flies a committing side out past the threshold, then acts, then comes back unseen", () => {
    const { drag, left, last } = setUp();
    drag(at(60, 100, 20), at(100 - SWIPE.threshold, 100, 40));
    expect(last()).toEqual({ dx: 0, out: "left", side: "left", dragging: false });
    expect(left.onSwipe).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DURATION_MS.moderate);
    expect(left.onSwipe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DURATION_MS.moderate * 2);
    expect(last()).toEqual(SWIPE_AT_REST);
  });

  it("acts at once for a side that doesn't commit (Snooze opens its choices) and snaps back", () => {
    const { drag, right, last } = setUp();
    drag(at(130, 100, 20), at(100 + SWIPE.threshold + 20, 100, 40));
    expect(right.onSwipe).toHaveBeenCalledTimes(1);
    expect(last()).toMatchObject({ dx: 0, out: null, dragging: false });
  });

  it("keeps the action under reduced motion, without the fly-out", () => {
    const { drag, left, states } = setUp({ reducedMotion: true });
    drag(at(60, 100, 20), at(0, 100, 40));
    expect(left.onSwipe).toHaveBeenCalledTimes(1);
    expect(states.some((state) => state.out)).toBe(false);
    expect(states.at(-1)).toEqual(SWIPE_AT_REST);
  });

  it("follows the row's actions as they change: none while a write is in flight", () => {
    const { swipe, states } = setUp();
    swipe.configure({ sides: {}, reducedMotion: false });
    swipe.onPointerDown(at(100, 100));
    swipe.onPointerMove(at(0, 100, 30));
    swipe.onPointerUp();
    expect(states.every((state) => state.dx === 0 && !state.out)).toBe(true);
  });

  it("snaps back when the browser takes the touch", () => {
    const { swipe, last, left } = setUp();
    swipe.onPointerDown(at(100, 100));
    swipe.onPointerMove(at(0, 100, 30));
    swipe.onPointerCancel();
    expect(last()).toMatchObject({ dx: 0, out: null, dragging: false });
    vi.runAllTimers();
    expect(left.onSwipe).not.toHaveBeenCalled();
  });

  it("drops its timers when the row goes", () => {
    const { drag, left, swipe } = setUp();
    drag(at(0, 100, 30));
    swipe.dispose();
    vi.runAllTimers();
    expect(left.onSwipe).not.toHaveBeenCalled();
  });
});

describe("SwipeRow", () => {
  it("lets the page scroll vertically through the row, and draws nothing behind it at rest", () => {
    const html = render(
      <SwipeRow left={{ label: "Delete", icon: Trash2, tone: "danger", commit: true, onSwipe: () => undefined }}>
        <span>Groceries</span>
      </SwipeRow>,
    );
    expect(html).toContain("Groceries");
    expect(html).not.toContain("Delete");
    expect(html).toContain("touch-action:pan-y");
    expect(html).not.toContain('style="transform');
  });
});

describe("isDeleteKey", () => {
  const key = (overrides: Partial<Parameters<typeof isDeleteKey>[0]> = {}) => ({
    key: "Delete", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false,
    target: { closest: () => null } as unknown as EventTarget,
    ...overrides,
  });

  it("is a plain Delete on a focused row or card", () => {
    expect(isDeleteKey(key())).toBe(true);
  });

  it("isn't while typing in a field, with a modifier, held down, or another key", () => {
    expect(isDeleteKey(key({ target: { closest: () => ({}) } as unknown as EventTarget }))).toBe(false);
    expect(isDeleteKey(key({ metaKey: true }))).toBe(false);
    expect(isDeleteKey(key({ shiftKey: true }))).toBe(false);
    expect(isDeleteKey(key({ repeat: true }))).toBe(false);
    expect(isDeleteKey(key({ key: "Backspace" }))).toBe(false);
    expect(isDeleteKey(key({ defaultPrevented: true }))).toBe(false);
  });
});

describe("focusNeighbour", () => {
  const rows = () => ["a", "b", "c"].map((id) => ({ id, focus: vi.fn(), contains: () => false }));
  const scope = (list: ReturnType<typeof rows>) => ({ querySelectorAll: () => list }) as unknown as ParentNode;

  it("focuses the next row, or the one before when it was last", () => {
    const list = rows();
    focusNeighbour(list[1] as unknown as Element, "[data-row]", scope(list));
    expect(list[2].focus).toHaveBeenCalled();
    focusNeighbour(list[2] as unknown as Element, "[data-row]", scope(list));
    expect(list[1].focus).toHaveBeenCalled();
  });
});
