import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "motion-tokens";

const MOTION_PROPS = new Set([
  "transition",
  "transitionDuration",
  "transitionTimingFunction",
  "transitionDelay",
  "animation",
  "animationName",
  "animationDuration",
  "animationTimingFunction",
  "animationDelay",
]);

/** `120ms`, `0.6s`, `.2s` as a word of its own. */
const DURATION = /(?:^|[\s,(])(?:\d*\.)?\d+m?s(?![\w-])/;
/** A CSS easing keyword or function; a token such as `{easings.standard}` or `fast` doesn't match. */
const EASING = /(?:^|[\s,])(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)(?=$|[\s,;])|cubic-bezier\(|steps\(/;

/** The string pieces a value can be made of, looking through conditionals, template literals, objects (responsive values) and arrays. */
function stringsOf(node, out = []) {
  switch (node?.type) {
    case "Literal":
      if (typeof node.value === "string") out.push(node.value);
      break;
    case "TemplateLiteral":
      for (const quasi of node.quasis) out.push(quasi.value.cooked ?? "");
      break;
    case "ConditionalExpression":
      stringsOf(node.consequent, out);
      stringsOf(node.alternate, out);
      break;
    case "LogicalExpression":
      stringsOf(node.left, out);
      stringsOf(node.right, out);
      break;
    case "JSXExpressionContainer":
      stringsOf(node.expression, out);
      break;
    case "ObjectExpression":
      for (const property of node.properties) if (property.type === "Property") stringsOf(property.value, out);
      break;
    case "ArrayExpression":
      for (const element of node.elements) stringsOf(element, out);
      break;
  }
  return out;
}

const hasLiteralMotion = (node) => stringsOf(node).some((text) => DURATION.test(text) || EASING.test(text));

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Durations, easings and @keyframes in transition and animation props come from the theme's motion tokens, not literals.",
      url: ruleDocsUrl(NAME),
    },
    schema: [],
    messages: {
      literal:
        "Use the motion tokens (a duration such as fast, moderate or slow, and a theme easing) instead of a literal duration or easing, so reduced motion can turn it off. " +
        "See docs/lint-rules.md#motion-tokens.",
      keyframes:
        "Define @keyframes in the theme (src/components/ui/theme), not in a component. See docs/lint-rules.md#motion-tokens.",
    },
  },
  create(context) {
    const checkProperty = (nameNode, valueNode, report) => {
      const name = nameNode.type === "Literal" ? String(nameNode.value) : nameNode.name;
      if (MOTION_PROPS.has(name) && hasLiteralMotion(valueNode)) context.report({ node: report, messageId: "literal" });
    };

    return {
      JSXAttribute(node) {
        if (node.value) checkProperty(node.name, node.value, node);
      },
      Property(node) {
        if (!node.computed && node.parent.type === "ObjectExpression") checkProperty(node.key, node.value, node);
      },
      Literal(node) {
        if (typeof node.value === "string" && node.value.includes("@keyframes")) context.report({ node, messageId: "keyframes" });
      },
      TemplateElement(node) {
        if ((node.value.cooked ?? "").includes("@keyframes")) context.report({ node, messageId: "keyframes" });
      },
    };
  },
};

export default rule;
