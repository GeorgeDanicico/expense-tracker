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

/** The sheet's bottom padding on a phone: clear of the home indicator. */
export const SHEET_BOTTOM_PADDING = "calc(1rem + env(safe-area-inset-bottom))";

const DESKTOP_MAX_H = "calc(var(--available-height, 100dvh) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)";

/**
 * Every dialog is a **bottom sheet below `md`** and a **centred dialog from `md` up**, from the same
 * markup, so turning a phone or resizing a window never remounts a form.
 *
 * - Phone: full width at the bottom of the visual viewport (`--available-height` and
 *   `--viewport-offset-top`, kept by `PwaRegistration`), so the keyboard never covers the footer;
 *   the body scrolls between the header and the footer; rounded top corners (`sheet`); slides up
 *   (`slow` · `enter`) and back down (`slow` · `exit`).
 * - Desktop: centred, the `dialog` radius, the whole dialog scrolls when it's taller than the
 *   screen; fades and scales in (`moderate` · `enter`).
 *
 * `placement` only exists for compatibility: both values look the same now.
 */
export const dialogSlotRecipe = defineSlotRecipe({
  slots: dialogSlots,
  base: {
    backdrop: {
      bg: "backdrop",
      _open: { animationName: "fade-in", animationDuration: "moderate", animationTimingFunction: "standard" },
      _closed: { animationName: "fade-out", animationDuration: "moderate", animationTimingFunction: "standard" },
    },
    positioner: {
      alignItems: { base: "flex-end", md: "center" },
      px: { base: "0", md: "4" },
      pt: { base: "calc(0.75rem + env(safe-area-inset-top))", md: "4" },
      pb: { base: "0", md: "4" },
      height: "var(--available-height, 100dvh)",
      top: "var(--viewport-offset-top, 0px)",
    },
    content: {
      bg: "bg.surface",
      boxShadow: "overlay",
      textStyle: "bodySm",
      my: { base: "0", md: "auto" },
      borderTopRadius: { base: "sheet", md: "dialog" },
      borderBottomRadius: { base: "0", md: "dialog" },
      maxH: { base: "full", md: DESKTOP_MAX_H },
      overflowY: { base: "hidden", md: "auto" },
      scrollPaddingBlock: "4rem",
      _open: {
        animationName: { base: "sheet-in", md: "pop-in" },
        animationDuration: { base: "slow", md: "moderate" },
        animationTimingFunction: "enter",
      },
      _closed: {
        animationName: { base: "sheet-out", md: "pop-out" },
        animationDuration: { base: "slow", md: "moderate" },
        animationTimingFunction: "exit",
      },
    },
    header: {
      flexDirection: "column",
      gap: "1",
      ps: { base: "4", md: "5" },
      pe: "12",
      pt: { base: "2", md: "5" },
      pb: "3",
    },
    body: {
      px: { base: "4", md: "5" },
      pt: "0",
      pb: { base: "4", md: "5" },
      // On a phone the body scrolls between the header and the footer; on desktop the dialog does.
      flex: { base: "1", md: "initial" },
      minH: { base: "0", md: "auto" },
      overflowY: { base: "auto", md: "visible" },
      overscrollBehavior: "contain",
    },
    footer: {
      gap: "2",
      px: { base: "4", md: "5" },
      pt: { base: "3", md: "0" },
      pb: { base: SHEET_BOTTOM_PADDING, md: "5" },
    },
    title: { textStyle: "dialogTitle" },
    description: { textStyle: "bodySm", color: "fg.muted" },
    closeTrigger: { top: "3", insetEnd: "3" },
  },
  variants: {
    placement: { center: {}, bottom: {} },
    // Chakra's widths per size, from `md` up; a sheet is always the screen's width.
    size: {
      sm: { content: { maxW: { base: "full", md: "md" } } },
      md: { content: { maxW: { base: "full", md: "lg" } } },
      lg: { content: { maxW: { base: "full", md: "2xl" } } },
    },
    motionPreset: { sheet: {} },
  },
  defaultVariants: { placement: "center", motionPreset: "sheet" },
});
