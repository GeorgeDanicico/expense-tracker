import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "streamed-section";

/** The local names `Suspense` has in this file: `import { Suspense } from "react"`, or `React.Suspense` through a namespace or default import. */
function suspenseNames(program) {
  const names = new Set();
  const namespaces = new Set();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== "react") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportSpecifier" && specifier.imported.name === "Suspense") names.add(specifier.local.name);
      if (specifier.type === "ImportNamespaceSpecifier" || specifier.type === "ImportDefaultSpecifier") namespaces.add(specifier.local.name);
    }
  }
  return { names, namespaces };
}

const rule = {
  meta: {
    type: "problem",
    docs: { description: "A <Suspense> with a fallback around Chakra content: use StreamedSection.", url: ruleDocsUrl(NAME) },
    schema: [],
    messages: {
      bare:
        "Use StreamedSection (src/components/ui/streamed-section.tsx) for a boundary with a fallback: content streamed into a bare " +
        "<Suspense> loses the styles its fallback wrote first, until the page hydrates (a layout shift). See docs/lint-rules.md#streamed-section.",
    },
  },
  create(context) {
    let imported = { names: new Set(), namespaces: new Set() };
    const isSuspense = (name) =>
      (name.type === "JSXIdentifier" && imported.names.has(name.name)) ||
      (name.type === "JSXMemberExpression" && name.object.type === "JSXIdentifier" && imported.namespaces.has(name.object.name) && name.property.name === "Suspense");
    return {
      Program(program) {
        imported = suspenseNames(program);
      },
      JSXOpeningElement(node) {
        if (!isSuspense(node.name)) return;
        if (node.attributes.some((attribute) => attribute.type === "JSXAttribute" && attribute.name.name === "fallback")) {
          context.report({ node, messageId: "bare" });
        }
      },
    };
  },
};

export default rule;
