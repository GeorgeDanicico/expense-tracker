/**
 * The project's own ESLint rules, registered in eslint.config.mjs as the `local` plugin
 * (`local/<rule>`). Each rule is explained in docs/lint-rules.md, in a section named after it.
 */
import clientOnlyChakraFactory from "./client-only-chakra-factory.mjs";
import motionTokens from "./motion-tokens.mjs";
import noFetchInComponents from "./no-fetch-in-components.mjs";
import noIsoDateSlice from "./no-iso-date-slice.mjs";
import noLocalDateParse from "./no-local-date-parse.mjs";
import noLocaleDateWithoutZone from "./no-locale-date-without-zone.mjs";
import noRawDialog from "./no-raw-dialog.mjs";
import noReducedMotionQuery from "./no-reduced-motion-query.mjs";
import noRedundantSwrFetcher from "./no-redundant-swr-fetcher.mjs";
import noSubtleText from "./no-subtle-text.mjs";
import noWindowConfirm from "./no-window-confirm.mjs";
import noZodFlatten from "./no-zod-flatten.mjs";
import postgrestFilterString from "./postgrest-filter-string.mjs";
import themeColors from "./theme-colors.mjs";
import themeControlSize from "./theme-control-size.mjs";
import themeRadius from "./theme-radius.mjs";

const plugin = {
  meta: { name: "eslint-plugin-local" },
  rules: {
    "client-only-chakra-factory": clientOnlyChakraFactory,
    "motion-tokens": motionTokens,
    "no-fetch-in-components": noFetchInComponents,
    "no-iso-date-slice": noIsoDateSlice,
    "no-local-date-parse": noLocalDateParse,
    "no-locale-date-without-zone": noLocaleDateWithoutZone,
    "no-raw-dialog": noRawDialog,
    "no-reduced-motion-query": noReducedMotionQuery,
    "no-redundant-swr-fetcher": noRedundantSwrFetcher,
    "no-subtle-text": noSubtleText,
    "no-window-confirm": noWindowConfirm,
    "no-zod-flatten": noZodFlatten,
    "postgrest-filter-string": postgrestFilterString,
    "theme-colors": themeColors,
    "theme-control-size": themeControlSize,
    "theme-radius": themeRadius,
  },
};

export default plugin;
