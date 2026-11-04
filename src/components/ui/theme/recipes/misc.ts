import { defineRecipe } from "@chakra-ui/react";

import { PRESS_SCALE, pressFeedback } from "../motion";

export const headingRecipe = defineRecipe({
  base: { fontWeight: "semibold", letterSpacing: "normal" },
  variants: {
    size: {
      sm: { textStyle: "label" },
      md: { textStyle: "sectionTitle" },
      lg: { textStyle: "dialogTitle" },
      xl: { textStyle: "pageTitle" },
    },
  },
  defaultVariants: { size: "md" },
});

export const badgeRecipe = defineRecipe({
  base: {
    borderRadius: "badge",
    fontWeight: "medium",
  },
  variants: {
    size: {
      sm: { textStyle: "xs", px: "1.5", minH: "5" },
      md: { textStyle: "sm", px: "2", minH: "6" },
    },
  },
  defaultVariants: { size: "sm" },
});

export const linkRecipe = defineRecipe({
  base: {
    borderRadius: "badge",
    textUnderlineOffset: "3px",
  },
});

/**
 * A pill that toggles (`aria-pressed`) or shows a current choice (`data-selected`): filters, member
 * chips, lead times, the quick-add chips. 36px tall on phones (32 from `md`) with a 44px hit area,
 * and it presses in a little more than a button.
 */
export const chipRecipe = defineRecipe({
  className: "chip",
  base: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1.5",
    flexShrink: "0",
    whiteSpace: "nowrap",
    h: { base: "9", md: "8" },
    px: "3",
    borderWidth: "1px",
    borderRadius: "pill",
    borderColor: "border.strong",
    bg: "bg.surface",
    color: "fg",
    textStyle: "bodySm",
    fontWeight: "medium",
    cursor: "pointer",
    userSelect: "none",
    _hover: { bg: "bg.subtle" },
    _disabled: { opacity: 0.5, cursor: "not-allowed" },
    "&:is([aria-pressed=true], [data-selected])": {
      borderColor: "brand.border",
      bg: "bg.selected",
      color: "fg.accent",
    },
    _icon: { width: "4", height: "4" },
    // A 44px hit area around the 36px chip.
    _before: { content: '""', position: "absolute", insetX: "0", top: "50%", height: "2.75rem", transform: "translateY(-50%)" },
    ...pressFeedback(PRESS_SCALE.chip),
  },
});

/**
 * A list row: 56px tall on phones (48 from `md`), no line between rows (space separates them).
 * A row that is a link or a button, or marked `data-pressable`, tints on hover and presses in.
 */
export const rowRecipe = defineRecipe({
  className: "row",
  base: {
    display: "flex",
    alignItems: "center",
    gap: "3",
    minH: { base: "14", md: "12" },
    px: "2",
    py: "2",
    borderRadius: "control",
    textAlign: "start",
    width: "full",
    "&:is(a, button, [data-pressable])": {
      cursor: "pointer",
      ...pressFeedback(),
      _hover: { bg: "bg.subtle" },
    },
    // `RowActions`' icon buttons show when the row is hovered or focused, on screens with a pointer.
    "@media (hover: hover)": {
      "& [data-row-actions]": { opacity: 0, transition: "opacity {durations.fast} {easings.standard}" },
      "&:hover [data-row-actions], &:focus-within [data-row-actions]": { opacity: 1 },
    },
  },
});
