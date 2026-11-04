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
  /** The one number that matters on a screen (the month's total): 28px on phones too. */
  amountHero: {
    value: {
      fontSize: "4xl",
      lineHeight: "2.25rem",
      fontWeight: "semibold",
      letterSpacing: "-0.02em",
      ...tabular,
    },
  },
  /** The quick-add amount being typed: 40px, the one size above the scale (George, 4 November 2026). */
  amountInput: {
    value: {
      fontSize: "2.5rem",
      lineHeight: "3rem",
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
