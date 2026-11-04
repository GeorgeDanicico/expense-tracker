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
      error: { value: "{colors.signal.negativeBg}" },
      success: { value: "{colors.signal.positiveBg}" },
      warning: { value: "{colors.signal.warningBg}" },
      info: { value: "{colors.signal.infoBg}" },
    },
    fg: {
      DEFAULT: { value: "{colors.ledger.ink}" },
      muted: { value: "{colors.ledger.inkMuted}" },
      subtle: { value: "{colors.ledger.inkSubtle}" },
      accent: { value: "{colors.ledger.clayDark}" },
      error: { value: "{colors.signal.negative}" },
      success: { value: "{colors.signal.positive}" },
      warning: { value: "{colors.signal.warning}" },
      info: { value: "{colors.signal.info}" },
    },
    border: {
      DEFAULT: { value: "{colors.ledger.line}" },
      muted: { value: "{colors.ledger.line}" },
      subtle: { value: "{colors.ledger.line}" },
      strong: { value: "{colors.ledger.lineStrong}" },
      emphasized: { value: "{colors.ledger.lineStrong}" },
      error: { value: "{colors.signal.negative}" },
      success: { value: "{colors.signal.positive}" },
      warning: { value: "{colors.signal.warning}" },
      info: { value: "{colors.signal.info}" },
    },
    status: {
      positive: {
        fg: { value: "{colors.signal.positive}" },
        bg: { value: "{colors.signal.positiveBg}" },
        border: { value: "{colors.signal.positiveLine}" },
      },
      negative: {
        fg: { value: "{colors.signal.negative}" },
        bg: { value: "{colors.signal.negativeBg}" },
        border: { value: "{colors.signal.negativeLine}" },
      },
      warning: {
        fg: { value: "{colors.signal.warning}" },
        bg: { value: "{colors.signal.warningBg}" },
        border: { value: "{colors.signal.warningLine}" },
      },
      info: {
        fg: { value: "{colors.signal.info}" },
        bg: { value: "{colors.signal.infoBg}" },
        border: { value: "{colors.signal.infoLine}" },
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
      solid: "{colors.signal.negative}",
      contrast: "{colors.ledger.surface}",
      fg: "{colors.signal.negative}",
      subtle: "{colors.signal.negativeBg}",
      muted: "{colors.signal.negativeLine}",
      emphasized: "{colors.signal.negativeLine}",
      border: "{colors.signal.negativeLine}",
      focusRing: "{colors.signal.negative}",
    }),
    success: palette({
      solid: "{colors.signal.positive}",
      contrast: "{colors.ledger.surface}",
      fg: "{colors.signal.positive}",
      subtle: "{colors.signal.positiveBg}",
      muted: "{colors.signal.positiveLine}",
      emphasized: "{colors.signal.positiveLine}",
      border: "{colors.signal.positiveLine}",
      focusRing: "{colors.signal.positive}",
    }),
    warning: palette({
      solid: "{colors.signal.warning}",
      contrast: "{colors.ledger.surface}",
      fg: "{colors.signal.warning}",
      subtle: "{colors.signal.warningBg}",
      muted: "{colors.signal.warningLine}",
      emphasized: "{colors.signal.warningLine}",
      border: "{colors.signal.warningLine}",
      focusRing: "{colors.signal.warning}",
    }),
    info: palette({
      solid: "{colors.signal.info}",
      contrast: "{colors.ledger.surface}",
      fg: "{colors.signal.info}",
      subtle: "{colors.signal.infoBg}",
      muted: "{colors.signal.infoLine}",
      emphasized: "{colors.signal.infoLine}",
      border: "{colors.signal.infoLine}",
      focusRing: "{colors.signal.info}",
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
