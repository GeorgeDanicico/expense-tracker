import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "no-window-confirm";
const BLOCKING = new Set(["confirm", "alert", "prompt"]);
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self"]);

function resolvesToGlobal(name, scope) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable.defs.length === 0;
  }
  return true;
}

const rule = {
  meta: {
    type: "problem",
    docs: { description: "window.confirm, alert and prompt: use ConfirmDialog, a toast or undo.", url: ruleDocsUrl(NAME) },
    schema: [],
    messages: {
      blocking:
        "Don't use {{name}}(): it blocks the page and can't be styled or tested. Use ConfirmDialog, or undo for a single row. " +
        "See docs/lint-rules.md#no-window-confirm.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        let name = null;
        if (callee.type === "Identifier" && BLOCKING.has(callee.name) && resolvesToGlobal(callee.name, context.sourceCode.getScope(node))) {
          name = callee.name;
        } else if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.object.type === "Identifier" &&
          GLOBAL_OBJECTS.has(callee.object.name) &&
          BLOCKING.has(callee.property.name)
        ) {
          name = callee.property.name;
        }
        if (name) context.report({ node, messageId: "blocking", data: { name } });
      },
    };
  },
};

export default rule;
