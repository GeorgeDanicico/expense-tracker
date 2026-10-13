import { defineSlotRecipe } from "@chakra-ui/react";

export const alertSlotRecipe = defineSlotRecipe({
  slots: ["title", "description", "root", "indicator", "content"],
  base: {
    root: { borderRadius: "control" },
    title: { fontWeight: "semibold" },
  },
  variants: {
    status: {
      info: { root: { colorPalette: "info" } },
      warning: { root: { colorPalette: "warning" } },
      success: { root: { colorPalette: "success" } },
      error: { root: { colorPalette: "danger" } },
      neutral: { root: { colorPalette: "neutral" } },
    },
    variant: {
      subtle: {
        root: {
          bg: "colorPalette.subtle",
          color: "colorPalette.fg",
          boxShadow: "inset 0 0 0 1px {colors.colorPalette.border}",
        },
      },
    },
    size: {
      sm: {
        root: { gap: "2", px: "3", py: "2", textStyle: "bodySm" },
        indicator: { textStyle: "md", mt: "0.5" },
      },
      md: {
        root: { gap: "2.5", px: "3.5", py: "3", textStyle: "bodySm" },
        indicator: { textStyle: "lg" },
      },
    },
  },
  defaultVariants: { size: "sm", variant: "subtle" },
});

const dialogSlots = [
  "trigger",
  "backdrop",
  "positioner",
  "content",
  "header",
  "body",
  "footer",
  "title",
  "description",
  "closeTrigger",
];

export const dialogSlotRecipe = defineSlotRecipe({
  slots: dialogSlots,
  base: {
    backdrop: { bg: "backdrop" },
    positioner: {
      p: { base: "3", sm: "4" },
      pb: { base: "calc(0.75rem + env(safe-area-inset-bottom))", sm: "4" },
      height: "var(--available-height, 100dvh)",
      top: "var(--viewport-offset-top, 0px)",
    },
    content: {
      borderRadius: "dialog",
      bg: "bg.surface",
      boxShadow: "overlay",
      textStyle: "bodySm",
      my: "auto",
      maxH: "calc(var(--available-height, 100dvh) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)",
      overflowY: "auto",
      scrollPaddingBlock: "4rem",
    },
    header: {
      flexDirection: "column",
      gap: "1",
      ps: { base: "4", md: "5" },
      pe: "12",
      pt: { base: "4", md: "5" },
      pb: "3",
    },
    body: {
      px: { base: "4", md: "5" },
      pt: "0",
      pb: { base: "4", md: "5" },
    },
    footer: {
      gap: "2",
      px: { base: "4", md: "5" },
      pt: "0",
      pb: { base: "4", md: "5" },
    },
    title: { textStyle: "dialogTitle" },
    description: { textStyle: "bodySm", color: "fg.muted" },
    closeTrigger: { top: "3", insetEnd: "3" },
  },
  variants: {
    placement: {
      center: {
        positioner: { alignItems: "center" },
      },
      bottom: {
        positioner: { alignItems: { base: "flex-end", sm: "center" } },
        content: { my: { base: "0", sm: "auto" } },
      },
    },
  },
  defaultVariants: { placement: "center" },
});
