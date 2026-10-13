import { defineSlotRecipe } from "@chakra-ui/react";

export const tabsSlotRecipe = defineSlotRecipe({
  slots: ["root", "trigger", "list", "content", "contentGroup", "indicator"],
  base: {
    root: { "--tabs-trigger-radius": "radii.control" },
    trigger: {
      whiteSpace: "nowrap",
      _focusVisible: { outlineOffset: "-2px" },
    },
  },
  variants: {
    size: {
      sm: {
        root: {
          "--tabs-height": "sizes.8",
          "--tabs-content-padding": "spacing.3",
        },
        trigger: { py: "1", px: "3", textStyle: "sm" },
      },
      md: {
        root: {
          "--tabs-height": "sizes.9",
          "--tabs-content-padding": "spacing.4",
        },
        trigger: { py: "1.5", px: "3.5", textStyle: "md" },
      },
    },
    variant: {
      line: {
        trigger: {
          color: "fg.muted",
          _hover: { color: "fg" },
          _selected: {
            color: "fg",
            _horizontal: { "--indicator-color": "colors.fg.accent" },
            _vertical: { "--indicator-color": "colors.fg.accent" },
          },
        },
      },
      subtle: {
        trigger: {
          color: "fg.muted",
          _hover: { color: "fg" },
          _selected: { bg: "bg.muted", color: "fg" },
        },
      },
    },
  },
  defaultVariants: { size: "sm", variant: "line" },
});
