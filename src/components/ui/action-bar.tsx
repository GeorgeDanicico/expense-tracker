"use client";

import { Stack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { PAGE_SPACING } from "@/components/ui/theme/layout";

/**
 * The sticky bottom area for a page's main button(s), within thumb reach: it sits on the phone's
 * bottom bar (clear of the home indicator) and at the bottom of the window on desktop. In a sheet,
 * `AppDialog`'s `footer` is already this bar. `overBottomBar={false}` for a page without the
 * bottom bar, where the bar itself keeps clear of the home indicator.
 */
export function ActionBar({
  children,
  overBottomBar = true,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  overBottomBar?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Stack
      role={ariaLabel ? "region" : undefined}
      aria-label={ariaLabel}
      gap="3"
      position="sticky"
      bottom={overBottomBar ? { base: PAGE_SPACING.bottomBar, md: "0" } : "0"}
      zIndex="docked"
      bg="bg.surface"
      borderWidth="1px"
      borderColor="border"
      borderRadius="card"
      boxShadow="xs"
      px="4"
      pt="3"
      pb={overBottomBar ? "3" : { base: "calc(0.75rem + env(safe-area-inset-bottom))", md: "3" }}
    >
      {children}
    </Stack>
  );
}
