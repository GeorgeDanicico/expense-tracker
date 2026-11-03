import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "no-zod-flatten";

const rule = {
  meta: {
    type: "problem",
    docs: { description: "zod's deprecated error.flatten(): use the shared field-error helper.", url: ruleDocsUrl(NAME) },
    schema: [],
    messages: {
      flatten:
        "error.flatten() is deprecated in zod 4. Use fieldErrorsOf(error) from @/lib/validation/field-errors, so every route gives the same field errors. " +
        "See docs/lint-rules.md#no-zod-flatten.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (callee.type === "MemberExpression" && !callee.computed && callee.property.name === "flatten" && node.arguments.length === 0) {
          context.report({ node, messageId: "flatten" });
        }
      },
    };
  },
};

export default rule;
