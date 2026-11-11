// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { preloadOnIntent, preloadWhenIdle, usePreloadWhenIdle } from "@/lib/client/preload";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("usePreloadWhenIdle", () => {
  function Page({ load }: { load: () => void }) {
    usePreloadWhenIdle(load);
    return null;
  }

  it("preloads once the page is idle, and not if the page goes first", async () => {
    let idle: (() => void) | null = null;
    const cancelled: number[] = [];
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
      idle = callback;
      return 3;
    });
    vi.stubGlobal("cancelIdleCallback", (id: number) => cancelled.push(id));
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    const load = vi.fn();

    const staying = createRoot(document.createElement("div"));
    await act(async () => staying.render(createElement(Page, { load })));
    expect(load).not.toHaveBeenCalled();
    (idle as (() => void) | null)?.();
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => staying.unmount());

    const leaving = createRoot(document.createElement("div"));
    await act(async () => leaving.render(createElement(Page, { load })));
    await act(async () => leaving.unmount());
    expect(cancelled).toContain(3);
  });
});
