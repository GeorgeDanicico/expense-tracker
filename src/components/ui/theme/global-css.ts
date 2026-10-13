import { defineGlobalStyles } from "@chakra-ui/react";

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
});
