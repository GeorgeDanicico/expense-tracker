import { defineSemanticTokens } from "@chakra-ui/react";

import { categoryTokens } from "./category-tokens";
import { memberTokens } from "./member-tokens";

/** A Chakra colour palette usable through `colorPalette="<name>"`. */
function palette(values: {
  solid: string;
  contrast: string;
  fg: string;
  subtle: string;
  muted: string;
  emphasized: string;
  border: string;
  focusRing: string;
}) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value }]),
  );
}

export const semanticTokens = defineSemanticTokens({
  colors: {
    bg: {
      DEFAULT: { value: "{colors.ledger.canvas}" },
      canvas: { value: "{colors.ledger.canvas}" },
      surface: { value: "{colors.ledger.surface}" },
      panel: { value: "{colors.ledger.surface}" },
      subtle: { value: "{colors.ledger.subtle}" },
      muted: { value: "{colors.ledger.muted}" },
      emphasized: { value: "{colors.ledger.line}" },
      selected: { value: "{colors.ledger.selected}" },
      error: { value: "{colors.status.negativeBg}" },
      success: { value: "{colors.status.positiveBg}" },
      warning: { value: "{colors.status.warningBg}" },
      info: { value: "{colors.status.infoBg}" },
    },
    fg: {
      DEFAULT: { value: "{colors.ledger.ink}" },
      muted: { value: "{colors.ledger.inkMuted}" },
      subtle: { value: "{colors.ledger.inkSubtle}" },
      accent: { value: "{colors.ledger.clayDark}" },
      error: { value: "{colors.status.negative}" },
      success: { value: "{colors.status.positive}" },
      warning: { value: "{colors.status.warning}" },
      info: { value: "{colors.status.info}" },
    },
    border: {
      DEFAULT: { value: "{colors.ledger.line}" },
      muted: { value: "{colors.ledger.line}" },
      subtle: { value: "{colors.ledger.line}" },
      strong: { value: "{colors.ledger.lineStrong}" },
      emphasized: { value: "{colors.ledger.lineStrong}" },
      error: { value: "{colors.status.negative}" },
      success: { value: "{colors.status.positive}" },
      warning: { value: "{colors.status.warning}" },
      info: { value: "{colors.status.info}" },
    },
    status: {
      positive: {
        fg: { value: "{colors.status.positive}" },
        bg: { value: "{colors.status.positiveBg}" },
        border: { value: "{colors.status.positiveLine}" },
      },
      negative: {
        fg: { value: "{colors.status.negative}" },
        bg: { value: "{colors.status.negativeBg}" },
        border: { value: "{colors.status.negativeLine}" },
      },
      warning: {
        fg: { value: "{colors.status.warning}" },
        bg: { value: "{colors.status.warningBg}" },
        border: { value: "{colors.status.warningLine}" },
      },
      info: {
        fg: { value: "{colors.status.info}" },
        bg: { value: "{colors.status.infoBg}" },
        border: { value: "{colors.status.infoLine}" },
      },
    },
    category: categoryTokens,
    member: memberTokens,
    chart: {
      bar: { value: "{colors.ledger.clay}" },
      track: { value: "{colors.ledger.line}" },
    },
    backdrop: { value: "rgb(41 40 36 / 40%)" },

    // Colour palettes for `colorPalette`. `neutral` is the app-wide default.
    brand: palette({
      solid: "{colors.ledger.ink}",
      contrast: "{colors.ledger.surface}",
      fg: "{colors.ledger.clayDark}",
      subtle: "{colors.ledger.selected}",
      muted: "{colors.ledger.selectedStrong}",
      emphasized: "{colors.ledger.clayLine}",
      border: "{colors.ledger.clayLine}",
      focusRing: "{colors.ledger.clayDark}",
    }),
    neutral: palette({
      solid: "{colors.ledger.ink}",
      contrast: "{colors.ledger.surface}",
      fg: "{colors.ledger.ink}",
      subtle: "{colors.ledger.muted}",
      muted: "{colors.ledger.line}",
      emphasized: "{colors.ledger.lineStrong}",
      border: "{colors.ledger.lineStrong}",
      focusRing: "{colors.ledger.clayDark}",
    }),
    orange: palette({
      solid: "{colors.ledger.orange}",
      contrast: "{colors.ledger.surface}",
      fg: "{colors.ledger.orange}",
      subtle: "{colors.ledger.orangeBg}",
      muted: "{colors.ledger.orangeLine}",
      emphasized: "{colors.ledger.orangeLine}",
      border: "{colors.ledger.orangeLine}",
      focusRing: "{colors.ledger.orange}",
    }),
    danger: palette({
      solid: "{colors.status.negative}",
      contrast: "{colors.ledger.surface}",
      fg: "{colors.status.negative}",
      subtle: "{colors.status.negativeBg}",
      muted: "{colors.status.negativeLine}",
      emphasized: "{colors.status.negativeLine}",
      border: "{colors.status.negativeLine}",
      focusRing: "{colors.status.negative}",
    }),
    success: palette({
      solid: "{colors.status.positive}",
      contrast: "{colors.ledger.surface}",
      fg: "{colors.status.positive}",
      subtle: "{colors.status.positiveBg}",
      muted: "{colors.status.positiveLine}",
      emphasized: "{colors.status.positiveLine}",
      border: "{colors.status.positiveLine}",
      focusRing: "{colors.status.positive}",
    }),
    warning: palette({
      solid: "{colors.status.warning}",
      contrast: "{colors.ledger.surface}",
      fg: "{colors.status.warning}",
      subtle: "{colors.status.warningBg}",
      muted: "{colors.status.warningLine}",
      emphasized: "{colors.status.warningLine}",
      border: "{colors.status.warningLine}",
      focusRing: "{colors.status.warning}",
    }),
    info: palette({
      solid: "{colors.status.info}",
      contrast: "{colors.ledger.surface}",
      fg: "{colors.status.info}",
      subtle: "{colors.status.infoBg}",
      muted: "{colors.status.infoLine}",
      emphasized: "{colors.status.infoLine}",
      border: "{colors.status.infoLine}",
      focusRing: "{colors.status.info}",
    }),
  },
  radii: {
    l1: { value: "{radii.badge}" },
    l2: { value: "{radii.control}" },
    l3: { value: "{radii.card}" },
  },
  shadows: {
    xs: { value: "0 1px 2px rgb(41 40 36 / 5%)" },
    overlay: { value: "0 12px 40px rgb(41 40 36 / 18%)" },
  },
});
