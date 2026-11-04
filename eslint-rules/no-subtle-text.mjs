import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "no-subtle-text";

/** Whether a prop's value can be the string `fg.subtle` (a literal, or either side of a condition). */
function mentionsSubtle(node) {
  if (!node) return false;
  switch (node.type) {
    case "Literal":
      return node.value === "fg.subtle";
    case "JSXExpressionContainer":
      return mentionsSubtle(node.expression);
    case "ConditionalExpression":
      return mentionsSubtle(node.consequent) || mentionsSubtle(node.alternate);
    case "LogicalExpression":
      return mentionsSubtle(node.left) || mentionsSubtle(node.right);
    default:
      return false;
  }
}

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Text is never coloured fg.subtle (3:1 on the page): use fg.muted.", url: ruleDocsUrl(NAME) },
    schema: [],
    messages: {
      subtleText:
        'Text coloured "fg.subtle" is under 3.5:1 on the page and fails WCAG AA (4.5:1). Use "fg.muted" (5.3:1 or more) for text; fg.subtle is for icons and decoration. ' +
        "See docs/lint-rules.md#no-subtle-text.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "Text") return;
        for (const attribute of node.attributes) {
          if (attribute.type === "JSXAttribute" && attribute.name.name === "color" && mentionsSubtle(attribute.value)) {
            context.report({ node: attribute, messageId: "subtleText" });
          }
        }
      },
    };
  },
};

export default rule;
