import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "client-only-chakra-factory";

/** The factories that only run in the browser bundle, by the package that exports them. */
const FACTORIES = {
  "@chakra-ui/react": new Set(["chakra", "createRecipeContext", "createSlotRecipeContext", "createContext"]),
  react: new Set(["createContext"]),
};

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** Whether the file starts with a `"use client"` directive. */
function isClientModule(program) {
  for (const statement of program.body) {
    if (statement.type !== "ExpressionStatement" || typeof statement.directive !== "string") return false;
    if (statement.directive === "use client") return true;
  }
  return false;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "A module-level chakra(), createRecipeContext() or createContext() call needs \"use client\" at the top of the file.",
      url: ruleDocsUrl(NAME),
    },
    schema: [],
    messages: {
      serverFactory:
        "{{name}}() runs when the module loads, and it only exists in the browser bundle: a server page that imports this file (even through the @/components/ui barrel) fails `next build`. " +
        "Put \"use client\" at the top of the file. See docs/lint-rules.md#client-only-chakra-factory.",
    },
  },
  create(context) {
    /** Local name → the factory it names ("chakra", "createContext", …). */
    const factories = new Map();
    /** Local names of `import * as React from "react"` and `import React from "react"`. */
    const namespaces = new Map();
    let client = false;

    return {
      Program(node) {
        client = isClientModule(node);
      },
      ImportDeclaration(node) {
        const known = FACTORIES[node.source.value];
        if (!known) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier") {
            const imported = specifier.imported.name ?? specifier.imported.value;
            if (known.has(imported)) factories.set(specifier.local.name, imported);
          } else {
            namespaces.set(specifier.local.name, known);
          }
        }
      },
      CallExpression(node) {
        if (client) return;
        const { callee } = node;
        let name = null;
        if (callee.type === "Identifier") name = factories.get(callee.name) ?? null;
        else if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.object.type === "Identifier" &&
          namespaces.get(callee.object.name)?.has(callee.property.name)
        ) {
          name = callee.property.name;
        }
        if (!name) return;
        if (context.sourceCode.getAncestors(node).some((ancestor) => FUNCTIONS.has(ancestor.type))) return;
        context.report({ node, messageId: "serverFactory", data: { name } });
      },
    };
  },
};

export default rule;
