import { defineSlotRecipe } from "@chakra-ui/react";

export const tableSlotRecipe = defineSlotRecipe({
  slots: ["root", "header", "body", "row", "columnHeader", "cell", "footer", "caption"],
  base: {
    root: { fontVariantNumeric: "tabular-nums" },
    row: {
      // Row actions stay quiet until the row is hovered or focused; always
      // visible on touch screens.
      "& [data-row-action]": { opacity: 0.4, transition: "opacity 120ms ease" },
      "&:hover [data-row-action], &:focus-within [data-row-action]": { opacity: 1 },
      "@media (hover: none)": { "& [data-row-action]": { opacity: 1 } },
    },
    columnHeader: {
      textStyle: "label",
      color: "fg.muted",
      bg: "bg.subtle",
      textAlign: "start",
      "&[data-numeric]": { textAlign: "end" },
    },
    cell: {
      "&[data-numeric]": { textAlign: "end", whiteSpace: "nowrap" },
    },
  },
  variants: {
    interactive: {
      true: { body: { "& tr": { _hover: { bg: "bg.subtle" } } } },
    },
    variant: {
      line: {
        row: { bg: "transparent" },
        columnHeader: { borderColor: "border" },
        cell: { borderColor: "border" },
      },
    },
    size: {
      sm: {
        root: { textStyle: "bodySm" },
        columnHeader: { px: "3", py: "2", h: "8" },
        cell: { px: "3", py: "0.5", h: "9" },
      },
      md: {
        root: { textStyle: "bodySm" },
        columnHeader: { px: "3", py: "2", h: "9" },
        cell: { px: "3", py: "1", h: "10" },
      },
    },
  },
  defaultVariants: { size: "md", variant: "line" },
});

export const cardSlotRecipe = defineSlotRecipe({
  slots: ["root", "header", "body", "footer", "title", "description"],
  base: {
    root: { borderRadius: "card" },
    header: { gap: "0.5" },
    title: { textStyle: "sectionTitle" },
    description: { textStyle: "caption" },
  },
  variants: {
    size: {
      sm: { root: { "--card-padding": "spacing.3" }, title: { textStyle: "sectionTitle" } },
      md: { root: { "--card-padding": "spacing.4" }, title: { textStyle: "sectionTitle" } },
    },
    variant: {
      outline: {
        root: { bg: "bg.surface", borderColor: "border", boxShadow: "xs" },
      },
      subtle: {
        root: { bg: "bg.subtle" },
      },
    },
  },
  defaultVariants: { size: "md", variant: "outline" },
});

export const statSlotRecipe = defineSlotRecipe({
  slots: ["root", "label", "helpText", "valueUnit", "valueText", "indicator"],
  base: {
    root: { gap: "0.5", minW: "0" },
    label: { textStyle: "label", color: "fg.muted" },
    helpText: { textStyle: "caption" },
    valueText: {
      fontVariantNumeric: "tabular-nums",
      fontFeatureSettings: "normal",
      overflowWrap: "anywhere",
    },
  },
  variants: {
    size: {
      sm: { valueText: { textStyle: "amount" } },
      md: { valueText: { textStyle: "amountLg" } },
      lg: { valueText: { textStyle: "amountHero" } },
    },
  },
  defaultVariants: { size: "md" },
});

export const emptyStateSlotRecipe = defineSlotRecipe({
  slots: ["root", "content", "indicator", "title", "description"],
  base: {
    title: { textStyle: "sectionTitle" },
    description: { textStyle: "bodySm", color: "fg.muted", maxW: "22rem" },
    indicator: { color: "fg.subtle" },
  },
  variants: {
    size: {
      sm: {
        root: { px: "4", py: "8" },
        content: { gap: "3" },
        indicator: { textStyle: "xl" },
      },
      md: {
        root: { px: "6", py: "10" },
        content: { gap: "3" },
        indicator: { textStyle: "2xl" },
      },
    },
  },
  defaultVariants: { size: "md" },
});
