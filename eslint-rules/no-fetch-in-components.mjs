import path from "node:path";

import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "no-fetch-in-components";
const REQUEST_FUNCTIONS = new Set(["fetch", "apiRequest"]);
/** A module's API object (`todo-api.tsx`) is where its requests live. */
const API_OBJECT_FILE = /-api\.tsx?$/;

const isGlobalObject = (node) => node.type === "Identifier" && (node.name === "window" || node.name === "globalThis");

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Components of a converted module don't call fetch or apiRequest; its API object and hooks do.",
      url: ruleDocsUrl(NAME),
    },
    schema: [
      {
        type: "object",
        properties: {
          modules: {
            description: "Folders (relative to the repository root, e.g. src/components/expenses) the rule applies to.",
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      request:
        "Don't call {{name}} in a component. Put the request in the module's API object (like src/components/todos/todo-api.tsx) and call it through a hook. " +
        "See docs/lint-rules.md#no-fetch-in-components.",
    },
  },
  create(context) {
    const { modules = [] } = context.options[0] ?? {};
    if (modules.length === 0) return {};
    const file = path.relative(context.cwd, context.filename).split(path.sep).join("/");
    const inConvertedModule = modules.some((folder) => file.startsWith(`${folder.replace(/\/+$/, "")}/`));
    if (!inConvertedModule || API_OBJECT_FILE.test(file) || /\.test\.tsx?$/.test(file)) return {};

    return {
      CallExpression(node) {
        const { callee } = node;
        const name =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression" && !callee.computed && isGlobalObject(callee.object)
              ? callee.property.name
              : null;
        if (name && REQUEST_FUNCTIONS.has(name)) context.report({ node, messageId: "request", data: { name: `${name}()` } });
      },
    };
  },
};

export default rule;
