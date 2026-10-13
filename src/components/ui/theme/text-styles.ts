import { defineTextStyles } from "@chakra-ui/react";

const tabular = { fontVariantNumeric: "tabular-nums" } as const;

/**
 * The app's type scale. Components pick a `textStyle` instead of setting
 * `fontSize` / `fontWeight` / `lineHeight` by hand.
 */
export const textStyles = defineTextStyles({
  pageTitle: {
    value: {
      fontSize: { base: "xl", md: "2xl" },
      lineHeight: { base: "1.625rem", md: "1.75rem" },
      fontWeight: "semibold",
      letterSpacing: "-0.01em",
    },
  },
  sectionTitle: {
    value: { fontSize: "md", lineHeight: "1.25rem", fontWeight: "semibold" },
  },
  dialogTitle: {
    value: { fontSize: "lg", lineHeight: "1.5rem", fontWeight: "semibold" },
  },
  body: {
    value: { fontSize: "md", lineHeight: "1.25rem", fontWeight: "normal" },
  },
  bodySm: {
    value: { fontSize: "sm", lineHeight: "1.125rem", fontWeight: "normal" },
  },
  label: {
    value: { fontSize: "xs", lineHeight: "1rem", fontWeight: "medium" },
  },
  caption: {
    value: {
      fontSize: "xs",
      lineHeight: "1rem",
      fontWeight: "normal",
      color: "fg.muted",
    },
  },
  amountHero: {
    value: {
      fontSize: { base: "3xl", md: "4xl" },
      lineHeight: { base: "1.875rem", md: "2.125rem" },
      fontWeight: "semibold",
      letterSpacing: "-0.02em",
      ...tabular,
    },
  },
  amountLg: {
    value: {
      fontSize: "2xl",
      lineHeight: "1.625rem",
      fontWeight: "semibold",
      letterSpacing: "-0.01em",
      ...tabular,
    },
  },
  amount: {
    value: {
      fontSize: "lg",
      lineHeight: "1.375rem",
      fontWeight: "semibold",
      ...tabular,
    },
  },
  amountSm: {
    value: {
      fontSize: "sm",
      lineHeight: "1.125rem",
      fontWeight: "medium",
      ...tabular,
    },
  },
});
