import { defineGlobalStyles } from "@chakra-ui/react";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * What reduced motion does to every element: no animation and no transition, so each change is
 * instant and the action itself still happens. `!important` beats the components' own motion and
 * the unlayered `scroll-behavior: smooth` in `globals.css`. Exported for the dev gallery's
 * "Simulate reduced motion" switch, which applies the same rules inside a wrapper.
 */
export const REDUCED_MOTION_STYLES = {
  animation: "none !important",
  transition: "none !important",
  scrollBehavior: "auto !important",
} as const;

export const globalCss = defineGlobalStyles({
  html: {
    colorPalette: "neutral",
    bg: "bg.canvas",
  },
  body: {
    bg: "bg.canvas",
    color: "fg",
    textStyle: "body",
    fontVariantNumeric: "tabular-nums",
  },
  "*::placeholder, *[data-placeholder]": {
    color: "fg.subtle",
  },
  "*::selection": {
    bg: "bg.selected",
    color: "fg",
  },
  "*:focus-visible": {
    outline: "2px solid {colors.fg.accent}",
    outlineOffset: "2px",
  },
  // The one place reduced motion is handled for CSS. JavaScript motion asks `useReducedMotion()`.
  "html, *, *::before, *::after": {
    [`@media ${REDUCED_MOTION_QUERY}`]: REDUCED_MOTION_STYLES,
  },
});
