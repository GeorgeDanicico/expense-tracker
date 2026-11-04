"use client";

import { Stack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { PAGE_SPACING } from "@/components/ui/theme/layout";

const PLACEMENTS = {
  /** On the phone's bottom bar (clear of the home indicator), at the window's bottom on desktop. */
  page: {
    bottom: { base: PAGE_SPACING.bottomBar, md: "0" },
    bg: "bg.surface",
    borderWidth: "1px",
    borderColor: "border",
    borderRadius: "card",
    boxShadow: "xs",
    px: "4",
    py: "3",
  },
  /** At the bottom of a sheet's scrolling body, for a form whose buttons live inside it. */
  sheet: { bottom: "0", bg: "bg.surface", pt: "3" },
} as const;

/**
 * The sticky bottom area for the main button(s) of a page or a sheet, within thumb reach. A sheet
 * whose buttons don't need to be inside its form can use `AppDialog`'s `footer` instead, which is
 * already this bar.
 */
export function ActionBar({
  children,
  placement = "page",
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  placement?: keyof typeof PLACEMENTS;
  "aria-label"?: string;
}) {
  return (
    <Stack role={ariaLabel ? "region" : undefined} aria-label={ariaLabel} gap="3" position="sticky" zIndex="docked" {...PLACEMENTS[placement]}>
      {children}
    </Stack>
  );
}
