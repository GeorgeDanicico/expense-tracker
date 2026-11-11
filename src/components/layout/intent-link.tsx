"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * A `Link` that is prefetched only once someone shows intent (hover, focus or a touch), not when it
 * scrolls into view: Next's own pattern for "prefetch only the links a user is likely to visit"
 * (`prefetching.md`, "Hover-triggered prefetch"). For the links nobody opens on most visits (Settings,
 * More, the settings pages): each prefetch is a request through the session check plus the page's
 * scripts, and a cold load of any page used to pay it for every one of them (PF8).
 */
export function IntentLink({ onPointerEnter, onFocus, onTouchStart, ...props }: ComponentProps<typeof Link>) {
  const [wanted, setWanted] = useState(false);
  const wanting = <E,>(handler?: (event: E) => void) => (event: E) => {
    setWanted(true);
    handler?.(event);
  };
  return (
    <Link
      {...props}
      prefetch={wanted ? null : false}
      onPointerEnter={wanting(onPointerEnter)}
      onFocus={wanting(onFocus)}
      onTouchStart={wanting(onTouchStart)}
    />
  );
}
