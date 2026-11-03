import { selectorRule } from "./selector-rule.mjs";
import { CONTROLS, MEMBER_CONTROLS } from "./theme-selectors.mjs";

export default selectorRule({
  name: "theme-radius",
  description: "Control and dialog radius comes from the theme recipe, not from borderRadius or rounded on the element.",
  selectors: [
    {
      selector: `JSXOpeningElement[name.name=${CONTROLS}] > JSXAttribute[name.name=/^(borderRadius|rounded)$/]`,
      message: "Control radius comes from the theme recipe; remove borderRadius.",
    },
    {
      selector: `${MEMBER_CONTROLS} > JSXAttribute[name.name=/^(borderRadius|rounded)$/]`,
      message: "Control and dialog radius comes from the theme recipe; remove borderRadius.",
    },
  ],
});
