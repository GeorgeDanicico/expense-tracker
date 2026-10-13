import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

import { globalCss } from "./global-css";
import { buttonRecipe } from "./recipes/button";
import { inputRecipe, textareaRecipe } from "./recipes/input";
import { badgeRecipe, headingRecipe, linkRecipe } from "./recipes/misc";
import {
  cardSlotRecipe,
  emptyStateSlotRecipe,
  statSlotRecipe,
  tableSlotRecipe,
} from "./slot-recipes/data-display";
import { alertSlotRecipe, dialogSlotRecipe } from "./slot-recipes/feedback";
import {
  fieldSlotRecipe,
  nativeSelectSlotRecipe,
  segmentGroupSlotRecipe,
} from "./slot-recipes/forms";
import { tabsSlotRecipe } from "./slot-recipes/navigation";
import { semanticTokens } from "./semantic-tokens";
import { textStyles } from "./text-styles";
import { tokens } from "./tokens";

const config = defineConfig({
  globalCss,
  theme: {
    tokens,
    semanticTokens,
    textStyles,
    recipes: {
      button: buttonRecipe,
      input: inputRecipe,
      textarea: textareaRecipe,
      heading: headingRecipe,
      badge: badgeRecipe,
      link: linkRecipe,
    },
    slotRecipes: {
      nativeSelect: nativeSelectSlotRecipe,
      field: fieldSlotRecipe,
      segmentGroup: segmentGroupSlotRecipe,
      tabs: tabsSlotRecipe,
      table: tableSlotRecipe,
      card: cardSlotRecipe,
      stat: statSlotRecipe,
      emptyState: emptyStateSlotRecipe,
      alert: alertSlotRecipe,
      dialog: dialogSlotRecipe,
    },
  },
});

export const ledgerSystem = createSystem(defaultConfig, config);
