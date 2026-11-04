import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "no-reduced-motion-query";
const QUERY = /prefers-reduced-motion/;

/** The text of a string or template literal argument, or null. */
function textOf(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral") return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("");
  return null;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "matchMedia(\"(prefers-reduced-motion…)\") outside the shared hook: use useReducedMotion() or prefersReducedMotion().",
      url: ruleDocsUrl(NAME),
    },
    schema: [],
    messages: {
      query:
        "Use useReducedMotion() (or prefersReducedMotion() outside a component) from @/hooks/use-reduced-motion instead of asking matchMedia yourself; CSS motion needs neither, the theme turns it off. " +
        "See docs/lint-rules.md#no-reduced-motion-query.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        const name = callee.type === "Identifier" ? callee.name : callee.type === "MemberExpression" && !callee.computed ? callee.property.name : null;
        if (name !== "matchMedia") return;
        const text = textOf(node.arguments[0]);
        if (text !== null && QUERY.test(text)) context.report({ node, messageId: "query" });
      },
    };
  },
};

export default rule;
