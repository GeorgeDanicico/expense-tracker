import { defineConfig } from "@chakra-ui/react";
import { defaultBaseConfig } from "@chakra-ui/react/preset-base";

// `@chakra-theme` is `@chakra-ui/react/dist/esm/theme`, see `next.config.ts`: the package's `./theme` entry imports every recipe, so a deep import is the only way to leave them out.
import { breakpoints } from "@chakra-theme/breakpoints.js";
import { globalCss } from "@chakra-theme/global-css.js";
import { layerStyles } from "@chakra-theme/layer-styles.js";
import { animationStyles } from "@chakra-theme/motion-styles.js";
import { textStyles } from "@chakra-theme/text-styles.js";
import { semanticColors } from "@chakra-theme/semantic-tokens/colors.js";
import { semanticRadii } from "@chakra-theme/semantic-tokens/radii.js";
import { semanticShadows } from "@chakra-theme/semantic-tokens/shadows.js";
import { keyframes } from "@chakra-theme/tokens/keyframes.js";
import { animations } from "@chakra-theme/tokens/animations.js";
import { aspectRatios } from "@chakra-theme/tokens/aspect-ratios.js";
import { blurs } from "@chakra-theme/tokens/blurs.js";
import { borders } from "@chakra-theme/tokens/borders.js";
import { colors } from "@chakra-theme/tokens/colors.js";
import { cursor } from "@chakra-theme/tokens/cursor.js";
import { durations } from "@chakra-theme/tokens/durations.js";
import { easings } from "@chakra-theme/tokens/easings.js";
import { fontSizes } from "@chakra-theme/tokens/font-sizes.js";
import { fontWeights } from "@chakra-theme/tokens/font-weights.js";
import { fonts } from "@chakra-theme/tokens/fonts.js";
import { letterSpacings } from "@chakra-theme/tokens/letter-spacing.js";
import { lineHeights } from "@chakra-theme/tokens/line-heights.js";
import { radii } from "@chakra-theme/tokens/radius.js";
import { sizes } from "@chakra-theme/tokens/sizes.js";
import { spacing } from "@chakra-theme/tokens/spacing.js";
import { zIndices } from "@chakra-theme/tokens/z-indices.js";
import { badgeRecipe } from "@chakra-theme/recipes/badge.js";
import { buttonRecipe } from "@chakra-theme/recipes/button.js";
import { checkmarkRecipe } from "@chakra-theme/recipes/checkmark.js";
import { containerRecipe } from "@chakra-theme/recipes/container.js";
import { headingRecipe } from "@chakra-theme/recipes/heading.js";
import { iconRecipe } from "@chakra-theme/recipes/icon.js";
import { inputRecipe } from "@chakra-theme/recipes/input.js";
import { linkRecipe } from "@chakra-theme/recipes/link.js";
import { separatorRecipe } from "@chakra-theme/recipes/separator.js";
import { skeletonRecipe } from "@chakra-theme/recipes/skeleton.js";
import { spinnerRecipe } from "@chakra-theme/recipes/spinner.js";
import { textareaRecipe } from "@chakra-theme/recipes/textarea.js";
import { alertSlotRecipe } from "@chakra-theme/recipes/alert.js";
import { avatarSlotRecipe } from "@chakra-theme/recipes/avatar.js";
import { cardSlotRecipe } from "@chakra-theme/recipes/card.js";
import { checkboxSlotRecipe } from "@chakra-theme/recipes/checkbox.js";
import { dialogSlotRecipe } from "@chakra-theme/recipes/dialog.js";
import { emptyStateSlotRecipe } from "@chakra-theme/recipes/empty-state.js";
import { fieldSlotRecipe } from "@chakra-theme/recipes/field.js";
import { listSlotRecipe } from "@chakra-theme/recipes/list.js";
import { menuSlotRecipe } from "@chakra-theme/recipes/menu.js";
import { nativeSelectSlotRecipe } from "@chakra-theme/recipes/native-select.js";
import { segmentGroupSlotRecipe } from "@chakra-theme/recipes/segment-group.js";
import { statSlotRecipe } from "@chakra-theme/recipes/stat.js";
import { switchSlotRecipe } from "@chakra-theme/recipes/switch.js";
import { tableSlotRecipe } from "@chakra-theme/recipes/table.js";
import { tabsSlotRecipe } from "@chakra-theme/recipes/tabs.js";
import { tooltipSlotRecipe } from "@chakra-theme/recipes/tooltip.js";

/**
 * Chakra's default theme with only the recipes of the components this app uses (PF9).
 *
 * `defaultConfig` carries a recipe for each of Chakra's 75 or so components, and a recipe is plain
 * data, so none of them is tree-shaken away: they were about 40 KiB of every page's JavaScript
 * (before gzip, in the Turbopack analyzer's numbers) for components the app never renders (date
 * pickers, trees, sliders, tag inputs and so on). `defaultBaseConfig` plus this file is `defaultConfig`
 * minus those. The tokens, text styles, keyframes and the rest of the default theme are the same
 * pieces `@chakra-ui/react/theme` assembles, and `ledgerSystem` merges the app's own recipes on top
 * as before.
 *
 * Using a Chakra component that is not listed here renders it without its styles, with no error.
 * `theme.test.tsx` fails when a Chakra component imported anywhere in `src` has a default recipe that
 * isn't kept, and when this theme's CSS or a kept recipe differs from the full default theme's: add
 * the recipe to the lists below.
 */
export const KEPT_RECIPES = {
  badge: badgeRecipe,
  button: buttonRecipe,
  checkmark: checkmarkRecipe,
  container: containerRecipe,
  heading: headingRecipe,
  icon: iconRecipe,
  input: inputRecipe,
  link: linkRecipe,
  separator: separatorRecipe,
  skeleton: skeletonRecipe,
  spinner: spinnerRecipe,
  textarea: textareaRecipe,
};

export const KEPT_SLOT_RECIPES = {
  alert: alertSlotRecipe,
  avatar: avatarSlotRecipe,
  card: cardSlotRecipe,
  checkbox: checkboxSlotRecipe,
  dialog: dialogSlotRecipe,
  emptyState: emptyStateSlotRecipe,
  field: fieldSlotRecipe,
  list: listSlotRecipe,
  menu: menuSlotRecipe,
  nativeSelect: nativeSelectSlotRecipe,
  segmentGroup: segmentGroupSlotRecipe,
  stat: statSlotRecipe,
  switch: switchSlotRecipe,
  table: tableSlotRecipe,
  tabs: tabsSlotRecipe,
  tooltip: tooltipSlotRecipe,
};

export const chakraBaseConfig = defaultBaseConfig;

export const chakraThemeConfig = defineConfig({
  preflight: true,
  cssVarsPrefix: "chakra",
  cssVarsRoot: ":where(html, .chakra-theme)",
  globalCss,
  theme: {
    breakpoints,
    keyframes,
    tokens: {
      aspectRatios,
      animations,
      blurs,
      borders,
      colors,
      durations,
      easings,
      fonts,
      fontSizes,
      fontWeights,
      letterSpacings,
      lineHeights,
      radii,
      spacing,
      sizes,
      zIndex: zIndices,
      cursor,
    },
    semanticTokens: { colors: semanticColors, shadows: semanticShadows, radii: semanticRadii },
    recipes: KEPT_RECIPES,
    slotRecipes: KEPT_SLOT_RECIPES,
    textStyles,
    layerStyles,
    animationStyles,
  },
});
