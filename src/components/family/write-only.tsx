"use client";

import type { ReactNode } from "react";

import { useViewing } from "@/hooks/use-viewing";

/**
 * Renders its controls (add, edit, delete, import) only while you're looking at your own data.
 * Writes always act on the caller, so another member's data is read-only; the server never reads
 * `?member=` on a write either. Needs a Suspense boundary above it.
 */
export function WriteOnly({ children }: { children: ReactNode }) {
  const { readOnly } = useViewing();
  return readOnly ? null : <>{children}</>;
}
