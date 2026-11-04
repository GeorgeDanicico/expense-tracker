import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { prefersReducedMotion, reducedMotionStore, SimulatedReducedMotion, useReducedMotion } from "./use-reduced-motion";

/** A stand-in for the browser's media query, which the test can flip. */
function fakeMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: initial,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  const matchMedia = vi.fn((query: string) => {
    expect(query).toBe("(prefers-reduced-motion: reduce)");
    return media;
  });
  vi.stubGlobal("window", { matchMedia });
  return {
    listeners,
    set(matches: boolean) {
      media.matches = matches;
      for (const listener of listeners) listener();
    },
  };
}

function Probe() {
  return <>{useReducedMotion() ? "reduced" : "full"}</>;
}

afterEach(() => vi.unstubAllGlobals());

describe("useReducedMotion", () => {
  it("follows the media query, and hears when it changes", () => {
    const media = fakeMedia(false);
    const onChange = vi.fn(() => reducedMotionStore.getSnapshot());
    const unsubscribe = reducedMotionStore.subscribe(onChange);
    expect(reducedMotionStore.getSnapshot()).toBe(false);

    media.set(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveLastReturnedWith(true);
    expect(prefersReducedMotion()).toBe(true);

    unsubscribe();
    expect(media.listeners.size).toBe(0);
  });

  it("is false on the server and outside a browser", () => {
    expect(reducedMotionStore.getServerSnapshot()).toBe(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(renderToStaticMarkup(<Probe />)).toBe("full");
  });

  it("is true where a preview simulates reduced motion", () => {
    expect(
      renderToStaticMarkup(
        <SimulatedReducedMotion.Provider value>
          <Probe />
        </SimulatedReducedMotion.Provider>,
      ),
    ).toBe("reduced");
  });
});
