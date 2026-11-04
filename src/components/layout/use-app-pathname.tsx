"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext } from "react";

const AppPathContext = createContext<string | null>(null);

/** Tells the navigation which app page it's showing when the URL isn't that page's (the dev preview). */
export const AppPathProvider = AppPathContext.Provider;

/** The path the navigation highlights: the URL's, unless an `AppPathProvider` says otherwise. */
export function useAppPathname() {
  const override = useContext(AppPathContext);
  const pathname = usePathname();
  return override ?? pathname;
}
