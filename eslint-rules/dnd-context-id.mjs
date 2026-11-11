import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "dnd-context-id";

const rule = {
  meta: {
    type: "problem",
    docs: { description: "<DndContext> needs an id: without one dnd-kit numbers its markup with a render counter, which breaks hydration.", url: ruleDocsUrl(NAME) },
    schema: [],
    messages: {
      missing:
        'Give <DndContext> an id (id="todo-board"). Without one dnd-kit names its screen-reader text from a counter of renders ' +
        "(DndDescribedBy-3), so the server's HTML and the browser's differ when a render is repeated. See docs/lint-rules.md#dnd-context-id.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "DndContext") return;
        const hasId = node.attributes.some((attribute) => attribute.type === "JSXSpreadAttribute" || (attribute.type === "JSXAttribute" && attribute.name.name === "id"));
        if (!hasId) context.report({ node, messageId: "missing" });
      },
    };
  },
};

export default rule;
