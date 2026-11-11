"use client";

// The pieces of Chakra that position a floating panel next to its button: `Menu` and `Tooltip`, with the
// positioning library (Floating UI) and the state machines behind them, about 26 KiB gzipped on their own.
// Nothing imports this file directly: `lazy-menu.tsx` loads it once the page is idle, or when someone
// reaches for a menu or a tooltip, so those bytes are not in a page's first load (PF9).
export { Menu, Tooltip } from "@chakra-ui/react";
