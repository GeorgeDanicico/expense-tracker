import { selectorRule } from "./selector-rule.mjs";

const COLOR_PROPS = "/^(color|bg|bgColor|background|backgroundColor|borderColor|fill|stroke)$/";
const HEX = "/^#[0-9a-fA-F]{3,8}$/";
const THEME_PALETTES = "/^(brand|neutral|danger|success|warning|info)$/";

const PALETTE_MESSAGE = "Use a theme palette: brand, neutral, danger, success, warning or info.";

export default selectorRule({
  name: "theme-colors",
  description: "Colours come from the theme: no hex values, and only the theme's palettes in colorPalette.",
  selectors: [
    {
      selector: `JSXAttribute[name.name=${COLOR_PROPS}] Literal[value=${HEX}]`,
      message: "Use a colour token (e.g. fg.muted, status.warning.fg) instead of a hex value.",
    },
    ...[
      `JSXAttribute[name.name="colorPalette"] > Literal`,
      `JSXAttribute[name.name="colorPalette"] > JSXExpressionContainer > Literal`,
      `JSXAttribute[name.name="colorPalette"] ConditionalExpression > Literal.consequent`,
      `JSXAttribute[name.name="colorPalette"] ConditionalExpression > Literal.alternate`,
    ].map((literal) => ({ selector: `${literal}:not([value=${THEME_PALETTES}])`, message: PALETTE_MESSAGE })),
  ],
});
