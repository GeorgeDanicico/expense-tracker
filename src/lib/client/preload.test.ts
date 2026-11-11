// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { preloadOnIntent, preloadWhenIdle } from "@/lib/client/preload";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("preloadWhenIdle", () => {
  const readyState = (value: DocumentReadyState) => vi.spyOn(document, "readyState", "get").mockReturnValue(value);

  describe("where requestIdleCallback exists", () => {
    let idle: (() => void) | null;
    let cancelled: number[];

    beforeEach(() => {
      idle = null;
      cancelled = [];
      vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
        idle = callback;
        return 7;
      });
      vi.stubGlobal("cancelIdleCallback", (id: number) => cancelled.push(id));
    });

    it("loads when the browser is idle, once the page has loaded", () => {
      readyState("complete");
      const load = vi.fn();
      preloadWhenIdle(load);
      expect(load).not.toHaveBeenCalled();
      idle?.();
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("waits for the load event while the page is still loading", () => {
      readyState("interactive");
      const load = vi.fn();
      preloadWhenIdle(load);
      expect(idle).toBeNull();
      window.dispatchEvent(new Event("load"));
      idle?.();
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("can be cancelled before and after it is scheduled", () => {
      readyState("interactive");
      const early = vi.fn();
      preloadWhenIdle(early)();
      window.dispatchEvent(new Event("load"));
      expect(idle).toBeNull();
      expect(early).not.toHaveBeenCalled();

      readyState("complete");
      const late = vi.fn();
      const cancel = preloadWhenIdle(late);
      cancel();
      expect(cancelled).toEqual([7]);
    });
  });

  it("uses a timer where there is no requestIdleCallback (Safari)", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    readyState("complete");
    const load = vi.fn();
    preloadWhenIdle(load);
    vi.advanceTimersByTime(1_999);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("preloadOnIntent", () => {
  it("starts the preload on hover, focus and touch", () => {
    const preload = vi.fn();
    const handlers = preloadOnIntent(preload);
    expect(Object.keys(handlers).sort()).toEqual(["onFocus", "onPointerEnter", "onTouchStart"]);
    handlers.onPointerEnter();
    handlers.onFocus();
    handlers.onTouchStart();
    expect(preload).toHaveBeenCalledTimes(3);
  });
});
