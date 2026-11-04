/**
 * Spacing per breakpoint ("Spacing per breakpoint" in docs/ui-direction.md), as Chakra spacing
 * steps (4 = 16px) for responsive props. Rows and icon tiles get theirs from the `row` recipe and
 * `IconTile`; cards from the card recipe.
 */
export const PAGE_SPACING = {
  /** The page's side padding. */
  pageX: { base: "4", md: "6", lg: "8" },
  /** Above the page's first block. */
  pageTop: { base: "3", md: "6" },
  /** Between cards and sections. */
  sectionGap: { base: "4", md: "5" },
  /** Between the two desktop columns. */
  columnGap: { base: "4", lg: "6" },
  /** The phone's bottom bar and the home indicator below it: what a sticky bar or a toast sits on. */
  bottomBar: "calc(3.5rem + env(safe-area-inset-bottom))",
} as const;
