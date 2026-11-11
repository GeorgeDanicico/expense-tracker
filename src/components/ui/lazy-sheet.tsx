"use client";

import { Box, Spinner } from "@chakra-ui/react";
import dynamic from "next/dynamic";
import { useState, type ComponentType } from "react";

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
 * A sheet or dialog loaded when it is first wanted (`next/dynamic`, PF9). `Sheet` is used like the
 * component it stands for, rendered only once it is wanted (see {@link useOpenedOnce}); it shows
 * {@link SheetLoading} until its script arrives. `preload` starts the download ahead of time: call it on
 * hover, focus or touch near the control that opens the sheet (`preloadOnIntent`).
 * Call it once, at module level.
 */
export function lazySheet<P extends object>(load: () => Promise<ComponentType<P>>) {
  return {
    Sheet: dynamic(load, { loading: () => <SheetLoading /> }),
    preload: () => void load(),
  };
}
