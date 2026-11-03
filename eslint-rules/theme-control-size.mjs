import { selectorRule } from "./selector-rule.mjs";
import { CONTROLS, MEMBER_CONTROLS } from "./theme-selectors.mjs";

const MESSAGE = "Controls use theme sizes (xs/sm/md); don't force 44px minimum heights.";
const FORCED_HEIGHT = "JSXAttribute[name.name=/^(minH|minHeight)$/][value.value=/^(11|14)$/]";

export default selectorRule({
  name: "theme-control-size",
  description: "Controls use the theme's sizes (xs, sm, md); a forced 44px minimum height is refused.",
  selectors: [
    { selector: `JSXOpeningElement[name.name=${CONTROLS}] > ${FORCED_HEIGHT}`, message: MESSAGE },
    { selector: `${MEMBER_CONTROLS} > ${FORCED_HEIGHT}`, message: MESSAGE },
  ],
});
