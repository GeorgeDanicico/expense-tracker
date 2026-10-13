import { defineRecipe } from "@chakra-ui/react";

import { coarseHitArea } from "./shared";

/**
 * Sizes: xs 28px, sm 32px (default), md 36px. Variants: solid (primary,
 * use with `colorPalette="brand"` or `"danger"`), outline (default), ghost,
 * subtle.
 */
export const buttonRecipe = defineRecipe({
  base: {
    borderRadius: "control",
    fontWeight: "medium",
    ...coarseHitArea,
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
        h: "8",
        minW: "8",
        px: "3",
        gap: "1.5",
        textStyle: "sm",
        _icon: { width: "4", height: "4" },
      },
      md: {
        h: "9",
        minW: "9",
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
