import { defineRecipe } from "@chakra-ui/react";

import { pressFeedback } from "../motion";
import { coarseHitArea, touchSize } from "./shared";

/**
 * Sizes: xs 28px, sm 32px (default), md 36px; below `md`, sm and md are 44px touch targets and xs
 * keeps its size with a 44px hit area on touch screens. Every button presses in slightly on tap.
 * Variants: solid (primary, use with `colorPalette="brand"` or `"danger"`), outline (default),
 * ghost, subtle.
 */
export const buttonRecipe = defineRecipe({
  base: {
    borderRadius: "control",
    fontWeight: "medium",
    ...coarseHitArea,
    ...pressFeedback(),
  },
  variants: {
    size: {
      xs: {
        h: "7",
        minW: "7",
        px: "2",
        gap: "1",
        textStyle: "xs",
        _icon: { width: "3.5", height: "3.5" },
      },
      sm: {
        ...touchSize("8"),
        px: "3",
        gap: "1.5",
        textStyle: "sm",
        _icon: { width: "4", height: "4" },
      },
      md: {
        ...touchSize("9"),
        px: "3.5",
        gap: "2",
        textStyle: "md",
        _icon: { width: "4", height: "4" },
      },
    },
    variant: {
      outline: {
        bg: "bg.surface",
        _hover: { bg: "colorPalette.subtle" },
      },
      ghost: {
        _hover: { bg: "colorPalette.subtle" },
      },
    },
  },
  defaultVariants: {
    size: "sm",
    variant: "outline",
  },
});
