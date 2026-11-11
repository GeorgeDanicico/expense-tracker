// @vitest-environment happy-dom
import { ChakraProvider } from "@chakra-ui/react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lazySheet, useOpenedOnce } from "@/components/ui/lazy-sheet";
import { ledgerSystem } from "@/components/ui/theme";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>);
  });
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

describe("useOpenedOnce", () => {
  it("turns true with the first opening and stays true after it closes", async () => {
    let setOpen: (open: boolean) => void = () => undefined;
    const seen: boolean[] = [];
    function Probe() {
      const [open, set] = useState(false);
      setOpen = set;
      seen.push(useOpenedOnce(open));
      return null;
    }
    await mount(<Probe />);
    expect(seen.at(-1)).toBe(false);
    await act(async () => setOpen(true));
    expect(seen.at(-1)).toBe(true);
    await act(async () => setOpen(false));
    expect(seen.at(-1)).toBe(true);
  });

  it("is true from the start for something that starts open", async () => {
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useOpenedOnce(true));
      return null;
    }
    await mount(<Probe />);
    expect(seen).toEqual([true]);
  });
});

describe("lazySheet", () => {
  it("shows a spinner while the script is on its way, then the sheet, and loads it once for preload and render together", async () => {
    let release: (component: () => React.ReactNode) => void = () => undefined;
    const load = vi.fn(() => new Promise<() => React.ReactNode>((resolve) => (release = resolve)));
    const { Sheet, preload } = lazySheet(load);

    preload();
    expect(load).toHaveBeenCalledTimes(1);

    const container = await mount(<Sheet />);
    expect(container.querySelector('[role="status"] [aria-label="Loading"]')).not.toBeNull();
    expect(container.textContent).not.toContain("The sheet");

    await act(async () => release(() => <p>The sheet</p>));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain("The sheet");
  });
});
