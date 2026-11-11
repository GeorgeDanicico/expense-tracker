"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { preloadWhenIdle } from "@/lib/client/preload";

/**
 * Menus and tooltips load after the page does (PF9). Chakra's `Menu` and `Tooltip` share the code that
 * positions a floating panel (Floating UI) and a state machine each; together they are about 26 KiB
 * gzipped, and a menu is opened by a tap in a minority of visits. So the page renders each menu's button
 * on its own at first, the script is fetched when the browser is idle (or sooner, when a pointer, a finger
 * or the keyboard reaches a button), and every button then swaps itself for the real menu.
 *
 * A site uses it like this: `const { parts, placeholder, holdPlain, takeFocus, asked } = useLazyMenu();` (destructured: the React Compiler's lint rejects `lazy.holdPlain` as a ref access), and while `lazy.parts` is null returns just the
 * button with `placeholder` spread on it and `ref={holdPlain}`; with the parts, the usual `Menu.Root` around
 * `<Menu.Trigger asChild>` and the button, which also gets `ref={takeFocus}` and `defaultOpen={asked}` on the root
 * (a tap that came before the script did opens the menu as it arrives).
 */
type Parts = typeof import("./menu-parts");

let loaded: Parts | null = null;
let loading: Promise<void> | null = null;
let idleStarted = false;
const swapListeners = new Set<() => void>();
const beforeSwap = new Set<() => void>();

/** Fetches the menu parts (once), then tells every waiting button to swap itself. A failed fetch is tried again next time. */
export function loadMenuParts(): Promise<void> {
  loading ??= import("./menu-parts").then(
    (parts) => {
      loaded = parts;
      beforeSwap.forEach((listener) => listener());
      swapListeners.forEach((listener) => listener());
    },
    () => {
      loading = null;
    },
  );
  return loading;
}

const subscribe = (listener: () => void) => {
  swapListeners.add(listener);
  return () => void swapListeners.delete(listener);
};

/** The loaded menu parts, or null until they are: render the plain button while it is null. */
export function useMenuParts(): Parts | null {
  const parts = useSyncExternalStore(subscribe, () => loaded, () => null);
  useEffect(() => {
    if (loaded || idleStarted) return;
    idleStarted = true;
    preloadWhenIdle(loadMenuParts);
  }, []);
  return parts;
}

/**
 * The state a menu's button needs for the swap: the parts, the props that make the plain button ask for them,
 * two ref callbacks (`holdPlain` for the plain button, `takeFocus` for the real one: the swap puts a new button on the page and this hands it the focus the old one had), and whether a tap came before the parts did. `open` is a menu opened from
 * somewhere else (a swipe or a long press, `RowActions`): it asks for the parts too.
 */
export function useLazyMenu({ open = false }: { open?: boolean } = {}) {
  const parts = useMenuParts();
  const [asked, setAsked] = useState(false);
  // The plain button now on the page, and whether it had the focus when the swap was about to remove it.
  const plain = useRef<HTMLElement | null>(null);
  const hadFocus = useRef(false);

  useEffect(() => {
    if (open) void loadMenuParts();
  }, [open]);

  // Just before the swap takes the plain button off the page: did it have the focus?
  useEffect(() => {
    const remember = () => {
      if (plain.current && plain.current === document.activeElement) hadFocus.current = true;
    };
    beforeSwap.add(remember);
    return () => void beforeSwap.delete(remember);
  }, []);

  const takeFocus = useCallback((element: HTMLElement | null) => {
    if (element && hadFocus.current) {
      hadFocus.current = false;
      element.focus({ preventScroll: true });
    }
  }, []);

  const ask = useCallback(() => void loadMenuParts(), []);
  const holdPlain = (element: HTMLElement | null) => {
    plain.current = element;
  };
  const placeholder = {
    "aria-haspopup": "menu" as const,
    "aria-expanded": false,
    onPointerEnter: ask,
    onTouchStart: ask,
    onFocus: ask,
    onClick: () => {
      setAsked(true);
      ask();
    },
  };
  return { parts, placeholder, holdPlain, takeFocus, asked };
}

/**
 * The same for a tooltip: the button is a plain one until the parts are there, then the tooltip wraps it.
 * `holdPlain` and `takeFocus` do what they do for a menu; there is no tap to answer.
 */
export function useLazyTooltip() {
  const { parts, placeholder, holdPlain, takeFocus } = useLazyMenu();
  const { onPointerEnter, onTouchStart, onFocus } = placeholder;
  return { parts, placeholder: { onPointerEnter, onTouchStart, onFocus }, holdPlain, takeFocus };
}
