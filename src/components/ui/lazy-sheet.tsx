"use client";

import { Box, Spinner } from "@chakra-ui/react";
import { createElement, useEffect, useState, useSyncExternalStore, type ComponentType } from "react";

import { createLazyModule } from "@/lib/client/lazy-module";

/**
 * What a sheet or dialog that is loaded on demand (`next/dynamic`, PF9) shows while its script is on the
 * way: a dimmed screen with a spinner, so a tap is answered at once. It is plain Chakra, not `AppDialog`,
 * on purpose: the dialog's machinery is part of what the lazy load keeps out of the first page.
 * It only appears when a tap came before the script was ready, which preloading on idle and on
 * hover or focus (`src/lib/client/preload.ts`) makes rare.
 */
export function SheetLoading() {
  return (
    <Box position="fixed" inset="0" zIndex="modal" bg="blackAlpha.500" display="grid" placeItems="center" role="status" aria-live="polite">
      <Spinner size="lg" color="bg.surface" aria-label="Loading" />
    </Box>
  );
}

/**
 * True from the first time `active` was true, and for good: a lazy sheet is mounted when it is first
 * wanted and then kept, so it can play its closing animation and doesn't load twice.
 */
export function useOpenedOnce(active: boolean): boolean {
  const [opened, setOpened] = useState(active);
  if (active && !opened) setOpened(true);
  return opened || active;
}

/**
 * A sheet or dialog loaded when it is first wanted (PF9). `Sheet` is used like the component it stands for,
 * rendered only once it is wanted (see {@link useOpenedOnce}); it shows {@link SheetLoading} until its script
 * arrives. `preload` starts the download ahead of time: call it on hover, focus or touch near the control that
 * opens the sheet (`preloadOnIntent`), or when the browser is idle. Call `lazySheet` once, at module level.
 *
 * This is not `next/dynamic`: that suspends the first time it renders even when its script is already there,
 * which put a loading frame and an extra render between a tap and a sheet whose code had been preloaded
 * (the lab measured +270 ms on a 4x slower CPU). Once the script is in, `Sheet` renders the component at once.
 */
export function lazySheet<P extends object>(load: () => Promise<ComponentType<P>>) {
  const script = createLazyModule(load);
  function Sheet(props: P) {
    const loaded = useSyncExternalStore(script.subscribe, script.get, script.get);
    useEffect(() => {
      void script.load();
    }, []);
    return loaded ? createElement(loaded, props) : <SheetLoading />;
  }
  return { Sheet, preload: script.load };
}
