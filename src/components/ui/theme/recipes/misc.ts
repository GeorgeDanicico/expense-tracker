import { defineRecipe } from "@chakra-ui/react";

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
