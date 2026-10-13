import { defineSlotRecipe } from "@chakra-ui/react";

import { mobileFieldHeight, mobileInputFont } from "../recipes/shared";

export const nativeSelectSlotRecipe = defineSlotRecipe({
  slots: ["root", "field", "indicator"],
  base: {
    field: {
      borderRadius: "control",
      bg: "bg.surface",
      "--focus-color": "colors.fg.accent",
      ...mobileInputFont,
    },
    indicator: { color: "fg.subtle" },
  },
  variants: {
    variant: {
      outline: { field: { borderColor: "border.strong" } },
    },
    size: {
      xs: {
        root: { "--select-field-height": "sizes.7" },
        field: { textStyle: "xs", ps: "2", pe: "6" },
        indicator: { textStyle: "sm", insetEnd: "1.5" },
      },
      sm: {
        root: { "--select-field-height": "sizes.8", ...mobileFieldHeight("--select-field-height") },
        field: { textStyle: "sm", ps: "2.5", pe: "7" },
        indicator: { textStyle: "md", insetEnd: "2" },
      },
      md: {
        root: { "--select-field-height": "sizes.9" },
        field: { textStyle: "md", ps: "3", pe: "8" },
        indicator: { textStyle: "md", insetEnd: "2.5" },
      },
    },
  },
  defaultVariants: { size: "sm", variant: "outline" },
});

export const fieldSlotRecipe = defineSlotRecipe({
  slots: ["root", "label", "helperText", "errorText", "requiredIndicator"],
  base: {
    root: { gap: "1.5" },
    label: { textStyle: "label", color: "fg" },
    helperText: { textStyle: "caption" },
    errorText: { textStyle: "caption", color: "fg.error" },
  },
});

export const segmentGroupSlotRecipe = defineSlotRecipe({
  slots: ["root", "label", "item", "itemText", "itemControl", "indicator"],
  base: {
    root: {
      "--segment-radius": "radii.control",
      "--segment-indicator-bg": "colors.bg.surface",
      "--segment-indicator-shadow": "shadows.xs",
      bg: "bg.muted",
      boxShadow: "none",
      p: "0.5",
    },
    item: {
      color: "fg.muted",
      fontWeight: "medium",
      _checked: { color: "fg" },
    },
    indicator: {
      boxShadow: "0 0 0 1px {colors.border}, {shadows.xs}",
    },
  },
  variants: {
    size: {
      xs: { item: { textStyle: "xs", px: "2.5", gap: "1", height: "6" } },
      sm: { item: { textStyle: "sm", px: "3", gap: "1.5", height: "7" } },
      md: { item: { textStyle: "sm", px: "3.5", gap: "2", height: "8" } },
    },
  },
  defaultVariants: { size: "sm" },
});
