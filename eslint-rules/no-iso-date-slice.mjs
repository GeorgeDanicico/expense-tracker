import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "no-iso-date-slice";

const isToISOStringCall = (node) =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.property.name === "toISOString";

const isLiteral = (node, value) => node?.type === "Literal" && node.value === value;

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Don't cut a calendar date out of toISOString(): it is the UTC day, which is the wrong day east or west of UTC.",
      url: ruleDocsUrl(NAME),
    },
    schema: [],
    messages: {
      isoSlice:
        "toISOString() is in UTC, so cutting the date out of it gives the wrong day near midnight. " +
        "Use getBucharestToday() or the date helpers in @/lib/calendar with APPLICATION_TIMEZONE. See docs/lint-rules.md#no-iso-date-slice.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee, parent } = node;
        if (callee.type !== "MemberExpression" || callee.computed || !isToISOStringCall(callee.object)) return;

        const method = callee.property.name;
        const [first, second] = node.arguments;
        const isDayCut =
          ((method === "slice" || method === "substring") && node.arguments.length === 2 && isLiteral(first, 0) && isLiteral(second, 10)) ||
          (method === "split" &&
            isLiteral(first, "T") &&
            // `.split("T")[0]` or `const [day] = ….split("T")`
            ((parent.type === "MemberExpression" && parent.object === node && isLiteral(parent.property, 0)) ||
              (parent.type === "VariableDeclarator" && parent.init === node && parent.id.type === "ArrayPattern")));

        if (isDayCut) context.report({ node, messageId: "isoSlice" });
      },
    };
  },
};

export default rule;
