import { defineTokens } from "@chakra-ui/react";

/**
 * Raw design tokens. Components never reference these directly; they use the
 * semantic tokens in `semantic-tokens.ts`, which point back here.
 */
export const tokens = defineTokens({
  colors: {
    ledger: {
      canvas: { value: "#F4F3EE" },
      surface: { value: "#FFFFFF" },
      subtle: { value: "#F9F8F5" },
      muted: { value: "#F1EFE9" },
      selected: { value: "#F5E8E1" },
      selectedStrong: { value: "#EFDCD2" },
      ink: { value: "#292824" },
      inkMuted: { value: "#625F58" },
      inkSubtle: { value: "#8C8981" },
      line: { value: "#E6E4DC" },
      lineStrong: { value: "#D3D0C6" },
      clay: { value: "#D97757" },
      clayDark: { value: "#A64B32" },
      clayLine: { value: "#E6CBBE" },
    },
    status: {
      positive: { value: "#37634A" },
      positiveBg: { value: "#EAF1EC" },
      positiveLine: { value: "#C9DDD0" },
      negative: { value: "#A33732" },
      negativeBg: { value: "#F9EBE9" },
      negativeLine: { value: "#EDC9C5" },
      warning: { value: "#8A5A12" },
      warningBg: { value: "#FBF1DE" },
      warningLine: { value: "#EED9AE" },
      info: { value: "#2F5B85" },
      infoBg: { value: "#EAF0F7" },
      infoLine: { value: "#C8D7E8" },
    },
  },
  fonts: {
    body: { value: "var(--font-geist-sans), system-ui, sans-serif" },
    heading: { value: "var(--font-geist-sans), system-ui, sans-serif" },
    mono: { value: "var(--font-geist-mono), ui-monospace, monospace" },
  },
  fontSizes: {
    "2xs": { value: "0.6875rem" },
    xs: { value: "0.75rem" },
    sm: { value: "0.8125rem" },
    md: { value: "0.875rem" },
    lg: { value: "1rem" },
    xl: { value: "1.125rem" },
    "2xl": { value: "1.25rem" },
    "3xl": { value: "1.5rem" },
    "4xl": { value: "1.75rem" },
  },
  fontWeights: {
    medium: { value: 500 },
    semibold: { value: 600 },
    bold: { value: 600 },
    extrabold: { value: 600 },
    black: { value: 600 },
  },
  radii: {
    // Legacy values still used by unmigrated screens; removed in Task 8.
    lg: { value: "0.5rem" },
    xl: { value: "0.5rem" },
    "2xl": { value: "0.625rem" },
    badge: { value: "0.25rem" },
    control: { value: "0.375rem" },
    card: { value: "0.625rem" },
    dialog: { value: "0.75rem" },
  },
});
