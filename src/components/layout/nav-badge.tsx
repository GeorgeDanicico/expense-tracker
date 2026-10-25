"use client";

import { Box } from "@chakra-ui/react";

import { badgeText } from "@/components/reminders/use-reminder-badge";

/**
 * The count on a nav row: hidden at 0, "9+" above 9. Red while anything is overdue, the brand
 * colour while things are only due. The visible number is hidden from assistive technology; the
 * row puts `srLabel` (", 3 due") in its accessible name instead.
 */
export function NavBadge({ count, overdue = 0, srLabel, dot = false }: {
  count: number;
  overdue?: number;
  srLabel: string;
  /** The tab bar's compact form, pinned to its icon's corner. */
  dot?: boolean;
}) {
  const text = badgeText(count);
  if (!text) return null;
  return (
    <>
      <Box
        as="span"
        aria-hidden="true"
        data-nav-badge=""
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        flexShrink="0"
        minW={dot ? "4" : "5"}
        h={dot ? "4" : "5"}
        px="1"
        borderRadius="full"
        bg={overdue > 0 ? "danger.solid" : "brand.solid"}
        color={overdue > 0 ? "danger.contrast" : "brand.contrast"}
        fontSize="2xs"
        lineHeight="1"
        fontWeight="semibold"
        fontVariantNumeric="tabular-nums"
        ms={dot ? undefined : "auto"}
        {...(dot ? { position: "absolute", top: "1", insetStart: "calc(50% + 4px)", boxShadow: "0 0 0 2px {colors.bg.surface}" } : {})}
      >
        {text}
      </Box>
      <span className="sr-only">{srLabel}</span>
    </>
  );
}

/** ", 3 due" — the badge's part of a row's accessible name, with the real count past 9. */
export function remindersBadgeLabel(count: number) {
  return count > 0 ? `, ${count} due` : "";
}
