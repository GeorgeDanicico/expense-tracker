import { defineRecipe } from "@chakra-ui/react";

import { mobileFieldHeight, mobileInputFont } from "./shared";

const sizes = {
  xs: { textStyle: "xs", px: "2", "--input-height": "sizes.7" },
  sm: { textStyle: "sm", px: "2.5", "--input-height": "sizes.8", ...mobileFieldHeight("--input-height") },
  md: { textStyle: "md", px: "3", "--input-height": "sizes.9" },
};

export const inputRecipe = defineRecipe({
  base: {
    borderRadius: "control",
    bg: "bg.surface",
    "--focus-color": "colors.fg.accent",
    ...mobileInputFont,
  },
  variants: {
    size: sizes,
    variant: {
      outline: { borderColor: "border.strong" },
    },
  },
  defaultVariants: { size: "sm", variant: "outline" },
});

export const textareaRecipe = defineRecipe({
  base: {
    borderRadius: "control",
    bg: "bg.surface",
    "--focus-color": "colors.fg.accent",
    ...mobileInputFont,
  },
  variants: {
    size: {
      xs: { textStyle: "xs", px: "2", py: "1.5", scrollPaddingBottom: "1.5" },
      sm: { textStyle: "sm", px: "2.5", py: "2", scrollPaddingBottom: "2" },
      md: { textStyle: "md", px: "3", py: "2", scrollPaddingBottom: "2" },
    },
    variant: {
      outline: { borderColor: "border.strong" },
    },
  },
  defaultVariants: { size: "sm", variant: "outline" },
});
