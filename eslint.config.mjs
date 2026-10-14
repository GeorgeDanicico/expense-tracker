import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const COLOR_PROPS = "/^(color|bg|bgColor|background|backgroundColor|borderColor|fill|stroke)$/";
const HEX = "/^#[0-9a-fA-F]{3,8}$/";
const THEME_PALETTES = "/^(brand|neutral|danger|success|warning|info)$/";
const CONTROLS = "/^(Button|IconButton|Input|Textarea)$/";
const MEMBER_CONTROLS =
  "JSXOpeningElement[name.type='JSXMemberExpression'][name.object.name=/^(NativeSelect|Dialog|Tabs)$/][name.property.name=/^(Field|Content|Trigger)$/]";

/**
 * UI guardrails: styling belongs to the theme (src/components/ui/theme) and
 * the primitives in src/components/ui. See "UI conventions" in README.md.
 */
const uiGuardrails = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/components/ui/**"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: `JSXAttribute[name.name=${COLOR_PROPS}] Literal[value=${HEX}]`,
        message: "Use a colour token (e.g. fg.muted, status.warning.fg) instead of a hex value.",
      },
      ...[
        `JSXAttribute[name.name="colorPalette"] > Literal`,
        `JSXAttribute[name.name="colorPalette"] > JSXExpressionContainer > Literal`,
        `JSXAttribute[name.name="colorPalette"] ConditionalExpression > Literal.consequent`,
        `JSXAttribute[name.name="colorPalette"] ConditionalExpression > Literal.alternate`,
      ].map((literal) => ({
        selector: `${literal}:not([value=${THEME_PALETTES}])`,
        message: "Use a theme palette: brand, neutral, danger, success, warning or info.",
      })),
      {
        selector: `JSXOpeningElement[name.name=${CONTROLS}] > JSXAttribute[name.name=/^(borderRadius|rounded)$/]`,
        message: "Control radius comes from the theme recipe; remove borderRadius.",
      },
      {
        selector: `${MEMBER_CONTROLS} > JSXAttribute[name.name=/^(borderRadius|rounded)$/]`,
        message: "Control and dialog radius comes from the theme recipe; remove borderRadius.",
      },
      {
        selector: `JSXOpeningElement[name.name=${CONTROLS}] > JSXAttribute[name.name=/^(minH|minHeight)$/][value.value=/^(11|14)$/]`,
        message: "Controls use theme sizes (xs/sm/md); don't force 44px minimum heights.",
      },
      {
        selector: `${MEMBER_CONTROLS} > JSXAttribute[name.name=/^(minH|minHeight)$/][value.value=/^(11|14)$/]`,
        message: "Controls use theme sizes (xs/sm/md); don't force 44px minimum heights.",
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  uiGuardrails,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees and scratch output are not part of this project.
    ".claude/**",
    "tmp/**",
  ]),
]);

export default eslintConfig;
